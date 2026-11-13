'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
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
  ;(await cookies()).set(branchCookieName(access.tenantId), branchId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
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

const advanceSchema = z.object({
  ticketId: id,
  to: z.enum(['queued', 'preparing', 'ready']),
  stationIds: z.array(id).max(20).optional(),
})

export async function kitchenAdvance(
  slug: string,
  input: z.input<typeof advanceSchema>,
): Promise<ActionResult<{ status: string; moved: number }>> {
  const access = await authorize(slug, POS_KITCHEN_ROLES)
  if (isDenied(access)) return access
  const parsed = advanceSchema.safeParse(input)
  if (!parsed.success) return invalid
  const result = await call<{ status: string; moved: number }>(access, 'pos_kitchen_advance', {
    p_ticket_id: parsed.data.ticketId,
    p_to: parsed.data.to,
    p_station_ids: parsed.data.stationIds?.length ? parsed.data.stationIds : null,
  })
  if (!result.ok) return result
  return { ok: true, data: { status: result.data.status, moved: result.data.moved } }
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
