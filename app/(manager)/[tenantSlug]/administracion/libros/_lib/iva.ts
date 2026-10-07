import type { IvaPositionExpected } from '@/lib/accounting/actions/payloads'
import type { FiscalAmountKey, FiscalBook } from '@/lib/accounting/types'

/**
 * Libros IVA en pantalla (H.12, F.4/F.5): qué columnas de importes se ven y
 * los totales de la franja de arriba. La base manda las 22 columnas de cada
 * comprobante (ya firmadas: las notas de crédito y las anulaciones vienen en
 * negativo); en pantalla van solo las que tienen algo en el mes, en el orden
 * del CSV. Puro.
 */

export type IvaColumn = { key: FiscalAmountKey; label: string; short: string }

/** En el orden del CSV (alícuotas de mayor a menor uso, después lo que no es neto). */
export const IVA_COLUMNS: readonly IvaColumn[] = [
  { key: 'net_21_cents', label: 'Neto gravado 21 %', short: 'Neto 21 %' },
  { key: 'vat_21_cents', label: 'IVA 21 %', short: 'IVA 21 %' },
  { key: 'net_105_cents', label: 'Neto gravado 10,5 %', short: 'Neto 10,5 %' },
  { key: 'vat_105_cents', label: 'IVA 10,5 %', short: 'IVA 10,5 %' },
  { key: 'net_27_cents', label: 'Neto gravado 27 %', short: 'Neto 27 %' },
  { key: 'vat_27_cents', label: 'IVA 27 %', short: 'IVA 27 %' },
  { key: 'net_5_cents', label: 'Neto gravado 5 %', short: 'Neto 5 %' },
  { key: 'vat_5_cents', label: 'IVA 5 %', short: 'IVA 5 %' },
  { key: 'net_25_cents', label: 'Neto gravado 2,5 %', short: 'Neto 2,5 %' },
  { key: 'vat_25_cents', label: 'IVA 2,5 %', short: 'IVA 2,5 %' },
  { key: 'net_0_cents', label: 'Neto gravado 0 %', short: 'Neto 0 %' },
  {
    key: 'undiscriminated_cents',
    label: 'Con IVA no discriminado (B, C, tiques)',
    short: 'IVA incluido',
  },
  { key: 'non_taxed_cents', label: 'No gravado', short: 'No gravado' },
  { key: 'exempt_cents', label: 'Exento', short: 'Exento' },
  { key: 'perc_iva_cents', label: 'Percepción de IVA', short: 'Perc. IVA' },
  { key: 'perc_iibb_cents', label: 'Percepción de IIBB', short: 'Perc. IIBB' },
  { key: 'perc_ganancias_cents', label: 'Percepción de Ganancias', short: 'Perc. Ganancias' },
  { key: 'perc_municipal_cents', label: 'Percepción municipal', short: 'Perc. municipal' },
  { key: 'internal_taxes_cents', label: 'Impuestos internos', short: 'Imp. internos' },
  { key: 'other_taxes_cents', label: 'Otros tributos', short: 'Otros' },
]

const TOTAL: IvaColumn = { key: 'total_cents', label: 'Total', short: 'Total' }
const COMPUTABLE: IvaColumn = {
  key: 'vat_computable_cents',
  label: 'Crédito fiscal computable',
  short: 'Computable',
}

type Amounts = Readonly<Record<FiscalAmountKey, number>>

/**
 * Las columnas que se ven: las que tienen algo en el mes (los totales) o en
 * esta página (un mes puede netear cero con una factura y su nota de crédito),
 * más el total; en compras, el crédito computable si difiere del IVA.
 */
export function visibleIvaColumns(
  book: FiscalBook,
  totals: Amounts,
  rows: ReadonlyArray<{ amounts: Amounts }>,
): IvaColumn[] {
  const used = (key: FiscalAmountKey) =>
    totals[key] !== 0 || rows.some((row) => row.amounts[key] !== 0)
  const out = IVA_COLUMNS.filter((c) => used(c.key))
  out.push(TOTAL)
  if (book === 'purchases') {
    const summary = ivaSummary(totals)
    if (used('vat_computable_cents') && summary.computableCents !== summary.vatCents) {
      out.push(COMPUTABLE)
    }
  }
  return out
}

export type IvaSummary = {
  /** Neto gravado de todas las alícuotas. */
  netCents: number
  /** IVA de todas las alícuotas. */
  vatCents: number
  /** Percepciones (IVA, IIBB, Ganancias y municipales). */
  perceptionsCents: number
  /** No gravado, exento, IVA incluido sin discriminar, internos y otros. */
  otherCents: number
  totalCents: number
  /** Crédito fiscal computable (compras). */
  computableCents: number
}

export function ivaSummary(a: Amounts): IvaSummary {
  return {
    netCents:
      a.net_21_cents +
      a.net_105_cents +
      a.net_27_cents +
      a.net_5_cents +
      a.net_25_cents +
      a.net_0_cents,
    vatCents: a.vat_21_cents + a.vat_105_cents + a.vat_27_cents + a.vat_5_cents + a.vat_25_cents,
    perceptionsCents:
      a.perc_iva_cents + a.perc_iibb_cents + a.perc_ganancias_cents + a.perc_municipal_cents,
    otherCents:
      a.undiscriminated_cents +
      a.non_taxed_cents +
      a.exempt_cents +
      a.internal_taxes_cents +
      a.other_taxes_cents,
    totalCents: a.total_cents,
    computableCents: a.vat_computable_cents,
  }
}

/**
 * Las cifras de la posición que vio la persona, como las piden `closePeriod` y
 * `generateIvaSettlement` (si la base calcula otra cosa bajo el lock, contesta
 * que cambió algo y la pantalla se recarga).
 */
export function ivaExpectedFrom(p: {
  debitFiscal: { totalCents: number }
  creditFiscal: { totalCents: number }
  perceptionsCents: number
  withholdingsCents: number
  toPayCents: number
  technicalBalanceNewCents: number
  freeBalanceNewCents: number
}): IvaPositionExpected {
  return {
    debitCents: p.debitFiscal.totalCents,
    creditCents: p.creditFiscal.totalCents,
    perceptionsCents: p.perceptionsCents,
    withholdingsCents: p.withholdingsCents,
    toPayCents: p.toPayCents,
    technicalBalanceNewCents: p.technicalBalanceNewCents,
    freeBalanceNewCents: p.freeBalanceNewCents,
  }
}

/** `{"2100": 130000000, "1050": 1040000}` → filas «21 %», «10,5 %», de mayor a menor alícuota, sin ceros. */
export function rateRows(byRate: Readonly<Record<string, number>>): Array<{
  bp: number
  cents: number
}> {
  return Object.entries(byRate)
    .map(([rate, cents]) => ({ bp: Number(rate), cents }))
    .filter((r) => Number.isFinite(r.bp) && r.cents !== 0)
    .sort((a, b) => b.bp - a.bp)
}
