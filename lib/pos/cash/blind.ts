/**
 * La caja a ciegas — PURO y testeado (`tests/lib/pos-cash-blind.test.ts`).
 *
 * Pedido de los socios (audio del 22/11/2026): «hicimos un cierre de caja, hay un montón de info que
 * no queremos que vea el encargado […] ¿hay posibilidad que cuando cierre la caja esto nos lo mande
 * a nosotros y que no manipule la información el encargado?».
 *
 * Los números del salón (cuánto entró, por qué medio, con y sin factura, el per cápita, cuánto tiene
 * que haber en el cajón, cómo dio el arqueo) son de los SOCIOS. Quien atiende la caja sin serlo la
 * opera igual (abre, cobra, corrige un cobro, saca plata, cuenta y cierra), pero a ciegas: no ve
 * totales ni el resumen. El resumen lo arma el sistema al cerrar y les llega a los socios.
 *
 * Quién es socio: el dueño que tiene acceso completo a Administración. Es la lista que el bar ya
 * mantiene para «quién ve la plata» (Administración › Ajustes › Accesos), así que hay un solo lugar
 * donde se decide. En un bar que no usa Administración, todos los dueños.
 *
 * Acá se decide qué viaja al navegador: lo que no se manda no se puede mostrar ni copiar. No es un
 * candado de la base (quien cobra ve cada cobro que hace, y sumarlos es aritmética): es no ponerle
 * el resumen adelante a quien no le corresponde.
 */
import type { AccountingAccess, TenantRole } from '@/lib/tenant/types'
import type { CloseShiftResult, Shift, ShiftSnapshot, ShiftSummary } from './types'

type NumbersAccess = {
  role: TenantRole
  accounting: Pick<AccountingAccess, 'enabled' | 'setUp' | 'read'> & {
    /** Acceso completo (no «solo compras y pagos»). Hasta que exista el nivel, vale `read`. */
    full?: boolean
  }
}

/** ¿Esta persona ve los números del salón (la caja entera, «Hoy en vivo», lo vendido en el Resumen)? */
export function seesSalonNumbers(access: NumbersAccess): boolean {
  if (access.role !== 'owner') return false
  const acc = access.accounting
  // Sin Administración (o todavía sin configurar) no hay lista de socios: son todos los dueños.
  if (!acc.enabled || !acc.setUp) return true
  return acc.full ?? acc.read
}

/** Los números de un turno, sin los números: queda lo que hace falta para operar. */
export function blindSummary(live: ShiftSummary): ShiftSummary {
  return {
    by_method: [],
    payments_count: live.payments_count,
    sales_cents: 0,
    surcharge_cents: 0,
    tip_cents: 0,
    collected_cents: 0,
    invoiced_cents: 0,
    not_invoiced_cents: 0,
    // Con cuánto se abrió lo sabe quien abrió: lo contó o lo confirmó.
    opening_float_cents: live.opening_float_cents,
    opening_expected_cents: live.opening_expected_cents,
    cash_sales_cents: 0,
    cash_tips_cents: 0,
    cash_in_cents: 0,
    cash_out_cents: 0,
    expected_cash_cents: 0,
    tables: 0,
    people: 0,
    consumption_cents: 0,
    per_person_cents: null,
    discount_cents: 0,
    deposit_cents: 0,
    discounts: [],
    deposits: [],
    item_voids: [],
    payment_voids: [],
    corrections: [],
    // Los retiros y los ingresos los anota la caja: los tiene que poder ver y anular.
    movements: live.movements,
    // Cuántas mesas quedan abiertas es del salón; cuánto deben, no.
    open_tables: { count: live.open_tables.count, pending_cents: 0 },
  }
}

function blindShift(shift: Shift): Shift {
  return {
    ...shift,
    // Lo que contó y lo que dejó lo escribió quien cerró. Cuánto tenía que haber y la diferencia, no.
    expected_cash_cents: null,
    difference_cents: null,
    summary: null,
  }
}

/** La caja como la recibe quien no ve los números. */
export function blindSnapshot(snapshot: ShiftSnapshot): ShiftSnapshot {
  const shift = snapshot.shift ? blindShift(snapshot.shift) : null
  const open = shift?.status === 'open'
  return {
    ...snapshot,
    blind: true,
    // Con el turno cerrado, un cobro lo corrige un socio (no cualquiera con rol de dueño).
    role: 'cashier',
    shift,
    live: snapshot.live ? blindSummary(snapshot.live) : null,
    // Los cobros del turno abierto, para poder corregir uno mal cargado. Nada de otros turnos.
    payments: open ? snapshot.payments.filter((payment) => payment.shift_id === shift?.id) : [],
    registers: snapshot.registers,
    pending_approvals: snapshot.pending_approvals,
  }
}

/** Lo que vuelve de cerrar el turno para quien cerró a ciegas: lo que contó, y nada más. */
export type BlindCloseResult = {
  blind: true
  shift_id: string
  already_closed: boolean
  counted_cash_cents: number
  leave_float_cents: number
  withdrawn_cents: number
}

export function blindCloseResult(result: CloseShiftResult): BlindCloseResult {
  return {
    blind: true,
    shift_id: result.shift_id,
    already_closed: result.already_closed,
    counted_cash_cents: result.counted_cash_cents,
    leave_float_cents: result.leave_float_cents,
    withdrawn_cents: result.withdrawn_cents,
  }
}

export function isBlindClose(
  result: CloseShiftResult | BlindCloseResult,
): result is BlindCloseResult {
  return 'blind' in result && result.blind === true
}
