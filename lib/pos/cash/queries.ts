import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PosError } from '@/lib/pos/errors'
import { createClient } from '@/lib/supabase/server'
import { toCashError } from './errors'
import type { ApprovalsInbox, Bill, ShiftRow, ShiftSnapshot } from './types'

/**
 * Lecturas de cobro y caja. Igual que el resto del punto de venta: UNA ida a la
 * base por pantalla (las RPC `pos_*` devuelven todo armado y chequean el rol
 * adentro, contra el bar de la fila).
 *
 * Las tablas y funciones de `pos_cobro_y_caja` todavía no están en
 * `types/database.ts`, así que van por un cliente sin tipar y se tipan acá.
 */
async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient
}

export type CashRead<T> = { ok: true; data: T } | { ok: false; error: PosError }

async function read<T>(fn: string, args: Record<string, unknown>): Promise<CashRead<T>> {
  const supabase = await untyped()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const parsed = toCashError(error)
    if (parsed.code === 'unknown') console.error(`[pos.${fn}]`, error.code, error.message)
    return { ok: false, error: parsed }
  }
  return { ok: true, data: data as T }
}

/** La cuenta de una mesa: números, renglones, cobros, descuentos y lo que este usuario puede hacer. */
export function getBill(sessionId: string): Promise<CashRead<Bill>> {
  return read<Bill>('pos_bill', { p_session_id: sessionId })
}

/**
 * La caja de una sucursal: el turno abierto (o el último que se cerró), sus
 * números en vivo y los cobros del día. Con `shiftId` se mira un turno puntual;
 * con `practice`, el carril de práctica.
 */
export function getShiftSnapshot(
  branchId: string,
  options: { shiftId?: string | null; practice?: boolean } = {},
): Promise<CashRead<ShiftSnapshot>> {
  return read<ShiftSnapshot>('pos_shift_snapshot', {
    p_branch_id: branchId,
    p_shift_id: options.shiftId ?? null,
    p_practice: options.practice ?? false,
  })
}

/** Los pedidos de descuento y de baja: lo pendiente y lo que se contestó hace poco. */
export function getApprovalsInbox(branchId: string): Promise<CashRead<ApprovalsInbox>> {
  return read<ApprovalsInbox>('pos_approvals_inbox', { p_branch_id: branchId })
}

/**
 * Los últimos turnos de una sucursal, del más nuevo al más viejo (historial).
 * Lectura directa: la política de `pos_shifts` solo deja pasar a dueño y caja.
 */
export async function listShifts(
  branchId: string,
  options: { limit?: number; practice?: boolean } = {},
): Promise<ShiftRow[]> {
  const supabase = await untyped()
  const { data, error } = await supabase
    .from('pos_shifts')
    .select(
      'id, register_id, service_day, label, status, is_practice, opened_at, opened_by_name, opening_float_cents, closed_at, closed_by_name, counted_cash_cents, expected_cash_cents, difference_cents, leave_float_cents',
    )
    .eq('branch_id', branchId)
    .eq('is_practice', options.practice ?? false)
    .order('opened_at', { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 30, 1), 200))
  if (error) {
    console.error('[pos.listShifts]', error.code, error.message)
    return []
  }
  return (data ?? []) as ShiftRow[]
}
