'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { type HistoryEntry, shapeHistory } from './history'
import { chunk, planPriceWrites, runLimited } from './plan'
import {
  readBranchNames,
  readItemNames,
  readPriceChanges,
  readTeamNames,
  untypedClient,
} from './queries'
import { applyPriceChangesSchema, priceHistorySchema, setAvailabilitySchema } from './schemas'
import {
  type ApplyPricesResult,
  type PriceChange,
  type PriceWriteFailure,
  pointKey,
  type SetAvailabilityResult,
} from './types'

/**
 * Lo que «Precios» escribe. Cada acción vuelve a comprobar quién es y qué rol tiene, valida
 * con zod, confirma que cada producto y cada sucursal sean de este bar y deja su renglón en la
 * auditoría (sin datos de personas: ids, importes y cantidades).
 *
 * El historial de precios (`menu_price_changes`) no se escribe desde acá: lo anota la base
 * sola, con un trigger, cada vez que cambia `price_cents`.
 */

/** Cuántos ids entran en un `in.(…)` sin pasarse del largo de una URL. */
const IDS_PER_REQUEST = 100
/** Filas por `upsert`. */
const ROWS_PER_UPSERT = 500
/** Escrituras a la vez. */
const WRITE_CONCURRENCY = 6

const NOT_ALLOWED = 'No tenés permiso para cambiar precios. Pedile al dueño que te dé acceso.'
const ACCESS_FAILED = 'No pudimos comprobar tu acceso. Probá de nuevo en un momento.'
const INVALID = 'No pudimos leer lo que mandó la pantalla. Recargá la página y probá de nuevo.'
const READ_FAILED = 'No pudimos leer los precios de la base. Probá de nuevo en un momento.'
const BRANCH_GONE = 'Esa sucursal ya no existe. Recargá la página.'

type Authorized =
  | { ok: true; tenantId: string; userId: string; timezone: string }
  | { ok: false; message: string }

async function authorize(slug: unknown): Promise<Authorized> {
  if (typeof slug !== 'string' || slug === '') return { ok: false, message: INVALID }
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, MENU_EDIT_ROLES)
    return {
      ok: true,
      tenantId: access.tenant.id,
      userId: access.user.id,
      timezone: access.tenant.timezone || 'America/Argentina/Cordoba',
    }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, message: NOT_ALLOWED }
    }
    console.error('[menu.prices.authorize]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, message: ACCESS_FAILED }
  }
}

type Supabase = Awaited<ReturnType<typeof untypedClient>>
type DbError = { code?: string; message: string } | null

const centsOf = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const cents = Number(value)
  return Number.isFinite(cents) ? cents : null
}

/** Lo que vale HOY cada precio pedido, leído con el filtro del bar. `null` si la lectura falla. */
async function readCurrentPrices(
  supabase: Supabase,
  tenantId: string,
  itemIds: string[],
  branchIds: string[],
): Promise<{ menu: Map<string, number>; own: Map<string, number | null> } | null> {
  const groups = chunk(itemIds, IDS_PER_REQUEST)
  let failed = false
  const fail = (what: string, error: DbError) => {
    if (!error) return
    failed = true
    console.error(`[menu.prices.apply] ${what}`, error.code, error.message)
  }

  const menu = new Map<string, number>()
  const own = new Map<string, number | null>()
  await Promise.all([
    runLimited(groups, WRITE_CONCURRENCY, async (ids) => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('id, price_cents')
        .eq('tenant_id', tenantId)
        .in('id', ids)
      fail('read menu_items', error)
      for (const row of (data ?? []) as Array<{ id: string; price_cents: unknown }>) {
        const cents = centsOf(row.price_cents)
        if (cents !== null) menu.set(row.id, cents)
      }
    }),
    branchIds.length === 0
      ? Promise.resolve()
      : runLimited(groups, WRITE_CONCURRENCY, async (ids) => {
          const { data, error } = await supabase
            .from('menu_item_branches')
            .select('branch_id, menu_item_id, price_cents')
            .eq('tenant_id', tenantId)
            .in('branch_id', branchIds)
            .in('menu_item_id', ids)
          fail('read menu_item_branches', error)
          for (const row of (data ?? []) as Array<{
            branch_id: string
            menu_item_id: string
            price_cents: unknown
          }>) {
            own.set(pointKey(row.branch_id, row.menu_item_id), centsOf(row.price_cents))
          }
        }),
  ])
  return failed ? null : { menu, own }
}

/** ¿Todas esas sucursales son de este bar? */
async function branchesBelong(
  supabase: Supabase,
  tenantId: string,
  branchIds: string[],
): Promise<boolean | 'error'> {
  if (branchIds.length === 0) return true
  const { data, error } = await supabase
    .from('branches')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', branchIds)
  if (error) {
    console.error('[menu.prices.branches]', error.code, error.message)
    return 'error'
  }
  return (data ?? []).length === branchIds.length
}

/**
 * Cambia precios: uno (tipeado en la lista), varios (un aumento) o los devuelve (deshacer).
 * Cada precio se escribe solo si sigue valiendo lo que la persona veía; lo que no se pudo
 * cambiar vuelve en `failed`, uno por uno, para decirlo sin vueltas.
 */
export async function applyPriceChanges(slug: string, input: unknown): Promise<ApplyPricesResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return { ok: false, message: auth.message }
  const parsed = applyPriceChangesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { changes, reason, bulk } = parsed.data
  const { tenantId, userId } = auth

  const supabase = await untypedClient()
  const itemIds = [...new Set(changes.map((change) => change.itemId))]
  const branchIds = [
    ...new Set(changes.flatMap((change) => (change.branchId === null ? [] : [change.branchId]))),
  ]

  const [belong, current] = await Promise.all([
    branchesBelong(supabase, tenantId, branchIds),
    readCurrentPrices(supabase, tenantId, itemIds, branchIds),
  ])
  if (belong === 'error' || current === null) return { ok: false, message: READ_FAILED }
  if (!belong) return { ok: false, message: BRANCH_GONE }

  const plan = planPriceWrites(changes, current)
  const applied: PriceChange[] = []
  const failed: PriceWriteFailure[] = [...plan.failed]

  // El precio de la carta: una escritura por cada «de cuánto a cuánto», y solo sobre las filas
  // que siguen valiendo lo esperado (la base decide, no lo que leímos hace un instante).
  const menuWrites = plan.menuWrites.flatMap((write) =>
    chunk(write.itemIds, IDS_PER_REQUEST).map((ids) => ({ ...write, itemIds: ids })),
  )
  await runLimited(menuWrites, WRITE_CONCURRENCY, async (write) => {
    const { data, error } = await supabase
      .from('menu_items')
      .update({ price_cents: write.priceCents })
      .eq('tenant_id', tenantId)
      .eq('price_cents', write.expectedCents)
      .in('id', write.itemIds)
      .select('id')
    if (error) console.error('[menu.prices.apply] menu_items', error.code, error.message)
    const written = new Set(
      error ? [] : ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
    )
    for (const itemId of write.itemIds) {
      if (written.has(itemId)) {
        applied.push({
          itemId,
          branchId: null,
          fromCents: write.expectedCents,
          toCents: write.priceCents,
        })
      } else {
        failed.push({ itemId, branchId: null, reason: error ? 'error' : 'changed' })
      }
    }
  })

  // El precio propio de una sucursal: la fila se crea si no estaba. `null` = volver a la carta
  // (se actualiza, no se borra: así el cambio queda en el historial).
  for (const rows of chunk(plan.branchWrites, ROWS_PER_UPSERT)) {
    const { error } = await supabase.from('menu_item_branches').upsert(
      rows.map((row) => ({
        branch_id: row.branchId,
        menu_item_id: row.itemId,
        tenant_id: tenantId,
        price_cents: row.priceCents,
        updated_by: userId,
      })),
      { onConflict: 'branch_id,menu_item_id' },
    )
    if (error) console.error('[menu.prices.apply] menu_item_branches', error.code, error.message)
    for (const row of rows) {
      if (error) failed.push({ itemId: row.itemId, branchId: row.branchId, reason: 'error' })
      else {
        applied.push({
          itemId: row.itemId,
          branchId: row.branchId,
          fromCents: row.fromCents,
          toCents: row.priceCents,
        })
      }
    }
  }
  const savedAt = Date.now()

  if (applied.length > 0) {
    const only = changes.length === 1 ? applied[0] : undefined
    if (only && reason !== 'bulk' && reason !== 'bulk_undo') {
      await logAudit({
        tenantId,
        userId,
        action: 'menu.price_changed',
        entity: 'menu_item',
        entityId: only.itemId,
        payload: {
          reason,
          branch_id: only.branchId,
          from_cents: only.fromCents,
          to_cents: only.toCents,
        },
      })
    } else {
      await logAudit({
        tenantId,
        userId,
        action: 'menu.prices_bulk_changed',
        entity: 'menu',
        payload: {
          reason,
          requested: changes.length,
          applied: applied.length,
          failed: failed.length,
          branch_ids: branchIds,
          percent_bp: bulk?.percentBp ?? null,
          rounding_cents: bulk?.roundingCents ?? null,
          scope: bulk?.scope ?? null,
          category_count: bulk?.categoryCount ?? null,
        },
      })
    }
  }

  // La carta, la pantalla de precios y cualquier otra que ya se haya visitado se vuelven a
  // pedir: nadie se queda mirando un precio viejo.
  revalidatePath(`/${slug}/menu`)
  revalidatePath(`/${slug}/menu/precios`)
  return { ok: true, savedAt, applied, failed }
}

/** «Se vende acá»: si un producto (o varios) se vende en una sucursal. */
export async function setBranchAvailability(
  slug: string,
  input: unknown,
): Promise<SetAvailabilityResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return { ok: false, message: auth.message }
  const parsed = setAvailabilitySchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { branchId, available } = parsed.data
  const { tenantId, userId } = auth
  const requested = [...new Set(parsed.data.itemIds)]

  const supabase = await untypedClient()
  const [belong, current] = await Promise.all([
    branchesBelong(supabase, tenantId, [branchId]),
    readCurrentPrices(supabase, tenantId, requested, []),
  ])
  if (belong === 'error' || current === null) return { ok: false, message: READ_FAILED }
  if (!belong) return { ok: false, message: BRANCH_GONE }

  // Solo productos de este bar.
  const itemIds = requested.filter((itemId) => current.menu.has(itemId))
  if (itemIds.length === 0) {
    return { ok: false, message: 'Ese producto ya no está en la carta. Recargá la página.' }
  }

  for (const ids of chunk(itemIds, ROWS_PER_UPSERT)) {
    // Solo viaja `available`: el precio propio, si lo tiene, no se toca.
    const { error } = await supabase.from('menu_item_branches').upsert(
      ids.map((itemId) => ({
        branch_id: branchId,
        menu_item_id: itemId,
        tenant_id: tenantId,
        available,
        updated_by: userId,
      })),
      { onConflict: 'branch_id,menu_item_id' },
    )
    if (error) {
      console.error('[menu.prices.availability]', error.code, error.message)
      return {
        ok: false,
        message: 'No se guardó. Revisá la conexión y probá de nuevo.',
      }
    }
  }
  const savedAt = Date.now()

  await logAudit({
    tenantId,
    userId,
    action: 'menu.branch_availability_changed',
    entity: itemIds.length === 1 ? 'menu_item' : 'menu',
    entityId: itemIds.length === 1 ? itemIds[0] : null,
    payload: { branch_id: branchId, available, items: itemIds.length },
  })

  revalidatePath(`/${slug}/menu`)
  revalidatePath(`/${slug}/menu/precios`)
  return { ok: true, savedAt, itemIds }
}

export type PriceHistoryResult =
  | { ok: true; entries: HistoryEntry[] }
  | { ok: false; message: string }

/** Cuántas filas se leen: de toda la carta, de más, para poder plegar un aumento entero. */
const ITEM_HISTORY_ROWS = 80
const MENU_HISTORY_ROWS = 600
/** Cuántos renglones se muestran. */
const ITEM_HISTORY_ENTRIES = 80
const MENU_HISTORY_ENTRIES = 50

/**
 * El historial de precios para leer: de un producto, o los últimos cambios de toda la carta
 * (con los aumentos plegados en un renglón). Se pide recién cuando se abre.
 */
export async function loadPriceHistory(slug: string, input: unknown): Promise<PriceHistoryResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return { ok: false, message: auth.message }
  const parsed = priceHistorySchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { itemId } = parsed.data
  const { tenantId, userId, timezone } = auth

  try {
    const [rows, teamNames, itemNames, branchNames] = await Promise.all([
      readPriceChanges(tenantId, {
        itemId,
        limit: itemId === null ? MENU_HISTORY_ROWS : ITEM_HISTORY_ROWS,
      }),
      readTeamNames(tenantId),
      readItemNames(tenantId, itemId),
      readBranchNames(tenantId),
    ])
    const entries = shapeHistory(
      rows,
      { itemNames, branchNames, teamNames, selfId: userId, timezone, now: new Date() },
      {
        collapse: itemId === null,
        limit: itemId === null ? MENU_HISTORY_ENTRIES : ITEM_HISTORY_ENTRIES,
      },
    )
    return { ok: true, entries }
  } catch (error) {
    console.error('[menu.prices.history]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, message: 'No pudimos leer el historial. Probá de nuevo en un momento.' }
  }
}
