/**
 * «El sistema recuerda» (Sprint 1, H.5, H.8 y H.9): los valores por defecto
 * de los formularios a partir de lo que ya se cargó. Puro: los datos llegan de
 * `acc_form_defaults`, `acc_quick_expense_suggestions` y
 * `acc_sales_range_defaults`; acá solo se decide la precedencia.
 */

import { addDays, daysBetween, isRealIsoDay } from '@/lib/dates'
import type { Cents, IsoDate, IvaCondition, TreasuryRef, VatRateBp, VoucherType } from './types'

// ─── ¿Con qué pagaste? ───────────────────────────────────────────────────────

export type PickTreasuryInput = {
  treasuries: Iterable<Pick<TreasuryRef, 'id' | 'kind' | 'active'>>
  /** El último pago a ese proveedor (`acc_form_defaults.treasury_account_id`). */
  lastUsedWithParty?: string | null
  /** El último «Nuevo gasto» de esta persona (se guarda en el dispositivo). */
  myLastQuickExpense?: string | null
  /** Orden de las cajas (`sort`): la primera caja de efectivo activa es «Caja». */
  order?: readonly string[]
}

/**
 * Precedencia de H.5: el último medio usado con ese proveedor → mi último
 * «Nuevo gasto» → Caja (la primera de efectivo activa) → la primera activa.
 * Una caja desactivada o que ya no existe se saltea. `null` si no hay ninguna.
 */
export function pickTreasury(input: PickTreasuryInput): string | null {
  const list = [...input.treasuries]
  const active = new Map(list.filter((t) => t.active).map((t) => [t.id, t]))
  for (const candidate of [input.lastUsedWithParty, input.myLastQuickExpense]) {
    if (candidate && active.has(candidate)) return candidate
  }
  const ordered = input.order
    ? [
        ...input.order.flatMap((id) => {
          const t = active.get(id)
          return t ? [t] : []
        }),
        ...[...active.values()].filter((t) => !input.order?.includes(t.id)),
      ]
    : [...active.values()]
  return ordered.find((t) => t.kind === 'cash')?.id ?? ordered[0]?.id ?? null
}

// ─── Plazo de pago ───────────────────────────────────────────────────────────

/** Cuántas facturas seguidas con el mismo plazo hacen falta para proponerlo. */
export const TERM_SUGGESTION_STREAK = 3

/**
 * «¿Le ponemos 30 días de plazo a Coca-Cola?» (H.5): si las últimas 3 facturas
 * (la más nueva primero) vencen con el mismo plazo y ese plazo es distinto del
 * cargado, lo propone. Si no, `null`.
 */
export function suggestPaymentTerm(input: {
  currentTermDays: number
  /** Las facturas más recientes primero, con emisión y vencimiento. */
  recent: ReadonlyArray<{ issueDate: IsoDate; dueDate: IsoDate | null }>
}): number | null {
  const lastThree = input.recent.slice(0, TERM_SUGGESTION_STREAK)
  if (lastThree.length < TERM_SUGGESTION_STREAK) return null
  const terms: number[] = []
  for (const r of lastThree) {
    if (r.dueDate === null || !isRealIsoDay(r.issueDate) || !isRealIsoDay(r.dueDate)) return null
    terms.push(daysBetween(r.issueDate, r.dueDate))
  }
  const first = terms[0]
  if (first === undefined || first < 0 || first > 365) return null
  if (!terms.every((t) => t === first)) return null
  return first === input.currentTermDays ? null : first
}

/** Vencimiento por defecto: emisión + plazo del proveedor. */
export function suggestDueDate(issueDate: IsoDate, termDays: number): IsoDate {
  return addDays(issueDate, Math.max(0, Math.trunc(termDays)))
}

// ─── ¿Un cero de más? ────────────────────────────────────────────────────────

/** Cuántos comprobantes recientes entran en la mediana. */
export const MEDIAN_SAMPLE = 10
/** Factor del aviso: ≥ 10 veces o ≤ un décimo de la mediana. */
export const LOOKS_OFF_FACTOR = 10

/**
 * Mediana de los últimos `MEDIAN_SAMPLE` importes (el más nuevo primero). Con
 * una cantidad par, el promedio de los dos del medio redondeado hacia arriba
 * (entero, sin flotantes). `null` sin datos.
 */
export function medianCents(recentTotals: readonly Cents[]): Cents | null {
  const sample = recentTotals
    .slice(0, MEDIAN_SAMPLE)
    .filter((c) => Number.isSafeInteger(c) && c > 0)
  if (sample.length === 0) return null
  const sorted = [...sample].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? null
  const lo = BigInt(sorted[mid - 1] ?? 0)
  const hi = BigInt(sorted[mid] ?? 0)
  return Number((lo + hi + 1n) / 2n)
}

/**
 * «¿Seguro? Con Coca-Cola solés gastar alrededor de $ 120.000.» (H.5): el
 * importe es 10 veces la mediana o más, o un décimo o menos. Solo avisa (UI).
 */
export function amountLooksOff(amountCents: Cents, medianTotalCents: Cents | null): boolean {
  if (medianTotalCents === null || medianTotalCents <= 0 || amountCents <= 0) return false
  const amount = BigInt(amountCents)
  const median = BigInt(medianTotalCents)
  const factor = BigInt(LOOKS_OFF_FACTOR)
  return amount >= median * factor || amount * factor <= median
}

// ─── Rangos del cierre del día ───────────────────────────────────────────────

/** Último número posible de un comprobante. */
const MAX_VOUCHER_NUMBER = 99_999_999

/**
 * «Desde» = último «hasta» + 1 (H.9): se tipea solo el «hasta». `null` si no
 * hay un rango anterior o si el anterior ya era el último número posible.
 */
export function nextRangeStart(lastNumberTo: number | null | undefined): number | null {
  if (lastNumberTo === null || lastNumberTo === undefined) return null
  if (!Number.isSafeInteger(lastNumberTo) || lastNumberTo < 0) return null
  const next = lastNumberTo + 1
  return next > MAX_VOUCHER_NUMBER ? null : next
}

export type SalesRangeDefault = {
  voucher_type: string
  point_of_sale: number
  channel: string
  last_number_to: number | null
}

/** El «desde» de un tipo y punto de venta a partir de `acc_sales_range_defaults`. */
export function rangeStartFor(
  defaults: readonly SalesRangeDefault[],
  voucherType: string,
  pointOfSale: number,
): number | null {
  const row = defaults.find(
    (d) => d.voucher_type === voucherType && d.point_of_sale === pointOfSale,
  )
  return nextRangeStart(row?.last_number_to ?? null)
}

// ─── Comprobante y alícuota por defecto ──────────────────────────────────────

/**
 * Tipo de comprobante de «Nuevo gasto» y de la factura (H.5): el último con
 * ese proveedor → por su condición (RI: Factura A; monotributo: Factura C;
 * exento: Factura B; el resto, tique) → sin proveedor: «Sin comprobante».
 */
export function pickVoucherType(input: {
  hasParty: boolean
  lastVoucherType?: VoucherType | null
  partyCondition?: IvaCondition | null
}): VoucherType {
  if (!input.hasParty) return 'sin_comprobante'
  if (input.lastVoucherType) return input.lastVoucherType
  switch (input.partyCondition) {
    case 'responsable_inscripto':
      return 'factura_a'
    case 'monotributo':
      return 'factura_c'
    case 'exento':
      return 'factura_b'
    default:
      return 'tique'
  }
}

/**
 * Alícuota por defecto (H.5): la de mayor neto del último comprobante; con un
 * empate, la más alta; sin datos, 21 %.
 */
export function pickVatRate(
  lastNets: ReadonlyArray<{ vatRateBp: VatRateBp; netCents: Cents }>,
): VatRateBp {
  let best: { vatRateBp: VatRateBp; netCents: Cents } | null = null
  const byRate = new Map<VatRateBp, Cents>()
  for (const n of lastNets) byRate.set(n.vatRateBp, (byRate.get(n.vatRateBp) ?? 0) + n.netCents)
  for (const [vatRateBp, netCents] of byRate) {
    if (
      netCents > 0 &&
      (best === null ||
        netCents > best.netCents ||
        (netCents === best.netCents && vatRateBp > best.vatRateBp))
    ) {
      best = { vatRateBp, netCents }
    }
  }
  return best?.vatRateBp ?? 2100
}

/**
 * Fecha contable por defecto (E.5.1 y H.5): la de emisión; si su mes está
 * cerrado, el primer día abierto (con el aviso «Septiembre está cerrado: lo
 * cargamos el 01/10»). `moved` dice si hubo que correrla.
 */
export function pickAccountingDate(
  issueDate: IsoDate,
  firstOpenDate: IsoDate | null,
): { date: IsoDate; moved: boolean } {
  if (firstOpenDate && issueDate < firstOpenDate) return { date: firstOpenDate, moved: true }
  return { date: issueDate, moved: false }
}
