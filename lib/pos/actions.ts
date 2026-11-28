'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import {
  BRANCH_COOKIE_MAX_AGE,
  nextBranchCookie,
  parseBranchCookie,
  serializeBranchCookie,
} from '@/lib/branches/cookie'
import { isFeatureEnabled } from '@/lib/platform/features'
import { createClient } from '@/lib/supabase/server'
import {
  POS_FLOOR_ROLES,
  POS_KITCHEN_ROLES,
  POS_VIEW_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import { toPosError } from './errors'
import { broadcastToBranch } from './print/broadcast'
import { parsePrintDoc } from './print/doc'
import {
  branchCookieName,
  getFloorSnapshot,
  getKitchenQueue,
  getPosMenu,
  getSessionDetail,
} from './queries'
import type { FloorSnapshot, KitchenQueue, PosMenu, SessionDetail } from './types'

/**
 * Acciones del punto de venta. Todas hacen lo mismo en el mismo orden:
 *   1. quién sos y si tu rol puede (y si el bar tiene el punto de venta prendido);
 *   2. validar lo que llega;
 *   3. una RPC `pos_*`, que vuelve a chequear el rol contra el bar DE LA FILA y
 *      avisa en vivo a las demás pantallas;
 *   4. un mensaje que se pueda resolver si algo falla.
 * No revalidan rutas: cada pantalla vuelve a leer cuando le llega el aviso en vivo.
 */

type Ok<T> = T extends undefined ? { ok: true } : { ok: true; data: T }
export type ActionResult<T = undefined> = Ok<T> | { ok: false; message: string; code: string }

type Access = { tenantId: string; role: TenantRole; userId: string; supabase: SupabaseClient }

async function authorize(
  slug: string,
  roles: ReadonlyArray<TenantRole>,
): Promise<Access | { ok: false; message: string; code: string }> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, roles)
    if (!isFeatureEnabled(access.tenant, 'pos') && !access.isPlatformAdmin) {
      return {
        ok: false,
        message: 'El punto de venta no está prendido en este bar.',
        code: 'disabled',
      }
    }
    return {
      tenantId: access.tenant.id,
      role: access.role,
      userId: access.user.id,
      supabase: (await createClient()) as unknown as SupabaseClient,
    }
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, message: 'Se cerró tu sesión. Volvé a entrar.', code: 'unauthenticated' }
    }
    if (error instanceof RoleRequiredError || error instanceof TenantNotFoundError) {
      return { ok: false, message: 'No tenés permiso para hacer esto.', code: 'forbidden' }
    }
    throw error
  }
}

function isDenied(
  access: Access | { ok: false },
): access is { ok: false; message: string; code: string } {
  return 'ok' in access
}

async function call<T>(
  access: Access,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; message: string; code: string }> {
  const { data, error } = await access.supabase.rpc(fn, args)
  if (error) {
    const parsed = toPosError(error)
    if (parsed.code === 'unknown') console.error(`[pos.${fn}]`, error.code, error.message)
    return { ok: false, message: parsed.message, code: parsed.code }
  }
  return { ok: true, data: data as T }
}

const invalid = { ok: false as const, message: 'Faltan datos o hay alguno mal.', code: 'invalid' }

const id = z.uuid()

/**
 * La cuenta en papel por la comandera de la red (la de la barra), en vez de la impresora de esta compu.
 * El programa «HUB Impresoras» la recibe por el canal en vivo de la sucursal y la imprime de a un tique,
 * en la fila de esa impresora. Si el programa no está andando, la cuenta no sale: la pantalla lo dice como
 * «mandada», no «impresa».
 */
export async function sendBillToComandera(
  slug: string,
  sessionId: string,
  doc: unknown,
): Promise<ActionResult> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success) return invalid
  const parsed = parsePrintDoc(doc)
  if (!parsed) return { ok: false, message: 'La cuenta no se pudo armar.', code: 'invalid' }
  // La mesa tiene que ser del bar de quien manda (la política de la tabla lo asegura).
  const { data: session, error } = await access.supabase
    .from('table_sessions')
    .select('id, branch_id, tenant_id')
    .eq('id', sessionId)
    .eq('tenant_id', access.tenantId)
    .maybeSingle()
  if (error || !session?.branch_id) {
    return { ok: false, message: 'No encontré esa mesa.', code: 'not_found' }
  }
  try {
    const sent = await broadcastToBranch(session.branch_id as string, 'print', {
      id: crypto.randomUUID(),
      kind: 'bill',
      doc: parsed,
    })
    if (!sent) throw new Error('broadcast')
    return { ok: true }
  } catch (cause) {
    console.error('[pos.print.bill]', cause instanceof Error ? cause.message : 'unknown')
    return {
      ok: false,
      message: 'No pude mandar la cuenta a la comandera.',
      code: 'unavailable',
    }
  }
}
const partySize = z.number().int().min(1).max(100)

// ─── Sucursal ───────────────────────────────────────────────────────────────

/** «¿Dónde trabajás hoy?»: queda guardado en este dispositivo por un año. */
export async function setActiveBranch(slug: string, branchId: string): Promise<ActionResult> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const { data } = await access.supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('tenant_id', access.tenantId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return { ok: false, message: 'No encontré esa sucursal.', code: 'branch_not_found' }
  // El dispositivo pasa a trabajar en esta sucursal; si el panel estaba mirando «Todas», sigue en «Todas».
  const store = await cookies()
  const name = branchCookieName(access.tenantId)
  const next = nextBranchCookie(parseBranchCookie(store.get(name)?.value), branchId, 'device')
  store.set(name, serializeBranchCookie(next), {
    path: '/',
    maxAge: BRANCH_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
  return { ok: true }
}

// ─── Lecturas que las pantallas vuelven a pedir en vivo ─────────────────────

export async function refreshFloor(
  slug: string,
  branchId: string,
): Promise<ActionResult<FloorSnapshot>> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const result = await getFloorSnapshot(branchId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

export async function refreshSession(
  slug: string,
  sessionId: string,
): Promise<ActionResult<SessionDetail>> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success) return invalid
  const result = await getSessionDetail(sessionId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

export async function refreshMenu(slug: string, branchId: string): Promise<ActionResult<PosMenu>> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const result = await getPosMenu(branchId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

export async function refreshKitchen(
  slug: string,
  branchId: string,
): Promise<ActionResult<KitchenQueue>> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const result = await getKitchenQueue(branchId)
  if (!result.ok) return { ok: false, message: result.error.message, code: result.error.code }
  return { ok: true, data: result.data }
}

// ─── La mesa ────────────────────────────────────────────────────────────────

const openTableSchema = z.object({
  tableId: id,
  partySize,
  reservationId: id.nullish(),
  customerId: id.nullish(),
  alias: z.string().trim().max(60).nullish(),
})
export type OpenTableInput = z.input<typeof openTableSchema>

export async function openTable(
  slug: string,
  input: OpenTableInput,
): Promise<ActionResult<{ sessionId: string; alreadyOpen: boolean }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  const parsed = openTableSchema.safeParse(input)
  if (!parsed.success) return invalid

  const result = await call<{ session_id: string; already_open: boolean }>(
    access,
    'pos_open_table',
    {
      p_table_id: parsed.data.tableId,
      p_party_size: parsed.data.partySize,
      p_reservation_id: parsed.data.reservationId ?? null,
      p_customer_id: parsed.data.customerId ?? null,
      p_alias: parsed.data.alias || null,
      // Una mesa «de práctica» no llega a la caja ni a los reportes: no la decide el celular. Va apagado
      // hasta que el modo práctica sea de la sucursal y lo prenda el dueño (docs/features/pos.md).
      p_practice: false,
    },
  )
  if (!result.ok) return result

  if (!result.data.already_open) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_opened',
      entity: 'table_session',
      entityId: result.data.session_id,
      payload: {
        table_id: parsed.data.tableId,
        party_size: parsed.data.partySize,
        reservation_id: parsed.data.reservationId ?? null,
      },
    })
  }
  return {
    ok: true,
    data: { sessionId: result.data.session_id, alreadyOpen: result.data.already_open },
  }
}

const updateTableSchema = z.object({
  sessionId: id,
  partySize: partySize.optional(),
  alias: z.string().trim().max(60).optional(),
  customerId: id.optional(),
  clearCustomer: z.boolean().optional(),
})

export async function updateTable(
  slug: string,
  input: z.input<typeof updateTableSchema>,
): Promise<ActionResult> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  const parsed = updateTableSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call(access, 'pos_update_table', {
    p_session_id: parsed.data.sessionId,
    p_party_size: parsed.data.partySize ?? null,
    p_alias: parsed.data.alias ?? null,
    p_customer_id: parsed.data.customerId ?? null,
    p_clear_customer: parsed.data.clearCustomer ?? false,
  })
  if (!result.ok) return result
  // De quién es la mesa decide a quién le van los puntos al cobrar: queda quién lo cambió.
  if (parsed.data.customerId || parsed.data.clearCustomer) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_customer_changed',
      entity: 'table_session',
      entityId: parsed.data.sessionId,
      payload: {
        customer_id: parsed.data.clearCustomer ? null : (parsed.data.customerId ?? null),
        cleared: parsed.data.clearCustomer ?? false,
      },
    })
  }
  return { ok: true }
}

export async function moveTable(
  slug: string,
  sessionId: string,
  tableId: string,
): Promise<ActionResult<{ moved: boolean }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success || !id.safeParse(tableId).success) return invalid
  const result = await call<{ moved: boolean }>(access, 'pos_move_table', {
    p_session_id: sessionId,
    p_table_id: tableId,
  })
  if (!result.ok) return result
  if (result.data.moved) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_moved',
      entity: 'table_session',
      entityId: sessionId,
      payload: { to_table_id: tableId },
    })
  }
  return { ok: true, data: { moved: result.data.moved } }
}

export async function requestBill(
  slug: string,
  sessionId: string,
  on = true,
): Promise<ActionResult> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  // `on` llega del navegador: un texto «false» sería verdadero para la base.
  if (!id.safeParse(sessionId).success || typeof on !== 'boolean') return invalid
  const result = await call(access, 'pos_request_bill', { p_session_id: sessionId, p_on: on })
  return result.ok ? { ok: true } : result
}

/** Quién puede atender una mesa en esta sucursal: nombres y rol, para «Pasar la mesa». */
export type FloorTeamMember = { id: string; name: string; role: TenantRole }

export async function floorTeam(
  slug: string,
  branchId: string,
): Promise<ActionResult<FloorTeamMember[]>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(branchId).success) return invalid
  const result = await call<FloorTeamMember[]>(access, 'pos_floor_team', { p_branch_id: branchId })
  if (!result.ok) return result
  return { ok: true, data: Array.isArray(result.data) ? result.data : [] }
}

/**
 * Cambiar quién atiende una mesa. El encargado (dueño, caja, anfitriona) la pasa a quien haga falta, o
 * la deja sin nadie (`userId: null`). Un mozo toma una que no tiene a nadie o le pasa la suya a un
 * compañero; la de otro no la toca (lo decide la base: `pos_assign_waiter`).
 */
export async function assignWaiter(
  slug: string,
  sessionId: string,
  userId: string | null,
): Promise<ActionResult<{ waiterId: string | null; waiter: string | null }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success || (userId !== null && !id.safeParse(userId).success)) {
    return invalid
  }
  const result = await call<{
    waiter_id: string | null
    waiter: string | null
    previous_id: string | null
    changed: boolean
  }>(access, 'pos_assign_waiter', { p_session_id: sessionId, p_user_id: userId })
  if (!result.ok) return result
  if (result.data.changed) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_waiter_changed',
      entity: 'table_session',
      entityId: sessionId,
      payload: { waiter_id: result.data.waiter_id, previous_id: result.data.previous_id },
    })
  }
  return { ok: true, data: { waiterId: result.data.waiter_id, waiter: result.data.waiter } }
}

/**
 * Juntar dos mesas: todo lo de `fromSessionId` (lo pedido, lo cobrado, los descuentos) pasa a la
 * cuenta de `intoSessionId`, y la primera queda libre. No tiene vuelta: la pantalla pregunta antes.
 */
export async function mergeTables(
  slug: string,
  fromSessionId: string,
  intoSessionId: string,
): Promise<ActionResult<{ duplicate: boolean }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (
    !id.safeParse(fromSessionId).success ||
    !id.safeParse(intoSessionId).success ||
    fromSessionId === intoSessionId
  ) {
    return invalid
  }
  const result = await call<{ merged: boolean; duplicate: boolean }>(access, 'pos_merge_tables', {
    p_from: fromSessionId,
    p_into: intoSessionId,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.tables_merged',
      entity: 'table_session',
      entityId: intoSessionId,
      payload: { from_session_id: fromSessionId },
    })
  }
  return { ok: true, data: { duplicate: result.data.duplicate } }
}

/**
 * Liberar una mesa que se abrió por error. La base solo deja si no tiene nada vivo cargado ni
 * cobros: lo demás se da de baja o se cobra.
 */
export async function releaseTable(
  slug: string,
  sessionId: string,
): Promise<ActionResult<{ duplicate: boolean }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(sessionId).success) return invalid
  const result = await call<{ released: boolean; duplicate: boolean }>(
    access,
    'pos_release_table',
    { p_session_id: sessionId },
  )
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.table_released',
      entity: 'table_session',
      entityId: sessionId,
    })
  }
  return { ok: true, data: { duplicate: result.data.duplicate } }
}

/**
 * Prender o apagar el modo práctica de una sucursal (solo un dueño). Prendido dura hasta las 5 de la
 * mañana; al apagarlo, la base levanta las mesas de práctica que hayan quedado abiertas.
 */
export async function setPractice(
  slug: string,
  branchId: string,
  on: boolean,
): Promise<ActionResult<{ practiceUntil: string | null; cleared: number }>> {
  const access = await authorize(slug, ['owner'])
  if (isDenied(access)) return access
  // `on` llega del navegador: un texto «false» sería verdadero para la base.
  if (!id.safeParse(branchId).success || typeof on !== 'boolean') return invalid
  const result = await call<{ practice_until: string | null; cleared: number }>(
    access,
    'pos_set_practice',
    { p_branch_id: branchId, p_on: on },
  )
  if (!result.ok) return result
  await logAudit({
    tenantId: access.tenantId,
    userId: access.userId,
    action: on ? 'pos.practice_on' : 'pos.practice_off',
    entity: 'branch',
    entityId: branchId,
    payload: { until: result.data.practice_until, cleared: result.data.cleared },
  })
  return {
    ok: true,
    data: { practiceUntil: result.data.practice_until, cleared: result.data.cleared },
  }
}

// ─── Las tandas ─────────────────────────────────────────────────────────────

const orderSchema = z.object({
  sessionId: id,
  items: z
    .array(
      z.object({
        menu_item_id: id,
        quantity: z.number().int().min(1).max(99),
        option_ids: z.array(id).max(12).default([]),
        notes: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1)
    .max(80),
  /** true = sale a cocina ahora; false = queda esperando («después»). */
  fire: z.boolean().default(true),
  course: z.number().int().min(1).max(9).default(1),
  /** Lo arma el celular una vez por pedido: reintentar sin señal nunca duplica. */
  idempotencyKey: z.string().trim().min(8).max(80),
})
export type SendOrderInput = z.input<typeof orderSchema>

export async function sendOrder(
  slug: string,
  input: SendOrderInput,
): Promise<
  ActionResult<{ ticketId: string; totalCents: number; fired: boolean; duplicate: boolean }>
> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  const parsed = orderSchema.safeParse(input)
  if (!parsed.success) return invalid

  const result = await call<{
    ticket_id: string
    total_cents: number
    fired: boolean
    duplicate: boolean
  }>(access, 'pos_send_order', {
    p_session_id: parsed.data.sessionId,
    p_items: parsed.data.items.map((item) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      option_ids: item.option_ids,
      notes: item.notes || null,
    })),
    p_fire: parsed.data.fire,
    p_course: parsed.data.course,
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: {
      ticketId: result.data.ticket_id,
      totalCents: result.data.total_cents,
      fired: result.data.fired,
      duplicate: result.data.duplicate,
    },
  }
}

/** Marchar una tanda que estaba esperando. */
export async function fireTicket(slug: string, ticketId: string): Promise<ActionResult> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  if (!id.safeParse(ticketId).success) return invalid
  const result = await call(access, 'pos_fire_ticket', { p_ticket_id: ticketId })
  return result.ok ? { ok: true } : result
}

const servedSchema = z.object({
  sessionId: id,
  /** Sin productos = toda la mesa. */
  itemIds: z.array(id).max(200).optional(),
  /** false = servir también lo que cocina no marcó listo (bar sin pantalla de cocina). */
  onlyReady: z.boolean().default(true),
})

export async function markServed(
  slug: string,
  input: z.input<typeof servedSchema>,
): Promise<ActionResult<{ served: number }>> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  const parsed = servedSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call<{ served: number }>(access, 'pos_mark_served', {
    p_session_id: parsed.data.sessionId,
    p_item_ids: parsed.data.itemIds?.length ? parsed.data.itemIds : null,
    p_only_ready: parsed.data.onlyReady,
  })
  if (!result.ok) return result
  return { ok: true, data: { served: result.data.served } }
}

export async function cancelItem(
  slug: string,
  itemId: string,
  reason: string | null,
): Promise<ActionResult> {
  const access = await authorize(slug, POS_FLOOR_ROLES)
  if (isDenied(access)) return access
  const cleaned = (reason ?? '').trim().slice(0, 200)
  if (!id.safeParse(itemId).success) return invalid
  const result = await call<{ duplicate: boolean }>(access, 'pos_cancel_item', {
    p_item_id: itemId,
    p_reason: cleaned || null,
  })
  if (!result.ok) return result
  if (!result.data.duplicate) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.item_cancelled',
      entity: 'ticket_item',
      entityId: itemId,
      payload: { reason: cleaned || null },
    })
  }
  return { ok: true }
}

// ─── Cocina ─────────────────────────────────────────────────────────────────

const moveSchema = z
  .object({
    /** Los renglones que se mueven (los de una comanda entera, o uno suelto). */
    itemIds: z.array(id).min(1).max(400),
    /** El paso al que van. */
    to: z.enum(['queued', 'preparing', 'ready']).optional(),
    /** La estación a la que pasan (lo que cambia de estación llega como nuevo). */
    stationId: id.optional(),
  })
  .refine((value) => value.to !== undefined || value.stationId !== undefined)

/**
 * El pase: avanzar, volver atrás o cambiar de estación los renglones de una comanda, en un solo viaje
 * (`pos_kitchen_move`). Es lo que usan las pantallas de cocina: una comanda es una mesa, puede traer
 * varias tandas, y así el mozo recibe UN aviso por estación y no uno por tanda.
 */
export async function kitchenMove(
  slug: string,
  input: z.input<typeof moveSchema>,
): Promise<ActionResult<{ moved: number }>> {
  const access = await authorize(slug, POS_KITCHEN_ROLES)
  if (isDenied(access)) return access
  const parsed = moveSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call<{ moved: number; tickets: number }>(access, 'pos_kitchen_move', {
    p_item_ids: parsed.data.itemIds,
    p_to: parsed.data.to ?? null,
    p_station_id: parsed.data.stationId ?? null,
  })
  if (!result.ok) return result
  // Cambiar algo de estación es corregir a dónde salió un pedido: queda quién fue.
  if (parsed.data.stationId) {
    await logAudit({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'pos.kitchen_rerouted',
      entity: 'kitchen_station',
      entityId: parsed.data.stationId,
      payload: { items: parsed.data.itemIds.length, moved: result.data.moved },
    })
  }
  return { ok: true, data: { moved: result.data.moved } }
}

/** «Cocina lo vio»: una pantalla mostró estas tandas por primera vez. */
export async function kitchenSeen(slug: string, ticketIds: string[]): Promise<ActionResult> {
  const access = await authorize(slug, POS_KITCHEN_ROLES)
  if (isDenied(access)) return access
  const parsed = z.array(id).min(1).max(200).safeParse(ticketIds)
  if (!parsed.success) return invalid
  const result = await call(access, 'pos_kitchen_seen', { p_ticket_ids: parsed.data })
  return result.ok ? { ok: true } : result
}

// ─── Carta ──────────────────────────────────────────────────────────────────

/** Agotado hoy en esta sucursal (se levanta solo al día siguiente). */
export async function setStockout(
  slug: string,
  branchId: string,
  menuItemId: string,
  on: boolean,
): Promise<ActionResult> {
  const access = await authorize(slug, POS_VIEW_ROLES)
  if (isDenied(access)) return access
  if (
    !id.safeParse(branchId).success ||
    !id.safeParse(menuItemId).success ||
    typeof on !== 'boolean'
  ) {
    return invalid
  }
  const result = await call(access, 'pos_set_stockout', {
    p_branch_id: branchId,
    p_menu_item_id: menuItemId,
    p_on: on,
  })
  if (!result.ok) return result
  await logAudit({
    tenantId: access.tenantId,
    userId: access.userId,
    action: on ? 'pos.item_sold_out' : 'pos.item_back',
    entity: 'menu_item',
    entityId: menuItemId,
    payload: { branch_id: branchId },
  })
  return { ok: true }
}
