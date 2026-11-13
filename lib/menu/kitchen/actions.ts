'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { isFeatureEnabled } from '@/lib/platform/features'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { orderIsCurrent, positionWrites } from './order'
import { chunk, type FieldChange, planPatch, planRouteWrites, runLimited } from './plan'
import { countOptionUses, kitchenClient, stationWasUsed } from './queries'
import {
  applyRouteSchema,
  createGroupSchema,
  createOptionSchema,
  createStationsSchema,
  deleteStationsSchema,
  groupIdSchema,
  optionIdSchema,
  patchGroupSchema,
  patchOptionSchema,
  patchStationSchema,
  reorderGroupsSchema,
  reorderOptionsSchema,
  reorderStationsSchema,
  setLinkSchema,
} from './schemas'
import type {
  ApplyRouteResult,
  RouteChange,
  RouteFailure,
  SaveFailureCode,
  SaveResult,
} from './types'

/**
 * Lo que «Cocina y aclaraciones» escribe. Cada acción vuelve a comprobar quién es y qué rol
 * tiene, valida con zod, confirma que cada fila sea de este bar y deja su renglón en la
 * auditoría (sin datos de personas: ids, nombres de estaciones y cantidades).
 *
 * Nada se pisa: cada cambio dice qué veía la persona y se escribe solo si eso sigue siendo
 * cierto. Y nada que ya salió en un pedido se borra: se apaga.
 */

/** Cuántos ids entran en un `in.(…)` sin pasarse del largo de una URL. */
const IDS_PER_REQUEST = 100
/** Escrituras a la vez. */
const WRITE_CONCURRENCY = 6

const NOT_ALLOWED = 'No tenés permiso para cambiar la carta. Pedile al dueño que te dé acceso.'
const DISABLED = 'El punto de venta no está prendido en este bar.'
const ACCESS_FAILED = 'No pudimos comprobar tu acceso. Probá de nuevo en un momento.'
const INVALID = 'No pudimos leer lo que mandó la pantalla. Recargá la página y probá de nuevo.'
const READ_FAILED = 'No pudimos leer la carta de la base. Probá de nuevo en un momento.'
const WRITE_FAILED = 'No se guardó. Revisá la conexión y probá de nuevo.'
const CHANGED =
  'No se guardó porque alguien lo cambió recién. Ya ves cómo quedó: si hace falta, cambialo de nuevo.'
const ORDER_CHANGED =
  'No se reordenó porque alguien cambió la lista recién. Ya ves cómo quedó: acomodala de nuevo.'

type Authorized = { ok: true; tenantId: string; userId: string } | { ok: false; message: string }

async function authorize(slug: unknown): Promise<Authorized> {
  if (typeof slug !== 'string' || slug === '') return { ok: false, message: INVALID }
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, MENU_EDIT_ROLES)
    if (!isFeatureEnabled(access.tenant, 'pos') && !access.isPlatformAdmin) {
      return { ok: false, message: DISABLED }
    }
    return { ok: true, tenantId: access.tenant.id, userId: access.user.id }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return { ok: false, message: NOT_ALLOWED }
    }
    console.error('[menu.kitchen.authorize]', error instanceof Error ? error.message : 'unknown')
    return { ok: false, message: ACCESS_FAILED }
  }
}

type DbError = { code?: string; message: string } | null

const fail = (message: string, code: SaveFailureCode = 'error') =>
  ({ ok: false, message, code }) as const

const logDb = (what: string, error: DbError) => {
  if (error) console.error(`[menu.kitchen.${what}]`, error.code, error.message)
}

/** La pantalla (y cualquier otra que ya se haya visitado) se vuelve a pedir. */
const refresh = (slug: string) => revalidatePath(`/${slug}/menu/cocina`)

/** El mismo orden en que la pantalla muestra una lista: por posición y después por nombre. */
function idsInOrder(rows: ReadonlyArray<{ id: string; position: number; text: string }>): string[] {
  return [...rows]
    .sort((a, b) => a.position - b.position || a.text.localeCompare(b.text, 'es'))
    .map((row) => row.id)
}

// ─── A dónde va cada cosa ────────────────────────────────────────────────────

const ROUTE_TABLE = { category: 'menu_categories', item: 'menu_items' } as const

/** La estación propia que tiene HOY cada cosa pedida. `null` si la lectura falla. */
async function readCurrentRoutes(
  supabase: SupabaseClient,
  tenantId: string,
  ids: { category: string[]; item: string[] },
) {
  let failed = false
  const read = async (node: 'category' | 'item') => {
    const out = new Map<string, string | null>()
    await runLimited(chunk(ids[node], IDS_PER_REQUEST), WRITE_CONCURRENCY, async (batch) => {
      const { data, error } = await supabase
        .from(ROUTE_TABLE[node])
        .select('id, station_id')
        .eq('tenant_id', tenantId)
        .in('id', batch)
      if (error) {
        failed = true
        logDb(`route read ${node}`, error)
      }
      for (const row of (data ?? []) as Array<{ id: string; station_id: string | null }>) {
        out.set(row.id, row.station_id)
      }
    })
    return out
  }
  const [categories, items, stations] = await Promise.all([
    read('category'),
    read('item'),
    supabase.from('kitchen_stations').select('id').eq('tenant_id', tenantId),
  ])
  if (stations.error) {
    failed = true
    logDb('route read stations', stations.error)
  }
  if (failed) return null
  return {
    categories,
    items,
    stations: new Set(((stations.data ?? []) as Array<{ id: string }>).map((row) => row.id)),
  }
}

/**
 * Pone o saca la estación de categorías y productos: una marca, varias (pintar una rama, pasar
 * todo de una estación a otra, la propuesta) o deshacer. Cada una se escribe solo si sigue como
 * la persona la veía; lo que no se pudo cambiar vuelve en `failed`, una por una.
 */
export async function applyRoute(slug: string, input: unknown): Promise<ApplyRouteResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return { ok: false, message: auth.message }
  const parsed = applyRouteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const { changes, reason } = parsed.data
  const { tenantId, userId } = auth

  const supabase = await kitchenClient()
  const current = await readCurrentRoutes(supabase, tenantId, {
    category: changes.filter((change) => change.node === 'category').map((change) => change.id),
    item: changes.filter((change) => change.node === 'item').map((change) => change.id),
  })
  if (current === null) return { ok: false, message: READ_FAILED }

  const plan = planRouteWrites(changes, current)
  const applied: RouteChange[] = []
  const failed: RouteFailure[] = [...plan.failed]

  const writes = plan.writes.flatMap((write) =>
    chunk(write.ids, IDS_PER_REQUEST).map((ids) => ({ ...write, ids })),
  )
  await runLimited(writes, WRITE_CONCURRENCY, async (write) => {
    // Solo sobre las filas que siguen valiendo lo esperado: la base decide, no lo que leímos
    // hace un instante.
    const scoped = supabase
      .from(ROUTE_TABLE[write.node])
      .update({ station_id: write.to })
      .eq('tenant_id', tenantId)
      .in('id', write.ids)
    const { data, error } = await (write.expected === null
      ? scoped.is('station_id', null)
      : scoped.eq('station_id', write.expected)
    ).select('id')
    logDb(`route write ${write.node}`, error)
    const written = new Set(
      error ? [] : ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
    )
    for (const id of write.ids) {
      if (written.has(id)) applied.push({ node: write.node, id, to: write.to })
      else failed.push({ node: write.node, id, reason: error ? 'error' : 'changed' })
    }
  })
  const savedAt = Date.now()

  if (applied.length === 1 && changes.length === 1) {
    const [only] = applied
    const [asked] = changes
    if (only && asked) {
      await logAudit({
        tenantId,
        userId,
        action: 'menu.station_assigned',
        entity: only.node === 'category' ? 'menu_category' : 'menu_item',
        entityId: only.id,
        payload: { reason, from_station_id: asked.expected, to_station_id: only.to },
      })
    }
  } else if (applied.length > 0) {
    await logAudit({
      tenantId,
      userId,
      action: 'menu.stations_bulk_assigned',
      entity: 'menu',
      payload: {
        reason,
        requested: changes.length,
        applied: applied.length,
        failed: failed.length,
        categories: applied.filter((change) => change.node === 'category').length,
        items: applied.filter((change) => change.node === 'item').length,
      },
    })
  }

  refresh(slug)
  return { ok: true, savedAt, applied, failed }
}

// ─── Estaciones ──────────────────────────────────────────────────────────────

type StationRow = { id: string; name: string; color: string; position: number; active: boolean }

/** Crea estaciones: una (la que se tipeó) o las tres de siempre de un toque. */
export async function createStations(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = createStationsSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { stations } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { error } = await supabase.from('kitchen_stations').insert(
    stations.map((station) => ({
      id: station.id,
      tenant_id: tenantId,
      name: station.name,
      color: station.color,
      position: station.position,
      active: station.active,
    })),
  )
  if (error) {
    if (error.code !== '23505') {
      logDb('station create', error)
      return fail(WRITE_FAILED)
    }
    // ¿Es el mismo pedido que llegó dos veces? Si ya están todas, quedó hecho.
    const { data } = await supabase
      .from('kitchen_stations')
      .select('id')
      .eq('tenant_id', tenantId)
      .in(
        'id',
        stations.map((station) => station.id),
      )
    if ((data ?? []).length !== stations.length) {
      return fail(
        stations.length === 1
          ? 'Ya hay una estación con ese nombre. Elegí otro.'
          : 'Alguna de esas estaciones ya existe con ese nombre. Recargá la página para verlas.',
        'duplicate',
      )
    }
  }
  const savedAt = Date.now()

  await logAudit({
    tenantId,
    userId,
    action: 'kitchen_station.created',
    entity: 'kitchen_station',
    entityId: stations.length === 1 ? (stations[0]?.id ?? null) : null,
    payload: { count: stations.length, names: stations.map((station) => station.name) },
  })
  refresh(slug)
  return { ok: true, savedAt }
}

/** Cambia el nombre, el color o si está prendida. */
export async function patchStation(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = patchStationSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { id, patch } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data: row, error: readError } = await supabase
    .from('kitchen_stations')
    .select('id, name, color, position, active')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    logDb('station read', readError)
    return fail(READ_FAILED)
  }
  if (!row) return fail('Esa estación ya no existe. Recargá la página.', 'gone')

  const plan = planPatch(row as StationRow, patch as PatchOf<StationRow>)
  if (plan.kind === 'changed') {
    refresh(slug)
    return fail(CHANGED, 'changed')
  }
  if (plan.kind === 'write') {
    const { data, error } = await supabase
      .from('kitchen_stations')
      .update(plan.set)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .match(plan.expect)
      .select('id')
    if (error) {
      if (error.code === '23505') {
        return fail('Ya hay una estación con ese nombre. Elegí otro.', 'duplicate')
      }
      logDb('station update', error)
      return fail(WRITE_FAILED)
    }
    if ((data ?? []).length === 0) {
      refresh(slug)
      return fail(CHANGED, 'changed')
    }
    await logAudit({
      tenantId,
      userId,
      action: 'kitchen_station.updated',
      entity: 'kitchen_station',
      entityId: id,
      payload: { set: plan.set },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

type PatchOf<Row> = { [Key in keyof Row]?: FieldChange<Row[Key]> }

/**
 * Borra estaciones que no tienen nada: ni categorías ni productos marcados, ni pedidos que
 * hayan ido ahí. Si tienen algo, no se borran (la base dejaría todo eso sin estación, también
 * los pedidos ya hechos): se apagan.
 */
export async function deleteStations(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = deleteStationsSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const ids = [...new Set(parsed.data.ids)]
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data: rows, error: readError } = await supabase
    .from('kitchen_stations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('id', ids)
  if (readError) {
    logDb('station read', readError)
    return fail(READ_FAILED)
  }
  const found = (rows ?? []) as Array<{ id: string; name: string }>
  for (const station of found) {
    const [categories, items, used] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('station_id', station.id),
      supabase
        .from('menu_items')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('station_id', station.id),
      stationWasUsed(supabase, tenantId, station.id),
    ])
    if (categories.error || items.error || used === null) {
      logDb('station usage', categories.error ?? items.error)
      return fail(READ_FAILED)
    }
    if ((categories.count ?? 0) + (items.count ?? 0) > 0) {
      return fail(
        `${station.name} todavía tiene cosas de la carta marcadas. Pasalas a otra estación y después borrala.`,
        'in_use',
      )
    }
    if (used) {
      return fail(
        `${station.name} ya recibió pedidos, así que no se borra. Si no la usás más, apagala.`,
        'in_use',
      )
    }
  }

  if (found.length > 0) {
    const { error } = await supabase
      .from('kitchen_stations')
      .delete()
      .eq('tenant_id', tenantId)
      .in(
        'id',
        found.map((station) => station.id),
      )
    if (error) {
      logDb('station delete', error)
      return fail(WRITE_FAILED)
    }
    await logAudit({
      tenantId,
      userId,
      action: 'kitchen_station.deleted',
      entity: 'kitchen_station',
      entityId: found.length === 1 ? (found[0]?.id ?? null) : null,
      payload: { count: found.length, names: found.map((station) => station.name) },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

/** Escribe el orden nuevo de una lista, fila por fila. `false` si alguna no entró. */
async function writePositions(
  supabase: SupabaseClient,
  table: 'kitchen_stations' | 'menu_modifier_groups' | 'menu_modifier_options',
  tenantId: string,
  writes: ReadonlyArray<{ id: string; position: number }>,
): Promise<boolean> {
  const results = await runLimited(writes, WRITE_CONCURRENCY, async (write) => {
    const { error } = await supabase
      .from(table)
      .update({ position: write.position })
      .eq('tenant_id', tenantId)
      .eq('id', write.id)
    logDb(`${table} position`, error)
    return !error
  })
  return results.every(Boolean)
}

/** El orden de las estaciones: el de los marcadores y el de las pantallas de la cocina. */
export async function reorderStations(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = reorderStationsSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { ids, expected } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data, error } = await supabase
    .from('kitchen_stations')
    .select('id, name, position')
    .eq('tenant_id', tenantId)
  if (error) {
    logDb('station read', error)
    return fail(READ_FAILED)
  }
  const rows = (data ?? []) as Array<{ id: string; name: string; position: number }>
  const now = idsInOrder(
    rows.map((row) => ({ id: row.id, position: row.position, text: row.name })),
  )
  if (!orderIsCurrent(now, expected)) {
    refresh(slug)
    return fail(ORDER_CHANGED, 'changed')
  }
  const writes = positionWrites(rows, ids)
  const done = await writePositions(supabase, 'kitchen_stations', tenantId, writes)
  refresh(slug)
  if (!done) return fail(WRITE_FAILED)
  const savedAt = Date.now()
  if (writes.length > 0) {
    await logAudit({
      tenantId,
      userId,
      action: 'kitchen_station.reordered',
      entity: 'kitchen_station',
      payload: { ids },
    })
  }
  return { ok: true, savedAt }
}

// ─── Aclaraciones ────────────────────────────────────────────────────────────

/** ¿Todas esas categorías y productos son de este bar? */
async function targetsBelong(
  supabase: SupabaseClient,
  tenantId: string,
  targets: ReadonlyArray<{ target: 'category' | 'item'; targetId: string }>,
): Promise<boolean | 'error'> {
  for (const node of ['category', 'item'] as const) {
    const ids = [...new Set(targets.filter((each) => each.target === node).map((t) => t.targetId))]
    for (const batch of chunk(ids, IDS_PER_REQUEST)) {
      const { data, error } = await supabase
        .from(ROUTE_TABLE[node])
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', batch)
      if (error) {
        logDb(`target read ${node}`, error)
        return 'error'
      }
      if ((data ?? []).length !== batch.length) return false
    }
  }
  return true
}

type GroupRow = {
  id: string
  name: string
  selection: 'single' | 'multi'
  required: boolean
  position: number
  active: boolean
}

async function readGroup(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<{ row: GroupRow | null; error: boolean }> {
  const { data, error } = await supabase
    .from('menu_modifier_groups')
    .select('id, name, selection, required, position, active')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  logDb('group read', error)
  return { row: (data as GroupRow | null) ?? null, error: Boolean(error) }
}

/** Crea un grupo de aclaraciones, vacío o con sus opciones y sus enganches (una plantilla). */
export async function createGroup(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = createGroupSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { group, options, links } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const belong = await targetsBelong(supabase, tenantId, links)
  if (belong === 'error') return fail(READ_FAILED)
  if (!belong)
    return fail('Alguno de esos productos ya no está en la carta. Recargá la página.', 'gone')

  const { error } = await supabase.from('menu_modifier_groups').insert({
    id: group.id,
    tenant_id: tenantId,
    name: group.name,
    selection: group.selection,
    required: group.required,
    position: group.position,
    active: group.active,
  })
  if (error) {
    if (error.code !== '23505') {
      logDb('group create', error)
      return fail(WRITE_FAILED)
    }
    // El mismo pedido dos veces: si el grupo ya es de este bar, quedó hecho.
    const existing = await readGroup(supabase, tenantId, group.id)
    if (existing.error || !existing.row) return fail(WRITE_FAILED)
    refresh(slug)
    return { ok: true, savedAt: Date.now() }
  }

  // Si las opciones o los enganches no entran, el grupo no queda a medias: se saca.
  const undo = async () => {
    const { error: cleanup } = await supabase
      .from('menu_modifier_groups')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', group.id)
    logDb('group create cleanup', cleanup)
  }
  if (options.length > 0) {
    const { error: optionsError } = await supabase.from('menu_modifier_options').insert(
      options.map((option) => ({
        id: option.id,
        tenant_id: tenantId,
        group_id: group.id,
        label: option.label,
        price_delta_cents: option.priceDeltaCents,
        position: option.position,
        active: option.active,
      })),
    )
    if (optionsError) {
      logDb('group create options', optionsError)
      await undo()
      return fail(WRITE_FAILED)
    }
  }
  if (links.length > 0) {
    const { error: linksError } = await supabase.from('menu_modifier_links').insert(
      links.map((link) => ({
        tenant_id: tenantId,
        group_id: group.id,
        category_id: link.target === 'category' ? link.targetId : null,
        menu_item_id: link.target === 'item' ? link.targetId : null,
      })),
    )
    if (linksError) {
      logDb('group create links', linksError)
      await undo()
      return fail(WRITE_FAILED)
    }
  }
  const savedAt = Date.now()

  await logAudit({
    tenantId,
    userId,
    action: 'menu_modifier_group.created',
    entity: 'menu_modifier_group',
    entityId: group.id,
    payload: {
      name: group.name,
      selection: group.selection,
      required: group.required,
      options: options.length,
      links: links.length,
    },
  })
  refresh(slug)
  return { ok: true, savedAt }
}

/** Cambia la pregunta, cómo se elige o si está prendido. */
export async function patchGroup(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = patchGroupSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { id, patch } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const current = await readGroup(supabase, tenantId, id)
  if (current.error) return fail(READ_FAILED)
  if (!current.row) return fail('Esa aclaración ya no existe. Recargá la página.', 'gone')

  const plan = planPatch(current.row, patch as PatchOf<GroupRow>)
  if (plan.kind === 'changed') {
    refresh(slug)
    return fail(CHANGED, 'changed')
  }
  if (plan.kind === 'write') {
    const { data, error } = await supabase
      .from('menu_modifier_groups')
      .update(plan.set)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .match(plan.expect)
      .select('id')
    if (error) {
      logDb('group update', error)
      return fail(WRITE_FAILED)
    }
    if ((data ?? []).length === 0) {
      refresh(slug)
      return fail(CHANGED, 'changed')
    }
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_group.updated',
      entity: 'menu_modifier_group',
      entityId: id,
      payload: { set: plan.set },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

async function optionIdsOf(
  supabase: SupabaseClient,
  tenantId: string,
  groupId: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('menu_modifier_options')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('group_id', groupId)
  if (error) {
    logDb('options read', error)
    return null
  }
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
}

export type GroupUsageResult = { ok: true; uses: number } | { ok: false; message: string }

/** En cuántos renglones de pedidos salió un grupo: decide si se puede borrar o solo apagar. */
export async function loadGroupUsage(slug: string, input: unknown): Promise<GroupUsageResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return { ok: false, message: auth.message }
  const parsed = groupIdSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: INVALID }
  const supabase = await kitchenClient()
  const optionIds = await optionIdsOf(supabase, auth.tenantId, parsed.data.id)
  const uses = optionIds === null ? null : await countOptionUses(supabase, auth.tenantId, optionIds)
  if (uses === null) return { ok: false, message: READ_FAILED }
  return { ok: true, uses }
}

/**
 * Borra un grupo con sus opciones y sus enganches. Solo si ninguna de sus opciones salió en un
 * pedido: si salió, no se borra (el historial la nombra) y hay que apagarlo.
 */
export async function deleteGroup(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = groupIdSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { id } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const current = await readGroup(supabase, tenantId, id)
  if (current.error) return fail(READ_FAILED)
  if (current.row) {
    const optionIds = await optionIdsOf(supabase, tenantId, id)
    const uses = optionIds === null ? null : await countOptionUses(supabase, tenantId, optionIds)
    if (optionIds === null || uses === null) return fail(READ_FAILED)
    if (uses > 0) {
      return fail(
        `«${current.row.name}» ya salió en pedidos, así que no se borra. Apagala y el mozo deja de verla.`,
        'in_use',
      )
    }
    const { error } = await supabase
      .from('menu_modifier_groups')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id)
    if (error) {
      logDb('group delete', error)
      return fail(WRITE_FAILED)
    }
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_group.deleted',
      entity: 'menu_modifier_group',
      entityId: id,
      payload: { name: current.row.name, options: optionIds.length },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

/** El orden de los grupos: el orden en que el mozo ve las preguntas. */
export async function reorderGroups(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = reorderGroupsSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { ids, expected } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data, error } = await supabase
    .from('menu_modifier_groups')
    .select('id, name, position')
    .eq('tenant_id', tenantId)
  if (error) {
    logDb('group read', error)
    return fail(READ_FAILED)
  }
  const rows = (data ?? []) as Array<{ id: string; name: string; position: number }>
  const now = idsInOrder(
    rows.map((row) => ({ id: row.id, position: row.position, text: row.name })),
  )
  if (!orderIsCurrent(now, expected)) {
    refresh(slug)
    return fail(ORDER_CHANGED, 'changed')
  }
  const writes = positionWrites(rows, ids)
  const done = await writePositions(supabase, 'menu_modifier_groups', tenantId, writes)
  refresh(slug)
  if (!done) return fail(WRITE_FAILED)
  const savedAt = Date.now()
  if (writes.length > 0) {
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_group.reordered',
      entity: 'menu_modifier_group',
      payload: { ids },
    })
  }
  return { ok: true, savedAt }
}

type OptionRow = {
  id: string
  group_id: string
  label: string
  price_delta_cents: number | string
  position: number
  active: boolean
}

/** Suma una opción a un grupo. */
export async function createOption(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = createOptionSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { groupId, option } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const group = await readGroup(supabase, tenantId, groupId)
  if (group.error) return fail(READ_FAILED)
  if (!group.row) return fail('Esa aclaración ya no existe. Recargá la página.', 'gone')

  const { error } = await supabase.from('menu_modifier_options').insert({
    id: option.id,
    tenant_id: tenantId,
    group_id: groupId,
    label: option.label,
    price_delta_cents: option.priceDeltaCents,
    position: option.position,
    active: option.active,
  })
  if (error) {
    if (error.code !== '23505') {
      logDb('option create', error)
      return fail(WRITE_FAILED)
    }
    const { data } = await supabase
      .from('menu_modifier_options')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('group_id', groupId)
      .eq('id', option.id)
    if ((data ?? []).length === 0) return fail(WRITE_FAILED)
  } else {
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_option.created',
      entity: 'menu_modifier_option',
      entityId: option.id,
      payload: { group_id: groupId, label: option.label, delta_cents: option.priceDeltaCents },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

/** Cambia el nombre, lo que suma o si está prendida. */
export async function patchOption(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = patchOptionSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { id, patch } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data: row, error: readError } = await supabase
    .from('menu_modifier_options')
    .select('id, group_id, label, price_delta_cents, position, active')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    logDb('option read', readError)
    return fail(READ_FAILED)
  }
  if (!row) return fail('Esa opción ya no existe. Recargá la página.', 'gone')
  const found = row as OptionRow
  // La base devuelve los centavos como texto si son grandes: se comparan como número.
  const current = {
    label: found.label,
    priceDeltaCents: Number(found.price_delta_cents),
    active: found.active,
  }

  const plan = planPatch(current, patch as PatchOf<typeof current>)
  if (plan.kind === 'changed') {
    refresh(slug)
    return fail(CHANGED, 'changed')
  }
  if (plan.kind === 'write') {
    const column = {
      label: 'label',
      priceDeltaCents: 'price_delta_cents',
      active: 'active',
    } as const
    const toColumns = (values: Partial<typeof current>) =>
      Object.fromEntries(
        (Object.keys(values) as Array<keyof typeof current>).map((key) => [
          column[key],
          values[key],
        ]),
      )
    const { data, error } = await supabase
      .from('menu_modifier_options')
      .update(toColumns(plan.set))
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .match(toColumns(plan.expect))
      .select('id')
    if (error) {
      logDb('option update', error)
      return fail(WRITE_FAILED)
    }
    if ((data ?? []).length === 0) {
      refresh(slug)
      return fail(CHANGED, 'changed')
    }
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_option.updated',
      entity: 'menu_modifier_option',
      entityId: id,
      payload: { group_id: found.group_id, set: toColumns(plan.set) },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt }
}

export type DeleteOptionResult = SaveResult<{
  /** `deleted` = se borró · `deactivated` = ya había salido en pedidos y quedó apagada. */
  outcome: 'deleted' | 'deactivated'
}>

/**
 * Saca una opción. Si nunca salió en un pedido, se borra. Si ya salió, el historial la nombra:
 * no se borra, se apaga, y el mozo deja de verla igual.
 */
export async function deleteOption(slug: string, input: unknown): Promise<DeleteOptionResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = optionIdSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { id } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data: row, error: readError } = await supabase
    .from('menu_modifier_options')
    .select('id, group_id, label')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    logDb('option read', readError)
    return fail(READ_FAILED)
  }
  let outcome: 'deleted' | 'deactivated' = 'deleted'
  if (row) {
    const found = row as { id: string; group_id: string; label: string }
    const uses = await countOptionUses(supabase, tenantId, [id])
    if (uses === null) return fail(READ_FAILED)
    if (uses > 0) {
      outcome = 'deactivated'
      const { error } = await supabase
        .from('menu_modifier_options')
        .update({ active: false })
        .eq('tenant_id', tenantId)
        .eq('id', id)
      if (error) {
        logDb('option deactivate', error)
        return fail(WRITE_FAILED)
      }
    } else {
      const { error } = await supabase
        .from('menu_modifier_options')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', id)
      if (error) {
        logDb('option delete', error)
        return fail(WRITE_FAILED)
      }
    }
    await logAudit({
      tenantId,
      userId,
      action:
        outcome === 'deleted' ? 'menu_modifier_option.deleted' : 'menu_modifier_option.updated',
      entity: 'menu_modifier_option',
      entityId: id,
      payload: { group_id: found.group_id, label: found.label, outcome, uses },
    })
  }
  const savedAt = Date.now()
  refresh(slug)
  return { ok: true, savedAt, outcome }
}

/** El orden de las opciones dentro de su grupo: el de las fichas que toca el mozo. */
export async function reorderOptions(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = reorderOptionsSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { groupId, ids, expected } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()

  const { data, error } = await supabase
    .from('menu_modifier_options')
    .select('id, label, position')
    .eq('tenant_id', tenantId)
    .eq('group_id', groupId)
  if (error) {
    logDb('option read', error)
    return fail(READ_FAILED)
  }
  const rows = (data ?? []) as Array<{ id: string; label: string; position: number }>
  const now = idsInOrder(
    rows.map((row) => ({ id: row.id, position: row.position, text: row.label })),
  )
  if (!orderIsCurrent(now, expected)) {
    refresh(slug)
    return fail(ORDER_CHANGED, 'changed')
  }
  const writes = positionWrites(rows, ids)
  const done = await writePositions(supabase, 'menu_modifier_options', tenantId, writes)
  refresh(slug)
  if (!done) return fail(WRITE_FAILED)
  const savedAt = Date.now()
  if (writes.length > 0) {
    await logAudit({
      tenantId,
      userId,
      action: 'menu_modifier_option.reordered',
      entity: 'menu_modifier_group',
      entityId: groupId,
      payload: { ids },
    })
  }
  return { ok: true, savedAt }
}

/** Engancha (o desengancha) un grupo a una categoría o a un producto. */
export async function setLink(slug: string, input: unknown): Promise<SaveResult> {
  const auth = await authorize(slug)
  if (!auth.ok) return fail(auth.message)
  const parsed = setLinkSchema.safeParse(input)
  if (!parsed.success) return fail(INVALID)
  const { groupId, target, targetId, linked } = parsed.data
  const { tenantId, userId } = auth
  const supabase = await kitchenClient()
  const column = target === 'category' ? 'category_id' : 'menu_item_id'

  const group = await readGroup(supabase, tenantId, groupId)
  if (group.error) return fail(READ_FAILED)
  if (!group.row) return fail('Esa aclaración ya no existe. Recargá la página.', 'gone')

  if (linked) {
    const belong = await targetsBelong(supabase, tenantId, [{ target, targetId }])
    if (belong === 'error') return fail(READ_FAILED)
    if (!belong) return fail('Eso ya no está en la carta. Recargá la página.', 'gone')
    const { error } = await supabase.from('menu_modifier_links').insert({
      tenant_id: tenantId,
      group_id: groupId,
      category_id: target === 'category' ? targetId : null,
      menu_item_id: target === 'item' ? targetId : null,
    })
    // 23505: ya estaba enganchado. Es lo que se pedía.
    if (error && error.code !== '23505') {
      logDb('link insert', error)
      return fail(WRITE_FAILED)
    }
  } else {
    const { error } = await supabase
      .from('menu_modifier_links')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('group_id', groupId)
      .eq(column, targetId)
    if (error) {
      logDb('link delete', error)
      return fail(WRITE_FAILED)
    }
  }
  const savedAt = Date.now()

  await logAudit({
    tenantId,
    userId,
    action: linked ? 'menu_modifier_link.added' : 'menu_modifier_link.removed',
    entity: 'menu_modifier_group',
    entityId: groupId,
    payload: { target, target_id: targetId },
  })
  refresh(slug)
  return { ok: true, savedAt }
}
