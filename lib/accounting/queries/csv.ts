/**
 * CSV de Administración (§F.15): encabezados y filas de cada libro, puros
 * (sin I/O, sin `server-only`). Pantalla = CSV: las filas salen de los mismos
 * tipos que devuelven las lecturas (`./books`, `./parties`…), en centavos.
 *
 * Formato (lo resuelve `lib/csv`): `;` + BOM + CRLF; plata `-1234,50` (coma
 * decimal, sin miles, nunca `c / 100`); fechas `dd/MM/yyyy`; todo texto pasa
 * por `csvFormulaGuard`; los números nunca; CUIT como texto; NC y anulaciones
 * en negativo en los libros IVA; una fila `Totales` al pie.
 */

import type { CsvCell } from '@/lib/csv/write'
import { csvDate, csvMoney, csvNumber } from '@/lib/csv/write'
import { formatDateTime } from '@/lib/dates/format'
import { formatCentsCsv } from '@/lib/money/format'
import type { SubledgerColumn } from './columns'
import { CHANNEL_LABELS, entryKindLabel, TREASURY_KIND_LABELS } from './labels'

// Tipos mínimos de entrada (estructurales: los cumplen las filas de las lecturas).

type JournalLineIn = {
  accountCode: string
  accountName: string
  partyId: string | null
  partyName: string | null
  partyTaxId: string | null
  memo: string | null
  debitCents: number
  creditCents: number
}

type JournalEntryIn = {
  number: number | null
  numberIsProvisional: boolean
  entryDate: string
  kind: string
  description: string
  documentLabel: string
  documentSeq: number
  createdByName: string
  lines: readonly JournalLineIn[]
}

type LedgerRowIn = {
  rowKind: 'opening' | 'line'
  entryNumber: number | null
  numberIsProvisional: boolean
  entryDate: string | null
  documentLabel: string | null
  documentSeq: number | null
  description: string | null
  partyName: string | null
  dueDate: string | null
  memo: string | null
  debitCents: number
  creditCents: number
  runningBalanceCents: number
}

export type CsvRow = CsvCell[]

/** «Sí» / «No». */
function yesNo(value: boolean): string {
  return value ? 'Sí' : 'No'
}

/** Un saldo con signo (Debe − Haber) → valor absoluto + «D» / «A» (vacío si es cero). */
export function sideCells(balanceCents: number): [CsvCell, CsvCell] {
  if (balanceCents === 0) return [csvMoney(0), '']
  return [csvMoney(Math.abs(balanceCents)), balanceCents > 0 ? 'D' : 'A']
}

const IVA_CONDITION_LABELS: Readonly<Record<string, string>> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributo: 'Monotributo',
  exento: 'Exento',
  consumidor_final: 'Consumidor final',
  no_alcanzado: 'No alcanzado',
  sin_datos: 'Sin datos',
}

export function ivaConditionLabel(value: string | null | undefined): string {
  if (!value) return ''
  return IVA_CONDITION_LABELS[value] ?? value
}

function channelLabel(value: string | null | undefined): string {
  if (!value) return ''
  return CHANNEL_LABELS[value] ?? value
}

// ─── Diario (F.1) ────────────────────────────────────────────────────────────

export const JOURNAL_HEADERS = [
  'N° asiento',
  'Provisorio',
  'Fecha',
  'Tipo de asiento',
  'Concepto',
  'Código de cuenta',
  'Cuenta',
  'Partícipe',
  'CUIT',
  'Debe',
  'Haber',
  'Leyenda',
  'Comprobante',
  'Ref. interna',
  'Cargado por',
] as const

/** Una fila por línea del asiento. `taxIdOf` completa el CUIT si la base no lo trae. */
export function journalCsvRows(
  entry: JournalEntryIn,
  taxIdOf: (partyId: string | null) => string | null = () => null,
): CsvRow[] {
  return entry.lines.map((line) => [
    entry.number,
    yesNo(entry.numberIsProvisional),
    csvDate(entry.entryDate),
    entryKindLabel(entry.kind),
    entry.description,
    line.accountCode,
    line.accountName,
    line.partyName,
    line.partyTaxId ?? taxIdOf(line.partyId),
    csvMoney(line.debitCents),
    csvMoney(line.creditCents),
    line.memo,
    entry.documentLabel,
    entry.documentSeq,
    entry.createdByName,
  ])
}

export function journalTotalsRow(debitCents: number, creditCents: number): CsvRow {
  return [
    'Totales',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    csvMoney(debitCents),
    csvMoney(creditCents),
  ]
}

// ─── Mayor (F.2) ─────────────────────────────────────────────────────────────

export const LEDGER_HEADERS = [
  'Fecha',
  'N° asiento',
  'Provisorio',
  'Comprobante',
  'Ref. interna',
  'Concepto',
  'Partícipe',
  'Vence',
  'Debe',
  'Haber',
  'Saldo',
  'D/A',
] as const

export function ledgerCsvRow(row: LedgerRowIn): CsvRow {
  const [saldo, da] = sideCells(row.runningBalanceCents)
  if (row.rowKind === 'opening') {
    return [
      csvDate(row.entryDate),
      null,
      null,
      'Saldo anterior',
      null,
      null,
      null,
      null,
      null,
      null,
      saldo,
      da,
    ]
  }
  return [
    csvDate(row.entryDate),
    row.entryNumber,
    yesNo(row.numberIsProvisional),
    row.documentLabel,
    row.documentSeq,
    row.memo || row.description,
    row.partyName,
    csvDate(row.dueDate),
    csvMoney(row.debitCents),
    csvMoney(row.creditCents),
    saldo,
    da,
  ]
}

/** `Totales` del mayor: Σ Debe, Σ Haber y el saldo final con D/A. */
export function ledgerTotalsRow(
  debitCents: number,
  creditCents: number,
  closingCents: number | null,
): CsvRow {
  const [saldo, da] = closingCents === null ? [null, null] : sideCells(closingCents)
  return [
    null,
    null,
    null,
    'Totales',
    null,
    null,
    null,
    null,
    csvMoney(debitCents),
    csvMoney(creditCents),
    saldo,
    da,
  ]
}

/** El mayor general: la cuenta adelante de cada fila (se puede filtrar en Excel). */
export const GENERAL_LEDGER_HEADERS = ['Código de cuenta', 'Cuenta', ...LEDGER_HEADERS] as const

export function generalLedgerCsvRow(
  account: { code: string; name: string },
  row: LedgerRowIn,
): CsvRow {
  return [account.code, account.name, ...ledgerCsvRow(row)]
}

export function generalLedgerTotalRow(
  account: { code: string; name: string },
  debitCents: number,
  creditCents: number,
  closingCents: number,
): CsvRow {
  const [saldo, da] = sideCells(closingCents)
  return [
    account.code,
    account.name,
    null,
    null,
    null,
    `Total ${account.code}`,
    null,
    null,
    null,
    null,
    csvMoney(debitCents),
    csvMoney(creditCents),
    saldo,
    da,
  ]
}

// ─── Sumas y saldos (F.3) ────────────────────────────────────────────────────

export const TRIAL_BALANCE_HEADERS = [
  'Código',
  'Cuenta',
  'Nivel',
  'Imputable',
  'Saldo inicial deudor',
  'Saldo inicial acreedor',
  'Debe del período',
  'Haber del período',
  'Saldo deudor',
  'Saldo acreedor',
] as const

type TrialRowIn = {
  code: string
  name: string
  level: number
  postable: boolean
  isVirtual: boolean
  openingDebitCents: number
  openingCreditCents: number
  periodDebitCents: number
  periodCreditCents: number
  closingDebitCents: number
  closingCreditCents: number
}

export function trialBalanceCsvRow(row: TrialRowIn): CsvRow {
  return [
    row.code,
    row.name,
    row.level,
    row.isVirtual ? '' : yesNo(row.postable),
    csvMoney(row.openingDebitCents),
    csvMoney(row.openingCreditCents),
    csvMoney(row.periodDebitCents),
    csvMoney(row.periodCreditCents),
    csvMoney(row.closingDebitCents),
    csvMoney(row.closingCreditCents),
  ]
}

export function trialBalanceTotalsRow(
  t: Omit<TrialRowIn, 'code' | 'name' | 'level' | 'postable' | 'isVirtual'>,
): CsvRow {
  return [
    'Totales',
    null,
    null,
    null,
    csvMoney(t.openingDebitCents),
    csvMoney(t.openingCreditCents),
    csvMoney(t.periodDebitCents),
    csvMoney(t.periodCreditCents),
    csvMoney(t.closingDebitCents),
    csvMoney(t.closingCreditCents),
  ]
}

// ─── Libros IVA (F.4, F.5, F.5b) ─────────────────────────────────────────────

type IvaRowIn = {
  voucherDate: string
  voucherLabel: string
  afipVoucherCode: number | null
  pointOfSale: number
  numberFrom: number
  numberTo: number | null
  counterpartyName: string
  counterpartyDocType: number
  counterpartyDocNumber: string
  counterpartyIvaCondition: string
  channel: string | null
  amounts: Readonly<Record<string, number>>
  accountingDate: string
  documentSeq: number
}

/** Columnas de importe del Libro IVA compras, en orden (clave de `acc_fiscal_vouchers`). */
export const IVA_PURCHASES_AMOUNT_COLUMNS = [
  ['Neto gravado 21%', 'net_21_cents'],
  ['IVA 21%', 'vat_21_cents'],
  ['Neto gravado 10,5%', 'net_105_cents'],
  ['IVA 10,5%', 'vat_105_cents'],
  ['Neto gravado 27%', 'net_27_cents'],
  ['IVA 27%', 'vat_27_cents'],
  ['Neto gravado 5%', 'net_5_cents'],
  ['IVA 5%', 'vat_5_cents'],
  ['Neto gravado 2,5%', 'net_25_cents'],
  ['IVA 2,5%', 'vat_25_cents'],
  ['Neto gravado 0%', 'net_0_cents'],
  ['Importe con IVA no discriminado (B, C, tiques)', 'undiscriminated_cents'],
  ['No gravado', 'non_taxed_cents'],
  ['Exento', 'exempt_cents'],
  ['Percepción IVA', 'perc_iva_cents'],
  ['Percepción IIBB', 'perc_iibb_cents'],
  ['Percepción Ganancias', 'perc_ganancias_cents'],
  ['Percepción municipal', 'perc_municipal_cents'],
  ['Impuestos internos', 'internal_taxes_cents'],
  ['Otros tributos', 'other_taxes_cents'],
  ['Total', 'total_cents'],
  ['Crédito fiscal computable', 'vat_computable_cents'],
] as const

export const IVA_PURCHASES_HEADERS = [
  'Fecha',
  'Tipo',
  'Código AFIP',
  'Punto de venta',
  'Número',
  'Proveedor',
  'CUIT',
  'Condición IVA',
  ...IVA_PURCHASES_AMOUNT_COLUMNS.map(([header]) => header),
  'Fecha contable',
  'Ref. interna',
] as const

export function ivaPurchasesCsvRow(row: IvaRowIn): CsvRow {
  return [
    csvDate(row.voucherDate),
    row.voucherLabel,
    row.afipVoucherCode,
    row.pointOfSale,
    row.numberFrom,
    row.counterpartyName,
    row.counterpartyDocNumber,
    ivaConditionLabel(row.counterpartyIvaCondition),
    ...IVA_PURCHASES_AMOUNT_COLUMNS.map(([, key]) => csvMoney(row.amounts[key] ?? 0)),
    csvDate(row.accountingDate),
    row.documentSeq,
  ]
}

export const IVA_SALES_AMOUNT_COLUMNS = [
  ['Neto gravado 21%', 'net_21_cents'],
  ['IVA 21%', 'vat_21_cents'],
  ['Neto gravado 10,5%', 'net_105_cents'],
  ['IVA 10,5%', 'vat_105_cents'],
  ['Neto gravado 27%', 'net_27_cents'],
  ['IVA 27%', 'vat_27_cents'],
  ['Neto gravado 0%', 'net_0_cents'],
  ['No gravado', 'non_taxed_cents'],
  ['Exento', 'exempt_cents'],
  ['Total', 'total_cents'],
] as const

export const IVA_SALES_HEADERS = [
  'Fecha',
  'Tipo',
  'Código AFIP',
  'Punto de venta',
  'Número desde',
  'Número hasta',
  'Cliente',
  'Tipo de documento',
  'Número de documento',
  'Condición IVA',
  'Canal',
  ...IVA_SALES_AMOUNT_COLUMNS.map(([header]) => header),
  'Ref. interna',
] as const

export function ivaSalesCsvRow(row: IvaRowIn): CsvRow {
  return [
    csvDate(row.voucherDate),
    row.voucherLabel,
    row.afipVoucherCode,
    row.pointOfSale,
    row.numberFrom,
    row.numberTo ?? row.numberFrom,
    row.counterpartyName,
    row.counterpartyDocType,
    row.counterpartyDocNumber,
    ivaConditionLabel(row.counterpartyIvaCondition),
    channelLabel(row.channel),
    ...IVA_SALES_AMOUNT_COLUMNS.map(([, key]) => csvMoney(row.amounts[key] ?? 0)),
    row.documentSeq,
  ]
}

/** La fila `Totales` de un libro IVA: vacía hasta las columnas de importe. */
export function ivaTotalsRow(
  leadingColumns: number,
  columns: ReadonlyArray<readonly [string, string]>,
  totals: Readonly<Record<string, number>>,
  trailingColumns: number,
): CsvRow {
  return [
    'Totales',
    ...Array.from({ length: leadingColumns - 1 }, () => null),
    ...columns.map(([, key]) => csvMoney(totals[key] ?? 0)),
    ...Array.from({ length: trailingColumns }, () => null),
  ]
}

export const IVA_ALIQUOTS_HEADERS = [
  'Tipo',
  'Código AFIP',
  'Punto de venta',
  'Número desde',
  'Número hasta',
  'CUIT/Doc',
  'Código de alícuota',
  'Neto gravado',
  'IVA',
] as const

export function ivaAliquotCsvRow(row: {
  voucherLabel: string
  afipVoucherCode: number | null
  pointOfSale: number
  numberFrom: number
  numberTo: number | null
  counterpartyDocNumber: string
  aliquotCode: number
  netCents: number
  vatCents: number
}): CsvRow {
  return [
    row.voucherLabel,
    row.afipVoucherCode,
    row.pointOfSale,
    row.numberFrom,
    row.numberTo ?? row.numberFrom,
    row.counterpartyDocNumber,
    row.aliquotCode,
    csvMoney(row.netCents),
    csvMoney(row.vatCents),
  ]
}

// ─── Posición de IVA (F.6) ───────────────────────────────────────────────────

export const IVA_POSITION_HEADERS = ['Concepto', 'Alícuota', 'Importe'] as const

type PositionIn = {
  debitFiscal: { byRate: Readonly<Record<string, number>>; totalCents: number }
  creditFiscal: { byRate: Readonly<Record<string, number>>; totalCents: number }
  technicalBalancePrevCents: number
  freeBalancePrevCents: number
  perceptionsCents: number
  withholdingsCents: number
  technicalBalanceCents: number
  toPayCents: number
  technicalBalanceNewCents: number
  freeBalanceNewCents: number
  pendingDocumentationCents: number
  reconciliation: {
    differences: ReadonlyArray<{ label: string; vatCreditCents: number; vatDebitCents: number }>
  }
}

/** `2100` → `21%` (como en los encabezados de los libros). */
function rateCell(bp: string): string {
  const n = Number(bp)
  if (!Number.isFinite(n)) return bp
  return `${String(n / 100).replace('.', ',')}%`
}

function byRateRows(label: string, byRate: Readonly<Record<string, number>>): CsvRow[] {
  return Object.entries(byRate)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([bp, cents]) => [label, rateCell(bp), csvMoney(cents)])
}

export function ivaPositionCsvRows(p: PositionIn): CsvRow[] {
  return [
    ...byRateRows('Débito fiscal', p.debitFiscal.byRate),
    ['Débito fiscal total', null, csvMoney(p.debitFiscal.totalCents)],
    ...byRateRows('Crédito fiscal', p.creditFiscal.byRate),
    ['Crédito fiscal total', null, csvMoney(p.creditFiscal.totalCents)],
    ['Saldo técnico del mes anterior', null, csvMoney(p.technicalBalancePrevCents)],
    ['Saldo técnico', null, csvMoney(p.technicalBalanceCents)],
    ['Percepciones de IVA', null, csvMoney(p.perceptionsCents)],
    ['Retenciones de IVA', null, csvMoney(p.withholdingsCents)],
    ['Libre disponibilidad del mes anterior', null, csvMoney(p.freeBalancePrevCents)],
    ['IVA a pagar', null, csvMoney(p.toPayCents)],
    ['Saldo técnico a favor', null, csvMoney(p.technicalBalanceNewCents)],
    ['Libre disponibilidad', null, csvMoney(p.freeBalanceNewCents)],
    ['IVA de comisiones a documentar (informativo)', null, csvMoney(p.pendingDocumentationCents)],
    ...p.reconciliation.differences.map(
      (d): CsvRow => [
        `Diferencia de conciliación: ${d.label}`,
        null,
        csvMoney(d.vatCreditCents - d.vatDebitCents),
      ],
    ),
  ]
}

// ─── Estados de cuenta y saldos (F.7) ────────────────────────────────────────

/** Proveedor: «Facturas/Pagos»; cliente: «Ventas/Cobros». */
export function statementHeaders(group: 'payables' | 'receivables'): string[] {
  const [up, down] = group === 'payables' ? ['Facturas', 'Pagos'] : ['Ventas', 'Cobros']
  return [
    'Fecha',
    'Comprobante',
    'Ref. interna',
    'Vence',
    up,
    down,
    'Saldo',
    'Pendiente de la partida',
  ]
}

export function statementCsvRow(row: {
  rowKind: 'opening' | 'line'
  entryDate: string | null
  documentLabel: string | null
  documentSeq: number | null
  dueDate: string | null
  increaseCents: number
  decreaseCents: number
  runningBalanceCents: number
  openCents: number | null
}): CsvRow {
  if (row.rowKind === 'opening') {
    return [
      csvDate(row.entryDate),
      'Saldo anterior',
      null,
      null,
      null,
      null,
      csvMoney(row.runningBalanceCents),
      null,
    ]
  }
  return [
    csvDate(row.entryDate),
    row.documentLabel,
    row.documentSeq,
    csvDate(row.dueDate),
    csvMoney(row.increaseCents),
    csvMoney(row.decreaseCents),
    csvMoney(row.runningBalanceCents),
    row.openCents === null ? null : csvMoney(row.openCents),
  ]
}

export const PARTY_BALANCES_HEADERS = [
  'Partícipe',
  'CUIT',
  'Deuda',
  'A favor',
  'Neto',
  'Al día',
  'Vence en 7 días',
  'Vencido 1-30',
  'Vencido 31-60',
  'Vencido +60',
  'Sin vencimiento',
  'Vencimiento más viejo',
  'Próximo vencimiento',
  'Estado',
] as const

type PartyBalanceIn = {
  partyName: string
  taxId: string | null
  debtCents: number
  creditCents: number
  netCents: number
  notDueCents: number
  dueSoonCents: number
  overdue1to30Cents: number
  overdue31to60Cents: number
  overdue60PlusCents: number
  noDueCents: number
  oldestDueDate: string | null
  nextDueDate: string | null
  trafficText: string
}

export function partyBalanceCsvRow(row: PartyBalanceIn): CsvRow {
  return [
    row.partyName,
    row.taxId,
    csvMoney(row.debtCents),
    csvMoney(row.creditCents),
    csvMoney(row.netCents),
    csvMoney(row.notDueCents),
    csvMoney(row.dueSoonCents),
    csvMoney(row.overdue1to30Cents),
    csvMoney(row.overdue31to60Cents),
    csvMoney(row.overdue60PlusCents),
    csvMoney(row.noDueCents),
    csvDate(row.oldestDueDate),
    csvDate(row.nextDueDate),
    row.trafficText,
  ]
}

export function partyBalancesTotalsRow(rows: readonly PartyBalanceIn[]): CsvRow {
  const sum = (pick: (r: PartyBalanceIn) => number) => rows.reduce((t, r) => t + pick(r), 0)
  return [
    'Totales',
    null,
    csvMoney(sum((r) => r.debtCents)),
    csvMoney(sum((r) => r.creditCents)),
    csvMoney(sum((r) => r.netCents)),
    csvMoney(sum((r) => r.notDueCents)),
    csvMoney(sum((r) => r.dueSoonCents)),
    csvMoney(sum((r) => r.overdue1to30Cents)),
    csvMoney(sum((r) => r.overdue31to60Cents)),
    csvMoney(sum((r) => r.overdue60PlusCents)),
    csvMoney(sum((r) => r.noDueCents)),
  ]
}

// ─── Cajas, flujo, neto por medio, ventas sin factura (F.9, F.11, F.12) ─────

export const TREASURY_BALANCES_HEADERS = [
  'Cuenta',
  'Tipo',
  'Saldo',
  'Por acreditar',
  'Último movimiento',
  'Último ajuste',
] as const

export function treasuryBalanceCsvRow(row: {
  name: string
  kind: string
  balanceCents: number
  pendingWalletCents: number
  lastMovementDate: string | null
  lastCheckedOn: string | null
}): CsvRow {
  return [
    row.name,
    TREASURY_KIND_LABELS[row.kind] ?? row.kind,
    csvMoney(row.balanceCents),
    csvMoney(row.pendingWalletCents),
    csvDate(row.lastMovementDate),
    csvDate(row.lastCheckedOn),
  ]
}

export const CASH_FLOW_HEADERS = ['Mes', 'Categoría', 'Entró', 'Salió', 'Neto'] as const

export function cashFlowCsvRow(row: {
  month: string
  categoryLabel: string
  inflowCents: number
  outflowCents: number
}): CsvRow {
  return [
    row.month.slice(0, 7),
    row.categoryLabel,
    csvMoney(row.inflowCents),
    csvMoney(row.outflowCents),
    csvMoney(row.inflowCents - row.outflowCents),
  ]
}

export const NET_BY_METHOD_HEADERS = [
  'Medio',
  'Canal',
  'Vendido',
  'Comisión',
  'IVA comisión',
  'Retenciones',
  'Otros cargos',
  'Sin explicar',
  'Acreditado neto',
  'Pendiente',
  'Descuento %',
] as const

type NetByMethodIn = {
  methodName: string
  channel: string
  soldCents: number
  commissionCents: number
  commissionVatCents: number
  withholdingsCents: number
  otherChargesCents: number
  unexplainedCents: number
  creditedCents: number
  pendingCents: number
  discountBp: number | null
}

export function netByMethodCsvRow(row: NetByMethodIn): CsvRow {
  return [
    row.methodName,
    channelLabel(row.channel),
    csvMoney(row.soldCents),
    csvMoney(row.commissionCents),
    csvMoney(row.commissionVatCents),
    csvMoney(row.withholdingsCents),
    csvMoney(row.otherChargesCents),
    csvMoney(row.unexplainedCents),
    csvMoney(row.creditedCents),
    csvMoney(row.pendingCents),
    row.discountBp === null ? null : csvNumber(row.discountBp / 100),
  ]
}

export const SALES_SUMMARY_HEADERS = [
  'Mes',
  'Canal',
  'Vendido',
  'Facturado neto',
  'IVA débito',
  'Sin factura',
] as const

export function salesSummaryCsvRow(row: {
  month: string
  channel: string
  soldCents: number
  invoicedNetCents: number
  vatCents: number
  uninvoicedCents: number
}): CsvRow {
  return [
    row.month.slice(0, 7),
    channelLabel(row.channel),
    csvMoney(row.soldCents),
    csvMoney(row.invoicedNetCents),
    csvMoney(row.vatCents),
    csvMoney(row.uninvoicedCents),
  ]
}

// ─── Subdiarios (F.8) ────────────────────────────────────────────────────────

type SubledgerValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<{ label: string; amountCents: number | null }>

type SubledgerItem = { label: string; amountCents: number | null }

function isItemList(value: SubledgerValue): value is ReadonlyArray<SubledgerItem> {
  return Array.isArray(value)
}

/** Una celda de subdiario según el tipo de su columna. */
export function subledgerCsvCell(column: SubledgerColumn, value: SubledgerValue): CsvCell {
  if (value === null || value === undefined) return null
  if (isItemList(value)) {
    return value
      .map((item) =>
        item.amountCents === null
          ? item.label
          : `${item.label}: ${formatCentsCsv(item.amountCents)}`,
      )
      .join(', ')
  }
  switch (column.type) {
    case 'date':
      return typeof value === 'string' ? csvDate(value.slice(0, 10)) : null
    case 'money':
      return typeof value === 'number' ? csvMoney(value) : null
    case 'int':
      return typeof value === 'number' || typeof value === 'string' ? value : null
    case 'list':
    case 'text':
      if (typeof value === 'boolean') return yesNo(value)
      return typeof value === 'number' ? csvNumber(value) : value
  }
}

// ─── Historia y plan de cuentas (F.14) ───────────────────────────────────────

export const HISTORY_HEADERS = [
  'Fecha y hora',
  'Quién',
  'Acción',
  'Entidad',
  'Ref. interna',
  'Importe',
  'Detalle',
] as const

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  acc_setup: 'Puesta en marcha',
  acc_settings: 'Datos de la SAS',
  acc_access: 'Accesos',
  acc_document: 'Comprobante',
  acc_allocation: 'Imputación',
  acc_treasury: 'Caja o cuenta',
  acc_period: 'Mes',
  acc_fiscal_year: 'Ejercicio',
  acc_account: 'Plan de cuentas',
  acc_party: 'Proveedor o cliente',
  acc_sales_method: 'Medio de cobro',
  acc_sales_point: 'Punto de venta',
  acc_recurring: 'Gasto fijo',
  acc_export: 'Exporte',
}

export function historyCsvRow(row: {
  createdAt: string
  actorName: string
  text: string
  entity: string
  documentSeq: number | null
  amountCents: number | null
  detail: string | null
}): CsvRow {
  return [
    { csv: formatDateTime(row.createdAt) },
    row.actorName,
    row.text,
    ENTITY_LABELS[row.entity] ?? row.entity,
    row.documentSeq,
    row.amountCents === null ? null : csvMoney(row.amountCents),
    row.detail,
  ]
}

export const ACCOUNTS_HEADERS = [
  'Código',
  'Cuenta',
  'Tipo',
  'Saldo normal',
  'Imputable',
  'Lleva partícipe',
  'Aparece en compras',
  'Clave del sistema',
  'Activa',
  'Para qué se usa',
] as const

const ACCOUNT_TYPE_LABELS: Readonly<Record<string, string>> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio neto',
  income: 'Ingresos',
  expense: 'Egresos',
}

export function accountCsvRow(row: {
  code: string
  name: string
  type: string
  normalSide: 'debit' | 'credit'
  postable: boolean
  requiresParty: boolean
  purchaseSelectable: boolean
  systemKey: string | null
  active: boolean
  description: string | null
}): CsvRow {
  return [
    row.code,
    row.name,
    ACCOUNT_TYPE_LABELS[row.type] ?? row.type,
    row.normalSide === 'debit' ? 'Deudor' : 'Acreedor',
    yesNo(row.postable),
    yesNo(row.requiresParty),
    yesNo(row.purchaseSelectable),
    row.systemKey,
    yesNo(row.active),
    row.description,
  ]
}

// ─── Asientos para importar (F.15) ───────────────────────────────────────────

export const IMPORT_HEADERS = [
  'Fecha',
  'N° asiento',
  'Código de cuenta',
  'Cuenta',
  'Debe',
  'Haber',
  'Leyenda',
  'Comprobante',
  'CUIT',
  'Partícipe',
] as const

export function importCsvRows(
  entry: JournalEntryIn,
  taxIdOf: (partyId: string | null) => string | null = () => null,
): CsvRow[] {
  return entry.lines.map((line) => [
    csvDate(entry.entryDate),
    entry.number,
    line.accountCode,
    line.accountName,
    csvMoney(line.debitCents),
    csvMoney(line.creditCents),
    line.memo || entry.description,
    entry.documentLabel,
    line.partyTaxId ?? taxIdOf(line.partyId),
    line.partyName,
  ])
}

/** `administracion-hub-diario-2026-10.csv`: ASCII seguro (como `reportExportFilename`). */
export function exportFilename(slug: string, libro: string, period: string): string {
  const safe = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  return `administracion-${safe(slug) || 'bar'}-${safe(libro) || 'libro'}-${safe(period) || 'periodo'}.csv`
}
