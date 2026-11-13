/**
 * Los números de «Hoy en vivo» — PURO y testeado (`tests/lib/pos-today-summary.test.ts`).
 *
 * Las mismas reglas que el resumen de la caja (`private.pos_shift_summary`), para que el dueño y el
 * cajero vean el mismo número:
 *   · la venta es lo que bajó de las cuentas (`amountCents`); el recargo de crédito y la propina van
 *     aparte, y un cobro anulado no cuenta;
 *   · mesas, personas y per cápita salen de las cuentas que se cerraron ese día;
 *   · lo de práctica no llega hasta acá (se filtra al leer).
 */

import { cordobaWallTimeToUtc } from '@/lib/dates/zone'
import { PAY_METHODS, type PayMethod } from '@/lib/pos/cash/types'
import type { MethodTotal, ProductTotal, TodayBranch, TodayData, TodaySummary } from './types'

/** Cuántos productos entran en «lo que más salió». */
export const TOP_PRODUCTS = 8

/** `branchId = null` suma todas las sucursales. */
export function summarizeToday(data: TodayData, branchId: string | null): TodaySummary {
  const mine = <T extends { branchId: string }>(rows: ReadonlyArray<T>) =>
    branchId === null ? rows : rows.filter((row) => row.branchId === branchId)

  const payments = mine(data.payments)
  const ok = payments.filter((payment) => payment.status === 'ok')
  let salesCents = 0
  let surchargeCents = 0
  let tipCents = 0
  let invoicedCents = 0
  const methods = new Map<PayMethod, { count: number; cents: number }>()
  for (const payment of ok) {
    salesCents += payment.amountCents
    surchargeCents += payment.surchargeCents
    tipCents += payment.tipCents
    const charged = payment.amountCents + payment.surchargeCents
    if (payment.invoice) invoicedCents += charged
    const entry = methods.get(payment.method) ?? { count: 0, cents: 0 }
    entry.count += 1
    entry.cents += charged
    methods.set(payment.method, entry)
  }
  const charged = salesCents + surchargeCents
  const byMethod: MethodTotal[] = PAY_METHODS.filter((method) => methods.has(method)).map(
    (method) => {
      const entry = methods.get(method) as { count: number; cents: number }
      return {
        method,
        count: entry.count,
        cents: entry.cents,
        share: charged > 0 ? Math.round((entry.cents / charged) * 100) : 0,
      }
    },
  )

  const bills = mine(data.bills)
  let people = 0
  let consumptionCents = 0
  let discountCents = 0
  let discountedTables = 0
  let depositCents = 0
  let memberTables = 0
  let pointsAwarded = 0
  for (const bill of bills) {
    people += bill.partySize ?? 0
    consumptionCents += bill.subtotalCents - bill.discountCents
    discountCents += bill.discountCents
    if (bill.discountCents > 0) discountedTables += 1
    depositCents += bill.depositCents
    if (bill.hasCustomer) memberTables += 1
    pointsAwarded += bill.pointsAwarded
  }

  const open = mine(data.openTables)
  const lines = mine(data.lines)
  const products = new Map<string, ProductTotal>()
  let voidedLines = 0
  let voidedCents = 0
  for (const line of lines) {
    if (line.cancelled) {
      voidedLines += 1
      voidedCents += line.totalCents
      continue
    }
    const entry = products.get(line.menuItemId) ?? {
      menuItemId: line.menuItemId,
      name: line.name,
      quantity: 0,
      cents: 0,
    }
    entry.quantity += line.quantity
    entry.cents += line.totalCents
    products.set(line.menuItemId, entry)
  }
  const topProducts = [...products.values()]
    .sort(
      (a, b) => b.quantity - a.quantity || b.cents - a.cents || a.name.localeCompare(b.name, 'es'),
    )
    .slice(0, TOP_PRODUCTS)

  const shifts = mine(data.shifts)
  const closed = shifts.filter((shift) => shift.status === 'closed')
  const off = closed.filter((shift) => (shift.differenceCents ?? 0) !== 0)

  return {
    salesCents,
    surchargeCents,
    tipCents,
    collectedCents: charged + tipCents,
    payments: ok.length,
    byMethod,
    invoicedCents,
    notInvoicedCents: charged - invoicedCents,
    tables: bills.length,
    people,
    consumptionCents,
    // Al peso: nadie mira centavos en un per cápita.
    perPersonCents: people > 0 ? Math.round(consumptionCents / people / 100) * 100 : null,
    discountCents,
    discountedTables,
    depositCents,
    memberTables,
    pointsAwarded,
    openTables: open.length,
    openCents: open.reduce((sum, table) => sum + table.totalCents, 0),
    waitingBill: open.filter((table) => table.billRequestedAt !== null).length,
    voidedLines,
    voidedCents,
    voidedPayments: payments.filter((payment) => payment.status === 'voided').length,
    correctedPayments: ok.filter((payment) => payment.edits > 0).length,
    shiftsOff: off.length,
    shiftDifferenceCents: off.reduce((sum, shift) => sum + (shift.differenceCents ?? 0), 0),
    openShifts: shifts.filter((shift) => shift.status === 'open').length,
    closedShifts: closed.length,
    topProducts,
  }
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/**
 * La oración que acompaña al número grande. `money` formatea centavos («$ 12.500»); se pasa de
 * afuera para que esto siga siendo puro.
 */
export function todaySentence(
  summary: TodaySummary,
  opts: { isToday: boolean; money: (cents: number) => string },
): string {
  if (summary.payments === 0 && summary.tables === 0) {
    if (!opts.isToday) return 'Ese día no hubo cobros.'
    return summary.openTables > 0
      ? `Todavía no se cobró nada. Hay ${opts.money(summary.openCents)} en ${count(summary.openTables, 'mesa abierta', 'mesas abiertas')}.`
      : 'Todavía no se cobró nada y no hay mesas abiertas.'
  }
  const sold = `${opts.isToday ? 'Es lo que se vendió' : 'Fue lo que se vendió'} en ${count(summary.payments, 'cobro', 'cobros')} de ${count(summary.tables, 'mesa', 'mesas')}.`
  if (!opts.isToday || summary.openTables === 0) return sold
  return `${sold} Hay ${opts.money(summary.openCents)} más en ${count(summary.openTables, 'mesa abierta', 'mesas abiertas')}.`
}

/** Cómo está la caja de una sucursal, en pocas palabras. */
export function shiftWords(
  summary: Pick<TodaySummary, 'openShifts' | 'closedShifts' | 'shiftsOff'>,
  isToday: boolean,
): string {
  if (summary.openShifts > 0) {
    return summary.openShifts === 1 ? 'Caja abierta' : `${summary.openShifts} cajas abiertas`
  }
  if (summary.closedShifts === 0) return isToday ? 'Caja sin abrir' : 'Sin turnos de caja'
  if (summary.shiftsOff === 0) return 'Caja cerrada: cuadró'
  return 'Caja cerrada con diferencia'
}

/** El nombre que entra en una ficha chica. */
export function branchLabel(branch: Pick<TodayBranch, 'name' | 'shortName'>): string {
  return branch.shortName?.trim() || branch.name
}

/** El día anterior y el siguiente de un día `AAAA-MM-DD`. */
export function shiftDay(day: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + delta))
    .toISOString()
    .slice(0, 10)
}

/** ¿Es un día bien escrito y que existe? («2026-02-31» no.) */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return shiftDay(value, 0) === value
}

/** A qué hora cambia el día de servicio: hasta las 5 sigue siendo la noche anterior. */
const ROLLOVER = '05:00'

/**
 * La ventana de tiempo de un día de servicio, como instantes: de las 5 de ese día a las 5 del
 * siguiente (hora del bar). `to` no entra.
 */
export function serviceDayWindow(day: string): { from: string; to: string } {
  return {
    from: cordobaWallTimeToUtc(day, ROLLOVER),
    to: cordobaWallTimeToUtc(shiftDay(day, 1), ROLLOVER),
  }
}
