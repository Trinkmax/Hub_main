/**
 * En qué momento está la cuenta — PURO.
 *
 * La pantalla de cobro no es siempre la misma: hay mesas que ya se cobraron, mesas a las que la
 * seña les cubre todo, noches en que la caja todavía no se abrió. De la cuenta que manda la base
 * sale UN momento, y la pantalla muestra lo que se puede hacer en ese y nada más.
 */
import type { Bill } from '@/lib/pos/cash/types'

export type BillMode =
  /** Ya se cobró: sello, puntos y volver al salón. */
  | { kind: 'closed' }
  /** Se juntó con otra o se abandonó: no hay nada que cobrar acá. */
  | { kind: 'gone' }
  /** Abierta y sin consumo: no se cobra, se libera desde la comanda. */
  | { kind: 'empty' }
  /** Quedó cobrado de más (una baja o un descuento después de cobrar). */
  | { kind: 'overpaid'; cents: number; canVoid: boolean }
  /** No falta nada: se cierra sin cobrar. `canClose: false` = la cierra el encargado. */
  | { kind: 'settled'; canClose: boolean; by: 'deposit' | 'discount' | 'both' | 'payments' }
  /** Falta cobrar pero la caja está cerrada. */
  | { kind: 'no_shift' }
  | { kind: 'charging' }

export function billMode(bill: Pick<Bill, 'session' | 'bill' | 'shifts' | 'can'>): BillMode {
  const { session, bill: numbers, shifts, can } = bill
  if (session.status === 'paid') return { kind: 'closed' }
  if (session.status !== 'open') return { kind: 'gone' }
  if (numbers.subtotal_cents === 0 && numbers.paid_cents === 0) return { kind: 'empty' }
  if (numbers.overpaid_cents > 0) {
    return { kind: 'overpaid', cents: numbers.overpaid_cents, canVoid: can.void_payment }
  }
  if (numbers.remaining_cents === 0) {
    const by =
      numbers.paid_cents > 0
        ? 'payments'
        : numbers.deposit_cents > 0 && numbers.discount_cents > 0
          ? 'both'
          : numbers.deposit_cents > 0
            ? 'deposit'
            : 'discount'
    // Una mesa a la que nunca se le cobró nada la cierra quien puede aprobar (lo dice la base).
    return { kind: 'settled', by, canClose: numbers.paid_cents > 0 || can.close_without_payment }
  }
  // Una mesa de práctica se cobra aunque no haya turno: no entra en ninguna caja.
  if (!session.is_practice && shifts.length === 0) return { kind: 'no_shift' }
  return { kind: 'charging' }
}

/** «Mesa 12». Lo que no es una mesa del salón se llama por lo que es. */
export function billTitle(session: Pick<Bill['session'], 'table_label' | 'kind'>): string {
  if (session.table_label) return `Mesa ${session.table_label}`
  return session.kind === 'delivery' ? 'Delivery' : 'Venta rápida'
}

/** A nombre de quién está la mesa: el alias, la reserva o el socio. */
export function billName(bill: Pick<Bill, 'session' | 'reservation' | 'customer'>): string | null {
  const member = bill.customer
    ? `${bill.customer.first_name} ${bill.customer.last_name}`.trim()
    : null
  return bill.session.alias || bill.reservation?.name || member || null
}

/** Cuántos son: los de la mesa o, si nadie los cargó, los de la reserva. */
export function billPeople(bill: Pick<Bill, 'session' | 'reservation'>): number | null {
  const people = bill.session.party_size ?? bill.reservation?.guests ?? null
  return people && people > 0 ? people : null
}
