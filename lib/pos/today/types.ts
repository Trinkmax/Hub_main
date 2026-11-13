/**
 * Formas de «Hoy en vivo» (`/[bar]/local/hoy`): lo que el dueño mira desde el celular para saber
 * cómo va el día en cada sucursal. Todo sale de lo que el salón ya cargó (cobros, mesas, comandas,
 * turnos de caja): nadie escribe nada para que esta pantalla exista.
 *
 * La plata va siempre en CENTAVOS enteros; la pantalla muestra pesos.
 */

import type { PayMethod } from '@/lib/pos/cash/types'

export type TodayBranch = {
  id: string
  name: string
  shortName: string | null
  slug: string
  color: string
}

/** Un cobro del día. `amountCents` es lo que bajó de la cuenta; recargo y propina van aparte. */
export type TodayPayment = {
  id: string
  branchId: string
  sessionId: string
  shiftId: string | null
  method: PayMethod
  amountCents: number
  surchargeCents: number
  tipCents: number
  invoice: boolean
  status: 'ok' | 'voided'
  createdAt: string
  /** Cuántas veces se corrigió (el medio, la factura o el recargo). */
  edits: number
}

/** Una mesa cobrada: la cuenta como quedó al cerrar. */
export type TodayBill = {
  sessionId: string
  branchId: string
  partySize: number | null
  subtotalCents: number
  discountCents: number
  depositCents: number
  dueCents: number
  closedAt: string
  hasCustomer: boolean
  pointsAwarded: number
}

export type TodayShift = {
  id: string
  branchId: string
  label: string | null
  status: 'open' | 'closed'
  openedAt: string
  openedByName: string
  closedAt: string | null
  closedByName: string | null
  /** Con el turno cerrado: lo contado menos lo que tenía que haber. */
  differenceCents: number | null
}

/** Una mesa que sigue abierta ahora. */
export type TodayOpenTable = {
  sessionId: string
  branchId: string
  partySize: number | null
  totalCents: number
  openedAt: string
  billRequestedAt: string | null
}

/** Un renglón de una comanda del día (vivo o dado de baja). */
export type TodayLine = {
  branchId: string
  menuItemId: string
  name: string
  quantity: number
  totalCents: number
  cancelled: boolean
}

/** Todo lo leído, de una vez. */
export type TodayData = {
  /** El día de servicio que se mira (`2026-11-13`). */
  day: string
  /** Es el día de servicio en curso. */
  isToday: boolean
  /** Reloj del servidor al leer (ms). */
  loadedAt: number
  branches: TodayBranch[]
  payments: TodayPayment[]
  bills: TodayBill[]
  shifts: TodayShift[]
  /** Solo cuando se mira el día en curso. */
  openTables: TodayOpenTable[]
  lines: TodayLine[]
}

export type MethodTotal = {
  method: PayMethod
  count: number
  /** Venta + recargo: lo que se cobró por ese medio, sin propinas. */
  cents: number
  /** De 0 a 100, sobre lo cobrado sin propinas. */
  share: number
}

export type ProductTotal = { menuItemId: string; name: string; quantity: number; cents: number }

/** Los números de una sucursal (o de todas juntas) en un día. */
export type TodaySummary = {
  /** Lo que bajó de las cuentas: la venta. */
  salesCents: number
  surchargeCents: number
  tipCents: number
  /** Venta + recargo + propinas: la plata que entró. */
  collectedCents: number
  payments: number
  byMethod: MethodTotal[]
  /** Venta + recargo que se factura, y la que no. */
  invoicedCents: number
  notInvoicedCents: number
  /** Mesas cobradas. */
  tables: number
  people: number
  /** Consumo de las mesas cobradas, menos descuentos. */
  consumptionCents: number
  /** Consumo por persona, redondeado al peso. `null` si no hay personas anotadas. */
  perPersonCents: number | null
  discountCents: number
  /** Cuántas mesas cobradas tuvieron descuento. */
  discountedTables: number
  /** Señas que se descontaron: plata que no pasó por la caja hoy. */
  depositCents: number
  /** Mesas con socio, y los puntos que sumaron. */
  memberTables: number
  pointsAwarded: number
  openTables: number
  openCents: number
  /** De las abiertas, las que ya pidieron la cuenta. */
  waitingBill: number
  /** Renglones dados de baja y lo que sumaban. */
  voidedLines: number
  voidedCents: number
  /** Cobros anulados y cobros corregidos. */
  voidedPayments: number
  correctedPayments: number
  /** Turnos que cerraron con diferencia, y cuánto en total (con signo). */
  shiftsOff: number
  shiftDifferenceCents: number
  openShifts: number
  closedShifts: number
  topProducts: ProductTotal[]
}
