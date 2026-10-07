import 'server-only'
import {
  ACCOUNT_TYPES,
  type AccountType,
  FISCAL_AMOUNT_KEYS,
  type FiscalAmountKey,
  type FiscalBook,
  type Side,
} from '@/lib/accounting/types'
import { voucherLabel } from '@/lib/accounting/voucher-types'
import { endOfMonth, minIsoDay } from '@/lib/dates/civil'
import { todayInCordoba } from '@/lib/dates/zone'
import { SUBLEDGER_COLUMNS, type SubledgerColumn } from './columns'
import { EXPORT_BOOK_INFO, type ExportBook, MONTH_PACKAGE_BOOKS } from './labels'
import {
  AccQueryError,
  asRecord,
  asRecords,
  bool,
  callRpc,
  callRpcRows,
  cents,
  centsOrNull,
  day,
  dayOrNull,
  instantOrNull,
  int,
  intOrNull,
  isRecord,
  isUuid,
  JOURNAL_PAGE_LIMIT,
  keysetPage,
  keysetParams,
  type QueryOutcome,
  type QueryPage,
  queryError,
  REPORT_PAGE_LIMIT,
  readerClient,
  requireMonth,
  requireRange,
  settleQuery,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Libros (§F.1–F.6, F.8, F.11, F.12; H.12). Cada función llama a su RPC
 * `acc_report_*` (plpgsql invoker: `acc_assert_reader` + RLS) y devuelve filas
 * tipadas en centavos. Pantalla = CSV: el exporte usa estas mismas funciones.
 *
 * PERÍODO EN LA URL: `?mes=yyyy-MM` para los libros mensuales (IVA, posición,
 * paquete) y `?desde=&hasta=` para los de rango (diario, mayor, sumas y
 * saldos, subdiarios), como el PeriodPicker del kit y `resolvePeriod` de
 * `lib/dates/period` (que además acepta `?periodo=`). Las funciones reciben
 * fechas ya resueltas (`from`/`to` `yyyy-MM-dd`, `month` `yyyy-MM`): la página
 * valida con `resolvePeriod` y pasa el resultado. Las listas largas paginan con
 * `?despues=` (el `nextCursor` de la página anterior).
 */

// ─── Diario (F.1) ────────────────────────────────────────────────────────────

export type JournalLine = {
  lineNo: number
  accountCode: string
  accountName: string
  partyId: string | null
  partyName: string | null
  /** CUIT del partícipe, si la base lo manda (si no, el exporte lo completa). */
  partyTaxId: string | null
  dueDate: string | null
  memo: string | null
  debitCents: number
  creditCents: number
}

export type JournalEntryRow = {
  entryId: string
  /** Congelado o provisorio (ver `numberIsProvisional`). */
  number: number | null
  numberIsProvisional: boolean
  entryDate: string
  kind: string
  description: string
  documentId: string
  documentSeq: number
  documentKind: string
  documentLabel: string
  createdByName: string
  totalCents: number
  /** Primero el Debe, después el Haber. */
  lines: JournalLine[]
}

export type JournalPage = QueryPage<JournalEntryRow> & { from: string; to: string }

/** El encabezado del diario: «412 asientos · Debe $ X · Haber $ X · Debe = Haber». */
export type JournalSummary = {
  from: string
  to: string
  /** Asientos vigentes del período (incluye los espejos del cierre de ejercicio, como el diario). */
  entries: number
  /** Σ Debe y Σ Haber de esos asientos (de todo el período, no de una página). */
  debitCents: number
  creditCents: number
  balanced: boolean
  /** Algún asiento del período todavía tiene número provisorio (mes abierto). */
  hasProvisional: boolean
}

// ─── Mayor (F.2) ─────────────────────────────────────────────────────────────

export type LedgerRow = {
  rowKind: 'opening' | 'line'
  entryId: string | null
  entryNumber: number | null
  numberIsProvisional: boolean
  entryDate: string | null
  documentId: string | null
  documentSeq: number | null
  documentLabel: string | null
  description: string | null
  partyId: string | null
  partyName: string | null
  dueDate: string | null
  memo: string | null
  debitCents: number
  creditCents: number
  /** Debe − Haber acumulado: positivo = saldo deudor (D), negativo = acreedor (A). */
  runningBalanceCents: number
  /** La cuenta hoja de la línea (en el mayor de un grupo, cada línea dice de qué cuenta es). */
  accountId: string | null
  accountCode: string | null
  accountName: string | null
}

export type LedgerAccount = {
  id: string
  code: string
  name: string
  normalSide: Side
  postable: boolean
  requiresParty: boolean
}

/** Saldo anterior, Debe, Haber y saldo final de TODO el período (Debe − Haber). */
export type LedgerTotals = {
  openingCents: number
  debitCents: number
  creditCents: number
  closingCents: number
}

export type LedgerPage = QueryPage<LedgerRow> & {
  from: string
  to: string
  /** `null` si la cuenta no existe en este bar. */
  account: LedgerAccount | null
  /**
   * Totales del período, solo en la primera página (en las siguientes, `null`).
   * Con filtro de partícipe salen solo si el período entra en una página.
   */
  periodTotals: LedgerTotals | null
}

// ─── Sumas y saldos (F.3) ────────────────────────────────────────────────────

export type TrialBalanceRow = {
  accountId: string
  code: string
  name: string
  level: number
  accountType: AccountType
  normalSide: Side
  postable: boolean
  active: boolean
  /** «Resultados de ejercicios anteriores sin refundir» (no es una cuenta del plan). */
  isVirtual: boolean
  openingDebitCents: number
  openingCreditCents: number
  periodDebitCents: number
  periodCreditCents: number
  closingDebitCents: number
  closingCreditCents: number
}

export type TrialBalanceTotals = {
  openingDebitCents: number
  openingCreditCents: number
  periodDebitCents: number
  periodCreditCents: number
  closingDebitCents: number
  closingCreditCents: number
}

export type TrialBalance = {
  from: string
  to: string
  rows: TrialBalanceRow[]
  /** Σ de las cuentas imputables (y la línea virtual): los grupos ya son subtotales. */
  totals: TrialBalanceTotals
  /** Debe = Haber en las tres columnas. */
  balanced: boolean
  /** Lo que no cuadra (0 si cuadra): «No cuadra por $ X: avisanos». */
  differenceCents: number
}

// ─── Libros IVA (F.4, F.5, F.5b) ─────────────────────────────────────────────

export type IvaAmounts = Record<FiscalAmountKey, number>

export type IvaBookRow = {
  voucherId: string
  documentId: string
  documentSeq: number
  voucherDate: string
  voucherType: string
  /** «Factura A», «Nota de crédito B». */
  voucherLabel: string
  afipVoucherCode: number | null
  /** −1 en NC y anulaciones en fila negativa. */
  sign: 1 | -1
  isReversal: boolean
  pointOfSale: number
  numberFrom: number
  numberTo: number | null
  counterpartyName: string
  counterpartyDocType: number
  counterpartyDocNumber: string
  counterpartyIvaCondition: string
  channel: string | null
  /** Importes CON signo (las NC y anulaciones, negativas). */
  amounts: IvaAmounts
  accountingDate: string
}

export type IvaBookPage = QueryPage<IvaBookRow> & { book: FiscalBook; month: string }

export type IvaBookTotals = {
  book: FiscalBook
  month: string
  /** Suma firmada de cada columna del mes. */
  amounts: IvaAmounts
  /** Comprobantes del mes, si la base lo manda. */
  count: number | null
}

export type IvaAliquotRow = {
  voucherId: string | null
  documentId: string | null
  documentSeq: number | null
  voucherDate: string | null
  voucherType: string
  voucherLabel: string
  afipVoucherCode: number | null
  pointOfSale: number
  numberFrom: number
  numberTo: number | null
  counterpartyName: string
  counterpartyDocType: number | null
  counterpartyDocNumber: string
  /** Alícuota en puntos básicos (`2100` = 21 %). */
  vatRateBp: number | null
  /** Código de alícuota AFIP: 3 (0 %), 9 (2,5 %), 8 (5 %), 4 (10,5 %), 5 (21 %), 6 (27 %). */
  aliquotCode: number
  /** Con signo (NC y anulaciones en negativo), como el libro. */
  netCents: number
  vatCents: number
}

export type IvaAliquotPage = QueryPage<IvaAliquotRow> & { book: FiscalBook; month: string }

// ─── Posición de IVA (F.6) ───────────────────────────────────────────────────

export type IvaReconciliationDifference = {
  entryId: string | null
  documentId: string | null
  documentSeq: number | null
  entryDate: string | null
  kind: string
  /** Concepto del asiento («Asiento manual que movió IVA…»). */
  label: string
  vatCreditCents: number
  vatDebitCents: number
}

/**
 * Las cifras con que se calculó la posición. Es lo que `closePeriod` y
 * `generateIvaSettlement` mandan como «lo que vio el usuario» (si cambió algo
 * mientras tanto, la base contesta `preview_stale`).
 */
export type IvaFigures = {
  df: number
  cf: number
  perc: number
  ret: number
  st0: number
  ld0: number
}

export type IvaPosition = {
  month: string
  periodId: string | null
  status: 'open' | 'closed'
  closedAt: string | null
  /** `on_close` (se liquida al cerrar) o `manual` («Registrar la liquidación del IVA»). */
  mode: 'on_close' | 'manual' | null
  /** La SAS liquida IVA (responsable inscripta). */
  applies: boolean
  figures: IvaFigures
  /** Por alícuota en puntos básicos (`"2100"`, `"1050"`), con signo. */
  debitFiscal: { byRate: Record<string, number>; totalCents: number }
  creditFiscal: { byRate: Record<string, number>; totalCents: number }
  technicalBalancePrevCents: number
  freeBalancePrevCents: number
  perceptionsCents: number
  withholdingsCents: number
  technicalBalanceCents: number
  /** IVA a pagar (A pagar). */
  toPayCents: number
  technicalBalanceNewCents: number
  freeBalanceNewCents: number
  /** Saldo técnico + libre disponibilidad que quedan a favor (A favor). */
  inFavorCents: number
  /** Todo en cero: no hay nada para liquidar. */
  isZero: boolean
  /** IVA de comisiones a documentar (informativo). */
  pendingDocumentationCents: number
  reconciliation: {
    purchasesBookVatComputableCents: number
    journalVatCreditCents: number
    salesBookVatCents: number
    journalVatDebitCents: number
    /** Los primeros 50 asientos sin comprobante fiscal que movieron IVA. */
    differences: IvaReconciliationDifference[]
    differencesCount: number
    unexplainedVatCreditCents: number
    unexplainedVatDebitCents: number
    /** Libros = mayor (✓). */
    matches: boolean
    /** Lo que no coincide está explicado por los asientos de `differences`. */
    fullyExplained: boolean
  }
  /** Liquidación vigente del mes, si hay. */
  settlementDocumentId: string | null
  /** La liquidación vigente sigue al día (no se cargó nada después). */
  settlementUpToDate: boolean | null
}

// ─── Subdiarios (F.8) ────────────────────────────────────────────────────────

export const SUBLEDGER_KINDS = [
  'purchases',
  'payments',
  'sales',
  'sales_by_method',
  'collections',
  'treasury',
] as const
export type SubledgerKind = (typeof SUBLEDGER_KINDS)[number]

export function isSubledgerKind(value: unknown): value is SubledgerKind {
  return typeof value === 'string' && (SUBLEDGER_KINDS as readonly string[]).includes(value)
}

/** Un ítem de una celda con lista («Caja: $ 1.000 · Banco: $ 500», certificados). */
export type SubledgerListItem = { label: string; amountCents: number | null }

export type SubledgerCell = string | number | boolean | null | readonly SubledgerListItem[]

/**
 * Una fila de subdiario tal como la arma la base (`row jsonb`), con los
 * importes (`*_cents`) ya normalizados a número. Las columnas de cada
 * subdiario están en `SUBLEDGER_COLUMNS` (las mismas del CSV); `subledgerCell`
 * saca el valor de una columna.
 */
export type SubledgerRow = {
  rowKind: 'opening' | 'line'
  documentId: string | null
  entryId: string | null
  date: string | null
  values: Readonly<Record<string, SubledgerCell>>
}

export type SubledgerPage = QueryPage<SubledgerRow> & {
  kind: SubledgerKind
  from: string
  to: string
}

// ─── Neto por medio de cobro (F.11) y ventas sin factura (F.12) ──────────────

export type NetByMethodRow = {
  methodId: string
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
  /** Descuento total en puntos básicos (532 = 5,32 %); `null` si no hubo acreditaciones. */
  discountBp: number | null
}

export type SalesSummaryRow = {
  month: string
  channel: string
  soldCents: number
  invoicedNetCents: number
  vatCents: number
  uninvoicedCents: number
}

// ─── Paquete del mes (F.15) ──────────────────────────────────────────────────

export type MonthPackageFile = {
  libro: ExportBook
  title: string
  description: string
  /** Cuántos registros trae; `null` si la base todavía no lo puede contar. */
  rows: number | null
  /** Qué se cuenta: «412 asientos», «38 comprobantes». */
  unit: 'asientos' | 'cuentas' | 'comprobantes' | 'filas' | 'proveedores' | 'clientes' | null
}

export type MonthPackage = {
  month: string
  from: string
  to: string
  status: 'open' | 'closed' | 'missing'
  closedAt: string | null
  closedByName: string | null
  files: MonthPackageFile[]
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function side(value: unknown): Side {
  return value === 'credit' ? 'credit' : 'debit'
}

function accountType(value: unknown): AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
    ? (value as AccountType)
    : 'asset'
}

function parseJournalLine(line: UnknownRecord): JournalLine {
  return {
    lineNo: int(line.line_no),
    accountCode: str(line.account_code),
    accountName: str(line.account_name),
    partyId: strOrNull(line.party_id),
    partyName: strOrNull(line.party_name),
    partyTaxId: strOrNull(line.party_tax_id ?? line.tax_id),
    dueDate: dayOrNull(line.due_date),
    memo: strOrNull(line.memo),
    debitCents: cents(line.debit_cents),
    creditCents: cents(line.credit_cents),
  }
}

/** Primero el Debe, después el Haber; dentro de cada lado, por número de línea. */
function debitFirst(a: { debitCents: number; lineNo: number }, b: typeof a): number {
  const sa = a.debitCents > 0 ? 0 : 1
  const sb = b.debitCents > 0 ? 0 : 1
  return sa - sb || a.lineNo - b.lineNo
}

function parseJournalRow(row: UnknownRecord): JournalEntryRow {
  return {
    entryId: str(row.entry_id),
    number: intOrNull(row.number),
    numberIsProvisional: bool(row.number_is_provisional),
    entryDate: day(row.entry_date),
    kind: str(row.kind),
    description: str(row.description),
    documentId: str(row.document_id),
    documentSeq: int(row.document_seq),
    documentKind: str(row.document_kind),
    documentLabel: str(row.document_label),
    createdByName: str(row.created_by_name),
    totalCents: cents(row.total_cents),
    lines: asRecords(row.lines).map(parseJournalLine).sort(debitFirst),
  }
}

/** Fila de `acc_report_ledger` (la usan también los movimientos de una caja). */
export function parseLedgerRow(row: UnknownRecord): LedgerRow {
  return {
    rowKind: row.row_kind === 'opening' ? 'opening' : 'line',
    entryId: strOrNull(row.entry_id),
    entryNumber: intOrNull(row.entry_number),
    numberIsProvisional: bool(row.number_is_provisional),
    entryDate: dayOrNull(row.entry_date),
    documentId: strOrNull(row.document_id),
    documentSeq: intOrNull(row.document_seq),
    documentLabel: strOrNull(row.document_label),
    description: strOrNull(row.description),
    partyId: strOrNull(row.party_id),
    partyName: strOrNull(row.party_name),
    dueDate: dayOrNull(row.due_date),
    memo: strOrNull(row.memo),
    debitCents: cents(row.debit_cents),
    creditCents: cents(row.credit_cents),
    runningBalanceCents: cents(row.running_balance_cents),
    accountId: strOrNull(row.account_id),
    accountCode: strOrNull(row.account_code),
    accountName: strOrNull(row.account_name),
  }
}

export function isOpeningRow(row: UnknownRecord): boolean {
  return row.row_kind === 'opening'
}

function parseTrialRow(row: UnknownRecord): TrialBalanceRow {
  return {
    accountId: str(row.account_id),
    code: str(row.code),
    name: str(row.name),
    level: int(row.level),
    accountType: accountType(row.account_type),
    normalSide: side(row.normal_side),
    postable: bool(row.postable),
    active: row.active === undefined || row.active === null ? true : bool(row.active),
    isVirtual: bool(row.is_virtual),
    openingDebitCents: cents(row.opening_debit_cents),
    openingCreditCents: cents(row.opening_credit_cents),
    periodDebitCents: cents(row.period_debit_cents),
    periodCreditCents: cents(row.period_credit_cents),
    closingDebitCents: cents(row.closing_debit_cents),
    closingCreditCents: cents(row.closing_credit_cents),
  }
}

/**
 * Los 22 importes de una fila del libro: la base (12b·3) los manda YA firmados
 * (`× sign`: NC y anulaciones en negativo) y se usan tal cual, en pantalla y en
 * el CSV. Una clave que falte vale 0 (sin `-0`).
 */
function bookAmounts(raw: unknown): IvaAmounts {
  const rec = asRecord(raw)
  const out = {} as IvaAmounts
  for (const key of FISCAL_AMOUNT_KEYS) {
    const value = cents(rec[key])
    out[key] = value === 0 ? 0 : value
  }
  return out
}

function parseIvaRow(row: UnknownRecord): IvaBookRow {
  const sign: 1 | -1 = int(row.sign) < 0 ? -1 : 1
  const type = str(row.voucher_type)
  return {
    voucherId: str(row.voucher_id),
    documentId: str(row.document_id),
    documentSeq: int(row.document_seq),
    voucherDate: day(row.voucher_date),
    voucherType: type,
    voucherLabel: voucherLabel(type),
    afipVoucherCode: intOrNull(row.afip_voucher_code),
    sign,
    isReversal: bool(row.is_reversal),
    pointOfSale: int(row.point_of_sale),
    numberFrom: int(row.number_from),
    numberTo: intOrNull(row.number_to),
    counterpartyName: str(row.counterparty_name),
    counterpartyDocType: int(row.counterparty_doc_type),
    counterpartyDocNumber: str(row.counterparty_doc_number),
    counterpartyIvaCondition: str(row.counterparty_iva_condition),
    channel: strOrNull(row.channel),
    amounts: bookAmounts(row.amounts),
    accountingDate: day(row.accounting_date),
  }
}

/** El primer valor presente entre varias claves posibles. */
function pick(row: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key]
  }
  return null
}

function parseAliquotRow(row: UnknownRecord): IvaAliquotRow {
  const type = str(row.voucher_type)
  return {
    voucherId: strOrNull(row.voucher_id),
    documentId: strOrNull(row.document_id),
    documentSeq: intOrNull(row.document_seq),
    voucherDate: dayOrNull(row.voucher_date),
    voucherType: type,
    voucherLabel: voucherLabel(type),
    afipVoucherCode: intOrNull(row.afip_voucher_code),
    pointOfSale: int(row.point_of_sale),
    numberFrom: int(row.number_from),
    numberTo: intOrNull(row.number_to),
    counterpartyName: str(row.counterparty_name),
    counterpartyDocType: intOrNull(row.counterparty_doc_type),
    counterpartyDocNumber: str(pick(row, 'counterparty_doc_number', 'doc_number')),
    vatRateBp: intOrNull(row.vat_rate_bp),
    aliquotCode: int(pick(row, 'afip_aliquot_code', 'aliquot_code', 'afip_aliquot_id')),
    // La base ya los manda con signo (sign × importe).
    netCents: cents(row.net_cents),
    vatCents: cents(row.vat_cents),
  }
}

function byRate(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [rate, value] of Object.entries(asRecord(raw))) {
    const v = centsOrNull(value)
    if (v !== null) out[rate] = v
  }
  return out
}

/** El JSON de `acc_report_iva_position` (o de `acc_compute_iva_position`) → `IvaPosition`. */
export function parseIvaPosition(raw: unknown, month: string): IvaPosition {
  const data = asRecord(raw)
  const debit = asRecord(data.debit_fiscal)
  const credit = asRecord(data.credit_fiscal)
  const rec = asRecord(data.reconciliation)
  const figures = asRecord(data.figures)
  const settlement = asRecord(data.settlement)
  const technicalBalanceNewCents = cents(data.technical_balance_new_cents)
  const freeBalanceNewCents = cents(data.free_balance_new_cents)
  const debitTotal = cents(debit.total_cents)
  const creditTotal = cents(credit.total_cents)
  const bookCredit = cents(rec.purchases_book_vat_computable_cents)
  const bookDebit = cents(rec.sales_book_vat_cents)
  const journalCredit =
    rec.journal_vat_credit_cents === undefined ? creditTotal : cents(rec.journal_vat_credit_cents)
  const journalDebit =
    rec.journal_vat_debit_cents === undefined ? debitTotal : cents(rec.journal_vat_debit_cents)
  const differences = asRecords(rec.differences).map((d) => ({
    entryId: strOrNull(d.entry_id),
    documentId: strOrNull(d.document_id),
    documentSeq: intOrNull(d.document_seq),
    entryDate: dayOrNull(d.entry_date),
    kind: str(d.kind),
    label: str(d.label ?? d.description),
    vatCreditCents: cents(d.vat_credit_cents),
    vatDebitCents: cents(d.vat_debit_cents),
  }))
  const mode = data.mode === 'on_close' || data.mode === 'manual' ? data.mode : null
  return {
    month: day(data.month, month),
    periodId: strOrNull(data.period_id),
    status: data.status === 'closed' ? 'closed' : 'open',
    closedAt: instantOrNull(data.closed_at),
    mode,
    applies: data.applies === undefined ? true : bool(data.applies),
    figures: {
      df: cents(figures.df ?? debitTotal),
      cf: cents(figures.cf ?? creditTotal),
      perc: cents(figures.perc ?? data.perceptions_cents),
      ret: cents(figures.ret ?? data.withholdings_cents),
      st0: cents(figures.st0 ?? data.technical_balance_prev_cents),
      ld0: cents(figures.ld0 ?? data.free_balance_prev_cents),
    },
    debitFiscal: { byRate: byRate(debit.by_rate), totalCents: debitTotal },
    creditFiscal: { byRate: byRate(credit.by_rate), totalCents: creditTotal },
    technicalBalancePrevCents: cents(data.technical_balance_prev_cents),
    freeBalancePrevCents: cents(data.free_balance_prev_cents),
    perceptionsCents: cents(data.perceptions_cents),
    withholdingsCents: cents(data.withholdings_cents),
    technicalBalanceCents: cents(data.technical_balance_cents),
    toPayCents: cents(data.to_pay_cents),
    technicalBalanceNewCents,
    freeBalanceNewCents,
    inFavorCents:
      data.in_favor_cents === undefined
        ? technicalBalanceNewCents + freeBalanceNewCents
        : cents(data.in_favor_cents),
    isZero: bool(data.is_zero),
    pendingDocumentationCents: cents(data.pending_documentation_cents),
    reconciliation: {
      purchasesBookVatComputableCents: bookCredit,
      journalVatCreditCents: journalCredit,
      salesBookVatCents: bookDebit,
      journalVatDebitCents: journalDebit,
      differences,
      differencesCount: intOrNull(rec.differences_count) ?? differences.length,
      unexplainedVatCreditCents: cents(rec.unexplained_vat_credit_cents),
      unexplainedVatDebitCents: cents(rec.unexplained_vat_debit_cents),
      matches:
        rec.matches === undefined
          ? journalCredit === bookCredit && journalDebit === bookDebit
          : bool(rec.matches),
      fullyExplained: rec.fully_explained === undefined ? true : bool(rec.fully_explained),
    },
    settlementDocumentId:
      strOrNull(data.settlement_document_id) ?? strOrNull(settlement.document_id),
    settlementUpToDate:
      settlement.up_to_date === undefined || settlement.up_to_date === null
        ? null
        : bool(settlement.up_to_date),
  }
}

function listItem(item: unknown): SubledgerListItem | null {
  if (typeof item === 'string') return item ? { label: item, amountCents: null } : null
  if (!isRecord(item)) return null
  const label = str(
    pick(
      item,
      'label',
      'name',
      'document_label',
      'treasury_name',
      'account_name',
      'number',
      'certificate_number',
    ),
  )
  const amountCents = centsOrNull(pick(item, 'amount_cents', 'cents', 'open_cents'))
  return label || amountCents !== null ? { label, amountCents } : null
}

function subledgerValue(key: string, value: unknown): SubledgerCell {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    return value.map(listItem).filter((v): v is SubledgerListItem => v !== null)
  }
  if (key.endsWith('_cents')) return centsOrNull(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'bigint') return Number(value)
  return null
}

function parseSubledgerRow(raw: UnknownRecord): SubledgerRow {
  const row = asRecord(raw.row)
  const values: Record<string, SubledgerCell> = {}
  for (const [key, value] of Object.entries(row)) values[key] = subledgerValue(key, value)
  return {
    rowKind: row.row_kind === 'opening' ? 'opening' : 'line',
    documentId: strOrNull(row.document_id),
    entryId: strOrNull(row.entry_id),
    date: dayOrNull(pick(row, 'date', 'accounting_date', 'entry_date', 'voucher_date')),
    values,
  }
}

/** El valor de una columna de subdiario en una fila (la primera clave presente). */
export function subledgerCell(row: SubledgerRow, column: SubledgerColumn): SubledgerCell {
  for (const key of column.keys) {
    if (key in row.values) return row.values[key] ?? null
  }
  return null
}

// ─── Funciones ───────────────────────────────────────────────────────────────

/** Libro diario (F.1): asientos con sus líneas, en orden; 100 por página (máx. 200). */
export async function getJournal(
  tenantId: string,
  params: { from: string; to: string; after?: string | null; limit?: number | null },
): Promise<JournalPage> {
  const { from, to } = requireRange(params.from, params.to)
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    100,
    JOURNAL_PAGE_LIMIT,
  )
  const raw = await callRpcRows('acc_report_journal', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_after,
    p_limit,
  })
  const page = keysetPage(raw, {
    limit: p_limit,
    seen,
    map: parseJournalRow,
    totalKey: 'total_entries',
  })
  return { ...page, from, to }
}

/**
 * El encabezado del diario de un período (H.12): cuántos asientos y Σ Debe =
 * Σ Haber de TODO el período (no de la página que se ve). Sale de sumas y
 * saldos (asientos vigentes, sin espejos) más los espejos del cierre de
 * ejercicio, que el diario sí muestra.
 */
export async function getJournalSummary(
  tenantId: string,
  params: { from: string; to: string },
): Promise<JournalSummary> {
  const { from, to } = requireRange(params.from, params.to)
  const supabase = await readerClient()
  const [count, provisional, mirrors, trial] = await Promise.all([
    supabase
      .from('acc_journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .gte('entry_date', from)
      .lte('entry_date', to),
    supabase
      .from('acc_journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .is('number', null)
      .gte('entry_date', from)
      .lte('entry_date', to),
    supabase
      .from('acc_journal_entries')
      .select('total_cents')
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .eq('is_mirror', true)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .limit(1000),
    getTrialBalance(tenantId, { from, to }),
  ])
  if (count.error) throw queryError('acc_journal_entries', count.error)
  if (provisional.error) throw queryError('acc_journal_entries', provisional.error)
  if (mirrors.error) throw queryError('acc_journal_entries', mirrors.error)
  let mirrorCents = 0
  for (const row of (mirrors.data ?? []) as unknown[]) {
    if (isRecord(row)) mirrorCents += cents(row.total_cents)
  }
  // Cada asiento cuadra: el total de un espejo va igual al Debe y al Haber.
  const debitCents = trial.totals.periodDebitCents + mirrorCents
  const creditCents = trial.totals.periodCreditCents + mirrorCents
  return {
    from,
    to,
    entries: count.count ?? 0,
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
    hasProvisional: (provisional.count ?? 0) > 0,
  }
}

async function loadLedgerAccount(
  tenantId: string,
  accountId: string,
): Promise<LedgerAccount | null> {
  if (!isUuid(accountId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_accounts')
    .select('id, code, name, normal_side, postable, requires_party')
    .eq('tenant_id', tenantId)
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw queryError('acc_accounts', error)
  if (!isRecord(data)) return null
  return {
    id: str(data.id),
    code: str(data.code),
    name: str(data.name),
    normalSide: side(data.normal_side),
    postable: bool(data.postable),
    requiresParty: bool(data.requires_party),
  }
}

/**
 * Mayor de una cuenta (F.2), con «Saldo anterior» en la primera página. Si la
 * cuenta es un grupo, suma sus hojas; `partyId` filtra las partidas de un
 * partícipe en una cuenta de control.
 */
export async function getLedger(
  tenantId: string,
  params: {
    accountId: string
    partyId?: string | null
    from: string
    to: string
    after?: string | null
    limit?: number | null
    /** `false` = sin `periodTotals` (el exporte no los usa y se ahorra sumas y saldos). */
    totals?: boolean
  },
): Promise<LedgerPage> {
  const { from, to } = requireRange(params.from, params.to)
  const account = await loadLedgerAccount(tenantId, params.accountId)
  if (!account) {
    return { rows: [], nextCursor: null, totalRows: 0, from, to, account: null, periodTotals: null }
  }
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    200,
    REPORT_PAGE_LIMIT,
  )
  const partyId = params.partyId && isUuid(params.partyId) ? params.partyId : null
  const firstPage = p_after === null
  const [raw, trial] = await Promise.all([
    callRpcRows('acc_report_ledger', {
      p_tenant_id: tenantId,
      p_account_id: account.id,
      p_party_id: partyId,
      p_from: from,
      p_to: to,
      p_after,
      p_limit,
    }),
    // Debe y Haber de todo el período salen de sumas y saldos (las mismas
    // líneas: vigentes y sin espejos; un grupo suma sus hojas).
    firstPage && partyId === null && params.totals !== false
      ? settleQuery(getTrialBalance(tenantId, { from, to }))
      : Promise.resolve(null),
  ])
  const page = keysetPage(raw, {
    limit: p_limit,
    seen,
    map: parseLedgerRow,
    isCounted: (row) => !isOpeningRow(row),
  })
  return {
    ...page,
    from,
    to,
    account,
    periodTotals:
      firstPage && params.totals !== false ? ledgerTotals(page, account.id, trial) : null,
  }
}

function ledgerTotals(
  page: QueryPage<LedgerRow>,
  accountId: string,
  trial: QueryOutcome<TrialBalance> | null,
): LedgerTotals | null {
  const opening = page.rows.find((r) => r.rowKind === 'opening')
  if (!opening) return null
  const openingCents = opening.runningBalanceCents
  const row = trial?.ok ? trial.data.rows.find((r) => r.accountId === accountId) : undefined
  let debitCents = 0
  let creditCents = 0
  if (row) {
    debitCents = row.periodDebitCents
    creditCents = row.periodCreditCents
  } else if (page.nextCursor === null) {
    // Todo el período entró en esta página: se suma acá.
    for (const r of page.rows) {
      if (r.rowKind !== 'line') continue
      debitCents += r.debitCents
      creditCents += r.creditCents
    }
  } else {
    return null
  }
  return {
    openingCents,
    debitCents,
    creditCents,
    closingCents: openingCents + debitCents - creditCents,
  }
}

function sumTotals(rows: readonly TrialBalanceRow[]): TrialBalanceTotals {
  const totals: TrialBalanceTotals = {
    openingDebitCents: 0,
    openingCreditCents: 0,
    periodDebitCents: 0,
    periodCreditCents: 0,
    closingDebitCents: 0,
    closingCreditCents: 0,
  }
  for (const row of rows) {
    if (!row.postable && !row.isVirtual) continue
    totals.openingDebitCents += row.openingDebitCents
    totals.openingCreditCents += row.openingCreditCents
    totals.periodDebitCents += row.periodDebitCents
    totals.periodCreditCents += row.periodCreditCents
    totals.closingDebitCents += row.closingDebitCents
    totals.closingCreditCents += row.closingCreditCents
  }
  return totals
}

/**
 * Sumas y saldos (F.3, #11 parte 1): una fila por cuenta y grupo, con la línea
 * virtual de resultados anteriores sin refundir. El subtotal de un grupo lo
 * arma la base con Σ Debe − Σ Haber de sus hojas y lo pone en D o A según el
 * signo, nunca por el tipo ni el lado normal del grupo: un grupo de resultados
 * puede mezclar ingresos y egresos («4 Resultado del ejercicio» con 4.1 y 4.2).
 * Acá no se recalcula nada por tipo: los totales suman solo las imputables (y
 * la línea virtual), así cuadran aunque el plan tenga grupos mixtos.
 */
export async function getTrialBalance(
  tenantId: string,
  params: { from: string; to: string; excludeFyResult?: boolean },
): Promise<TrialBalance> {
  const { from, to } = requireRange(params.from, params.to)
  const raw = await callRpcRows('acc_report_trial_balance', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
    p_exclude_fy_result: params.excludeFyResult === true,
  })
  const rows = raw.map(parseTrialRow)
  const totals = sumTotals(rows)
  const differenceCents = Math.max(
    Math.abs(totals.openingDebitCents - totals.openingCreditCents),
    Math.abs(totals.periodDebitCents - totals.periodCreditCents),
    Math.abs(totals.closingDebitCents - totals.closingCreditCents),
  )
  return { from, to, rows, totals, balanced: differenceCents === 0, differenceCents }
}

/** Libro IVA compras o ventas del mes (F.4/F.5), 500 filas por página. */
export async function getIvaBook(
  tenantId: string,
  params: { book: FiscalBook; month: string; after?: string | null; limit?: number | null },
): Promise<IvaBookPage> {
  const month = requireMonth(params.month)
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    REPORT_PAGE_LIMIT,
    REPORT_PAGE_LIMIT,
  )
  const raw = await callRpcRows('acc_report_iva_book', {
    p_tenant_id: tenantId,
    p_book: params.book,
    p_month: month,
    p_after,
    p_limit,
  })
  const page = keysetPage(raw, { limit: p_limit, seen, map: parseIvaRow })
  return { ...page, book: params.book, month }
}

/** Totales firmados del libro IVA del mes (franja de arriba y fila «Totales»). */
export async function getIvaBookTotals(
  tenantId: string,
  params: { book: FiscalBook; month: string },
): Promise<IvaBookTotals> {
  const month = requireMonth(params.month)
  const data = asRecord(
    await callRpc('acc_report_iva_book_totals', {
      p_tenant_id: tenantId,
      p_book: params.book,
      p_month: month,
    }),
  )
  const source = isRecord(data.amounts) ? data.amounts : data
  const amounts = {} as IvaAmounts
  for (const key of FISCAL_AMOUNT_KEYS) amounts[key] = cents(source[key])
  return {
    book: params.book,
    month,
    amounts,
    count: intOrNull(pick(data, 'count', 'rows', 'total_rows', 'vouchers')),
  }
}

/** Una fila por comprobante y alícuota (F.5b), para el archivo de alícuotas. */
export async function getIvaAliquots(
  tenantId: string,
  params: { book: FiscalBook; month: string; after?: string | null; limit?: number | null },
): Promise<IvaAliquotPage> {
  const month = requireMonth(params.month)
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    REPORT_PAGE_LIMIT,
    REPORT_PAGE_LIMIT,
  )
  const raw = await callRpcRows('acc_report_iva_aliquots', {
    p_tenant_id: tenantId,
    p_book: params.book,
    p_month: month,
    p_after,
    p_limit,
  })
  const page = keysetPage(raw, { limit: p_limit, seen, map: parseAliquotRow })
  return { ...page, book: params.book, month }
}

/** Posición mensual de IVA (F.6): estimada; la DDJJ la presenta la contadora. */
export async function getIvaPosition(tenantId: string, month: string): Promise<IvaPosition> {
  const first = requireMonth(month)
  const data = await callRpc('acc_report_iva_position', { p_tenant_id: tenantId, p_month: first })
  return parseIvaPosition(data, first)
}

/** Un subdiario (F.8), 500 filas por página; el de disponibilidades, por caja o todas. */
export async function getSubledger(
  tenantId: string,
  params: {
    kind: SubledgerKind
    from: string
    to: string
    treasuryId?: string | null
    after?: string | null
    limit?: number | null
  },
): Promise<SubledgerPage> {
  if (!isSubledgerKind(params.kind)) {
    throw new AccQueryError('params', 'invalid', 'Ese subdiario no existe.')
  }
  const { from, to } = requireRange(params.from, params.to)
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    REPORT_PAGE_LIMIT,
    REPORT_PAGE_LIMIT,
  )
  const raw = await callRpcRows('acc_report_subledger', {
    p_tenant_id: tenantId,
    p_kind: params.kind,
    p_from: from,
    p_to: to,
    p_treasury_id: params.treasuryId && isUuid(params.treasuryId) ? params.treasuryId : null,
    p_after,
    p_limit,
  })
  const page = keysetPage(raw, {
    limit: p_limit,
    seen,
    map: parseSubledgerRow,
    isCounted: (row) => asRecord(row.row).row_kind !== 'opening',
  })
  return { ...page, kind: params.kind, from, to }
}

/** Las columnas de un subdiario (las mismas del CSV). */
export function subledgerColumns(kind: SubledgerKind): readonly SubledgerColumn[] {
  return SUBLEDGER_COLUMNS[kind]
}

/** Neto real por medio de cobro (F.11): vendido, descuentos, acreditado y pendiente. */
export async function getNetByMethod(
  tenantId: string,
  params: { from: string; to: string },
): Promise<NetByMethodRow[]> {
  const { from, to } = requireRange(params.from, params.to)
  const raw = await callRpcRows('acc_report_net_by_method', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
  })
  return raw.map((row) => ({
    methodId: str(row.method_id),
    methodName: str(row.method_name),
    channel: str(row.channel),
    soldCents: cents(row.sold_cents),
    commissionCents: cents(row.commission_cents),
    commissionVatCents: cents(row.commission_vat_cents),
    withholdingsCents: cents(row.withholdings_cents),
    otherChargesCents: cents(row.other_charges_cents),
    unexplainedCents: cents(row.unexplained_cents),
    creditedCents: cents(row.credited_cents),
    pendingCents: cents(row.pending_cents),
    discountBp: intOrNull(row.discount_bp),
  }))
}

/** Ventas sin factura por mes y canal (F.12). */
export async function getSalesSummary(
  tenantId: string,
  params: { from: string; to: string },
): Promise<SalesSummaryRow[]> {
  const { from, to } = requireRange(params.from, params.to)
  const raw = await callRpcRows('acc_report_sales_summary', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
  })
  return raw.map((row) => ({
    month: day(row.month),
    channel: str(row.channel),
    soldCents: cents(row.sold_cents),
    invoicedNetCents: cents(row.invoiced_net_cents),
    vatCents: cents(row.vat_cents),
    uninvoicedCents: cents(row.uninvoiced_cents),
  }))
}

// ─── Paquete del mes ─────────────────────────────────────────────────────────

type FileCount = { rows: number | null; unit: MonthPackageFile['unit'] }

async function firstPageTotal(
  name: string,
  params: Record<string, unknown>,
  totalKey = 'total_rows',
): Promise<number> {
  const raw = await callRpcRows(name, { ...params, p_after: null, p_limit: 1 })
  const first = raw[0]
  return first ? int(first[totalKey]) : 0
}

async function countOrNull(promise: Promise<number>): Promise<number | null> {
  const settled = await settleQuery(promise)
  return settled.ok ? settled.data : null
}

/**
 * «Paquete del mes» (F.15): los archivos del mes con cuántos registros trae
 * cada uno. Un conteo que la base todavía no puede hacer (función de una fase
 * que no está) queda en `null` sin tirar la lista.
 */
export async function getMonthPackage(tenantId: string, month: string): Promise<MonthPackage> {
  const first = requireMonth(month)
  const last = endOfMonth(first)
  const asOf = minIsoDay(last, todayInCordoba())
  const range = { p_tenant_id: tenantId, p_from: first, p_to: last }
  const supabase = await readerClient()

  const periodQuery = supabase
    .from('acc_periods')
    .select('status, closed_at, closed_by_name')
    .eq('tenant_id', tenantId)
    .eq('kind', 'month')
    .eq('month', first)
    .maybeSingle()

  const trial = settleQuery(getTrialBalance(tenantId, { from: first, to: last }))
  const ivaTotal = (book: FiscalBook) =>
    countOrNull(
      firstPageTotal('acc_report_iva_book', {
        p_tenant_id: tenantId,
        p_book: book,
        p_month: first,
      }),
    )
  const aliquots = (book: FiscalBook) =>
    countOrNull(
      firstPageTotal('acc_report_iva_aliquots', {
        p_tenant_id: tenantId,
        p_book: book,
        p_month: first,
      }),
    )
  const subledger = (kind: SubledgerKind) =>
    countOrNull(
      firstPageTotal('acc_report_subledger', { ...range, p_kind: kind, p_treasury_id: null }),
    )
  const balances = (group: 'payables' | 'receivables') =>
    countOrNull(
      callRpcRows('acc_report_party_balances', {
        p_tenant_id: tenantId,
        p_as_of: asOf,
        p_group: group,
      }).then(
        (rows) =>
          rows.filter((r) => cents(r.debt_cents) !== 0 || cents(r.credit_cents) !== 0).length,
      ),
    )

  const [
    periodResult,
    trialResult,
    journal,
    ivaPurchases,
    ivaPurchasesAliquots,
    ivaSales,
    ivaSalesAliquots,
    purchases,
    payments,
    sales,
    collections,
    treasury,
    payables,
    receivables,
  ] = await Promise.all([
    periodQuery,
    trial,
    countOrNull(firstPageTotal('acc_report_journal', range, 'total_entries')),
    ivaTotal('purchases'),
    aliquots('purchases'),
    ivaTotal('sales'),
    aliquots('sales'),
    subledger('purchases'),
    subledger('payments'),
    subledger('sales'),
    subledger('collections'),
    subledger('treasury'),
    balances('payables'),
    balances('receivables'),
  ])

  if (periodResult.error) throw queryError('acc_periods', periodResult.error)
  const period = isRecord(periodResult.data) ? periodResult.data : null

  const trialRows = trialResult.ok ? trialResult.data.rows : null
  // Las mismas cuentas que trae el exporte del mayor general: con movimiento o con saldo anterior.
  const accountsWithMovement = trialRows
    ? trialRows.filter(
        (r) =>
          r.postable &&
          !r.isVirtual &&
          (r.periodDebitCents !== 0 ||
            r.periodCreditCents !== 0 ||
            r.openingDebitCents !== r.openingCreditCents),
      ).length
    : null

  const counts: Record<(typeof MONTH_PACKAGE_BOOKS)[number], FileCount> = {
    diario: { rows: journal, unit: 'asientos' },
    'mayor-general': { rows: accountsWithMovement, unit: 'cuentas' },
    'sumas-y-saldos': { rows: trialRows ? trialRows.length : null, unit: 'cuentas' },
    'iva-compras': { rows: ivaPurchases, unit: 'comprobantes' },
    'iva-compras-alicuotas': { rows: ivaPurchasesAliquots, unit: 'filas' },
    'iva-ventas': { rows: ivaSales, unit: 'comprobantes' },
    'iva-ventas-alicuotas': { rows: ivaSalesAliquots, unit: 'filas' },
    'posicion-iva': { rows: null, unit: null },
    'subdiario-compras': { rows: purchases, unit: 'filas' },
    'subdiario-pagos': { rows: payments, unit: 'filas' },
    'subdiario-ventas': { rows: sales, unit: 'filas' },
    'subdiario-cobranzas': { rows: collections, unit: 'filas' },
    'subdiario-disponibilidades': { rows: treasury, unit: 'filas' },
    'saldos-proveedores': { rows: payables, unit: 'proveedores' },
    'saldos-clientes': { rows: receivables, unit: 'clientes' },
  }

  return {
    month: first,
    from: first,
    to: last,
    status: period ? (period.status === 'closed' ? 'closed' : 'open') : 'missing',
    closedAt: period ? instantOrNull(period.closed_at) : null,
    closedByName: period ? strOrNull(period.closed_by_name) : null,
    files: MONTH_PACKAGE_BOOKS.map((libro) => ({
      libro,
      title: EXPORT_BOOK_INFO[libro].title,
      description: EXPORT_BOOK_INFO[libro].description,
      rows: counts[libro].rows,
      unit: counts[libro].unit,
    })),
  }
}
