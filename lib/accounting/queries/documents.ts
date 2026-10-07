import 'server-only'
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  ENTRY_KINDS,
  type EntryKind,
  FISCAL_AMOUNT_KEYS,
  type FiscalAmountKey,
  type Side,
} from '@/lib/accounting/types'
import {
  addDays,
  addMonthsToYearMonth,
  daysBetween,
  daysInMonth,
  eachIsoDay,
  endOfMonth,
  maxIsoDay,
  monthOf,
  toIsoDay,
} from '@/lib/dates/civil'
import { serviceDayInCordoba, todayInCordoba } from '@/lib/dates/zone'
import { parseVoucherNumber } from '@/lib/fiscal/voucher'
import { documentTitle, lineRoleLabel, type PaymentStatus } from './labels'
import {
  bool,
  callRpcRows,
  cents,
  centsOrNull,
  chunks,
  clampLimit,
  day,
  dayOrNull,
  decodePageToken,
  encodeCursor,
  instantOrNull,
  int,
  intOrNull,
  isRecord,
  isUuid,
  LIST_PAGE_SIZE,
  namesById,
  optionalDay,
  type QueryPage,
  queryError,
  readerClient,
  requireMonth,
  requireRange,
  settleQuery,
  str,
  strings,
  strOrNull,
  type UnknownRecord,
  uniqueIds,
} from './shared'

/**
 * Comprobantes, asientos y gastos fijos (H.7 Comprobantes/Pagos, H.9 Facturas,
 * H.14 detalle). Selects sobre `acc_*` con `tenant_id` explícito + RLS.
 *
 * «Pendiente» de un comprobante = lo abierto de sus partidas (las líneas con
 * partícipe del lado que deja deuda o crédito) menos las imputaciones vigentes,
 * igual que `acc_open_amount` sin fecha.
 */

export type DocumentStatusFilter = 'all' | 'posted' | 'unpaid' | 'partial' | 'paid' | 'voided'

export type DocumentListFilters = {
  /** Fecha contable, inclusiva. */
  from: string
  to: string
  kinds?: readonly DocumentKind[]
  partyId?: string | null
  /** `all` = vigentes y anulados; `posted` = solo vigentes. */
  status?: DocumentStatusFilter
  /** Busca en el detalle y el partícipe, o por número («1290», «0003-00001290», «#125»). */
  q?: string | null
  after?: string | null
  limit?: number | null
}

export type DocumentListRow = {
  id: string
  seq: number
  kind: DocumentKind
  /** «Factura A 0003-00001290», «Pago», «Cierre del día». */
  title: string
  voucherType: string | null
  pointOfSale: number | null
  number: number | null
  partyId: string | null
  partyName: string | null
  issueDate: string
  accountingDate: string
  dueDate: string | null
  description: string
  totalCents: number
  /**
   * Pendiente de sus partidas: lo que falta pagar o cobrar (facturas, cierres)
   * o lo que falta aplicar (notas de crédito). `null` si no deja partida.
   */
  openCents: number | null
  paymentStatus: PaymentStatus
  status: 'posted' | 'voided'
  /** La cuenta principal imputada («Mercadería»), en compras y gastos. */
  imputation: string | null
  /** Pagos y cobros: con qué cajas o cuentas («Banco Nación · $ 500.000»). `null` en los demás. */
  means: DocumentAmountItem[] | null
  /**
   * Pagos y cobros: qué comprobantes canceló (imputaciones vigentes que hizo
   * este comprobante, la más grande primero). `null` en los demás.
   */
  appliedTo: DocumentAmountItem[] | null
  createdByName: string
  createdAt: string
}

/** Un ítem con importe de una celda de lista («Caja · $ 1.000», «Factura A 0003-00001290 · $ 380.000»). */
export type DocumentAmountItem = {
  /** El comprobante o la caja, si se puede abrir. */
  id: string | null
  label: string
  amountCents: number
}

export type DocumentListPage = QueryPage<DocumentListRow> & {
  /** Con filtro de estado de pago se leen hasta 1.000 comprobantes del período: `true` si había más. */
  truncated: boolean
}

export type DocumentLineDetail = {
  id: string
  lineNo: number
  role: string
  /** El rol en palabras: «Neto 21 %», «IVA 21 %», «Percepción IIBB». */
  roleLabel: string
  accountId: string
  accountCode: string
  accountName: string
  side: Side
  amountCents: number
  partyId: string | null
  partyName: string | null
  dueDate: string | null
  treasuryAccountId: string | null
  treasuryName: string | null
  salesMethodId: string | null
  salesMethodName: string | null
  vatRateBp: number | null
  baseCents: number | null
  taxKind: string | null
  channel: string | null
  certificateNumber: string | null
  reference: string | null
  memo: string | null
}

export type FiscalVoucherDetail = {
  id: string
  book: 'purchases' | 'sales'
  periodMonth: string
  voucherDate: string
  voucherType: string
  afipVoucherCode: number | null
  isCreditNote: boolean
  isReversal: boolean
  pointOfSale: number
  numberFrom: number
  numberTo: number | null
  counterpartyName: string
  counterpartyDocType: number
  counterpartyDocNumber: string
  counterpartyIvaCondition: string
  channel: string | null
  /** Importes tal como están en el libro (positivos). */
  amounts: Record<FiscalAmountKey, number>
  voided: boolean
}

export type EntryLineDetail = {
  id: string
  lineNo: number
  accountId: string
  accountCode: string
  accountName: string
  side: Side
  amountCents: number
  partyId: string | null
  partyName: string | null
  dueDate: string | null
  memo: string | null
  /** Pendiente hoy si es una partida (línea con partícipe); `null` si no. */
  openCents: number | null
}

export type EntryDetail = {
  id: string
  documentId: string
  kind: EntryKind
  entryDate: string
  /** Número congelado; `null` mientras el mes está abierto (provisorio). */
  number: number | null
  /**
   * Mientras el mes está abierto, el número que le da hoy el diario (en
   * cursiva, «provisorio»: se fija al cerrar el mes). `null` si ya tiene número,
   * si está anulado o si no se pudo calcular.
   */
  provisionalNumber: number | null
  description: string
  totalCents: number
  status: 'posted' | 'voided'
  isMirror: boolean
  periodId: string
  periodStatus: 'open' | 'closed'
  createdByName: string
  createdAt: string
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  /** El comprobante del asiento (para el link «Ver comprobante»). */
  document: DocumentLink | null
  /** Primero el Debe, después el Haber (como el diario). */
  lines: EntryLineDetail[]
  debitCents: number
  creditCents: number
}

export type AllocationDetail = {
  id: string
  kind: string
  amountCents: number
  appliedOn: string
  voidedOn: string | null
  /** El otro comprobante (el pago que la canceló, o la factura que este pago canceló). */
  otherDocumentId: string | null
  otherDocumentTitle: string | null
  otherDocumentSeq: number | null
  createdByName: string
  createdAt: string
}

export type DocumentLink = {
  id: string
  seq: number
  title: string
  kind: DocumentKind
  accountingDate: string
  totalCents: number
  status: 'posted' | 'voided'
}

export type DocumentDetail = {
  id: string
  seq: number
  bundleId: string
  kind: DocumentKind
  title: string
  voucherType: string | null
  afipVoucherCode: number | null
  pointOfSale: number | null
  number: number | null
  partyId: string | null
  partyName: string | null
  partyDocNumber: string | null
  partyIvaCondition: string | null
  issueDate: string
  accountingDate: string
  dueDate: string | null
  shift: string | null
  description: string
  notes: string | null
  totalCents: number
  countedCents: number | null
  expectedBookCents: number | null
  settlesCommissions: boolean
  recurringExpenseId: string | null
  warningsAck: string[]
  overrideReason: string | null
  status: 'posted' | 'voided'
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  createdByName: string
  createdAt: string
  period: { id: string; month: string; kind: string; status: 'open' | 'closed' } | null
  lines: DocumentLineDetail[]
  fiscalVouchers: FiscalVoucherDetail[]
  entry: EntryDetail | null
  /** Pendiente de sus partidas hoy; `null` si no deja partida. */
  openCents: number | null
  paymentStatus: PaymentStatus
  /** Imputaciones de sus partidas (vigentes y desaplicadas), la más reciente primero. */
  allocations: AllocationDetail[]
  /** Otros comprobantes guardados juntos (el pago de un «Nuevo gasto», etc.). */
  bundleSiblings: DocumentLink[]
  related: DocumentLink | null
  replaces: DocumentLink | null
  replacedBy: DocumentLink | null
  reverses: DocumentLink | null
  reversedBy: DocumentLink | null
  corrects: DocumentLink | null
  /** «Deshacer» vale 10 minutos desde la carga (el servidor vuelve a chequear). */
  undoUntil: string
}

export type RecurringMonthStatus = 'loaded' | 'pending' | 'skipped' | 'upcoming'

export type RecurringExpenseRow = {
  id: string
  name: string
  partyId: string | null
  partyName: string | null
  accountId: string
  accountName: string | null
  voucherType: string | null
  vatRateBp: number | null
  /** `null` = monto variable. */
  amountCents: number | null
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly'
  dueDay: number
  nextDueDate: string
  remindDaysBefore: number
  treasuryAccountId: string | null
  treasuryName: string | null
  active: boolean
  lastDocumentId: string | null
  lastDocumentDate: string | null
  notes: string | null
  updatedAt: string
  /**
   * «Este mes»: `loaded` Cargado ✓ · `pending` vence este mes o ya venció ·
   * `skipped` se salteó · `upcoming` este mes no vence.
   */
  monthStatus: RecurringMonthStatus
  /** Días hasta el vencimiento (negativo = vencido). */
  daysToDue: number
}

// ─── Comunes ─────────────────────────────────────────────────────────────────

const UNDO_WINDOW_MS = 10 * 60 * 1000

function documentKind(value: unknown): DocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as readonly string[]).includes(value)
    ? (value as DocumentKind)
    : 'manual'
}

function entryKind(value: unknown): EntryKind {
  return typeof value === 'string' && (ENTRY_KINDS as readonly string[]).includes(value)
    ? (value as EntryKind)
    : 'standard'
}

function sideOf(value: unknown): Side {
  return value === 'credit' ? 'credit' : 'debit'
}

function statusOf(value: unknown): 'posted' | 'voided' {
  return value === 'voided' ? 'voided' : 'posted'
}

// ─── Partidas y abierto ──────────────────────────────────────────────────────

/**
 * De qué lado quedan las partidas que deja cada tipo (las que se pagan, cobran
 * o aplican). En pagos y cobros, la partida es lo que quedó a cuenta.
 */
const PARTIDA_SIDE: Partial<Record<DocumentKind, Side>> = {
  purchase: 'credit',
  purchase_debit_note: 'credit',
  iva_settlement: 'credit',
  purchase_credit_note: 'debit',
  sales_invoice: 'debit',
  sales_debit_note: 'debit',
  sales_close: 'debit',
  sales_credit_note: 'credit',
  payment: 'debit',
  collection: 'credit',
}

/** Pagos y cobros: muestran sus medios y lo que cancelaron. */
const SETTLEMENT_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>(['payment', 'collection'])

/** Lecturas que traen varias filas por id: tandas más chicas (PostgREST corta en 1.000 filas). */
const MULTI_ROW_CHUNK = 40

/** Los que se leen como «Impaga · Pago parcial · Pagada» (deuda o crédito a cobrar). */
const STATUS_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_debit_note',
  'iva_settlement',
  'sales_invoice',
  'sales_debit_note',
  'sales_close',
])

type PartidaLine = { id: string; documentId: string; side: Side; amountCents: number }

type DocBase = {
  id: string
  seq: number
  kind: DocumentKind
  voucherType: string | null
  pointOfSale: number | null
  number: number | null
  partyId: string | null
  partyName: string | null
  issueDate: string
  accountingDate: string
  dueDate: string | null
  description: string
  totalCents: number
  status: 'posted' | 'voided'
  controlAccountId: string | null
  createdByName: string
  createdAt: string
}

const DOC_LIST_COLUMNS =
  'id, seq, kind, voucher_type, point_of_sale, number, party_id, party_name_snapshot, issue_date, accounting_date, due_date, description, total_cents, status, control_account_id, created_by_name, created_at'

function parseDocBase(row: UnknownRecord): DocBase {
  return {
    id: str(row.id),
    seq: int(row.seq),
    kind: documentKind(row.kind),
    voucherType: strOrNull(row.voucher_type),
    pointOfSale: intOrNull(row.point_of_sale),
    number: intOrNull(row.number),
    partyId: strOrNull(row.party_id),
    partyName: strOrNull(row.party_name_snapshot),
    issueDate: day(row.issue_date),
    accountingDate: day(row.accounting_date),
    dueDate: dayOrNull(row.due_date),
    description: str(row.description),
    totalCents: cents(row.total_cents),
    status: statusOf(row.status),
    controlAccountId: strOrNull(row.control_account_id),
    createdByName: str(row.created_by_name),
    createdAt: str(row.created_at),
  }
}

function titleOf(doc: {
  kind: string
  voucherType: string | null
  pointOfSale: number | null
  number: number | null
}): string {
  return documentTitle(doc)
}

/**
 * Las cuentas de «IVA a documentar» (`vat_credit_pending`): sus partidas no
 * son deuda ni crédito con el partícipe (la factura mensual de comisiones las
 * libera), así que no cuentan para el pendiente, igual que en F.7.
 */
async function vatPendingAccounts(tenantId: string): Promise<Set<string>> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('system_key', 'vat_credit_pending')
  if (error) throw queryError('acc_accounts', error)
  return new Set(((data ?? []) as unknown[]).filter(isRecord).map((row) => str(row.id)))
}

/** ¿Esta línea con partícipe es una partida del comprobante (para su pendiente)? */
function isPartida(
  doc: { kind: DocumentKind; controlAccountId: string | null },
  line: { side: Side; accountId: string },
  excluded: ReadonlySet<string>,
): boolean {
  if (line.side !== PARTIDA_SIDE[doc.kind]) return false
  if (excluded.has(line.accountId)) return false
  return !doc.controlAccountId || line.accountId === doc.controlAccountId
}

/**
 * Las partidas de cada comprobante: líneas con partícipe del lado que deja
 * deuda o crédito, de su cuenta de control si la tiene, nunca de «IVA a
 * documentar».
 */
async function loadPartidas(
  tenantId: string,
  docs: readonly DocBase[],
): Promise<Map<string, PartidaLine[]>> {
  const wanted = docs.filter((d) => d.status === 'posted' && PARTIDA_SIDE[d.kind] !== undefined)
  const out = new Map<string, PartidaLine[]>()
  if (wanted.length === 0) return out
  const byId = new Map(wanted.map((d) => [d.id, d]))
  const supabase = await readerClient()
  const [excluded, results] = await Promise.all([
    vatPendingAccounts(tenantId),
    Promise.all(
      chunks(
        wanted.map((d) => d.id),
        MULTI_ROW_CHUNK,
      ).map((chunk) =>
        supabase
          .from('acc_journal_lines')
          .select('id, document_id, account_id, side, amount_cents')
          .eq('tenant_id', tenantId)
          .in('document_id', chunk)
          .not('party_id', 'is', null),
      ),
    ),
  ])
  for (const result of results) {
    if (result.error) throw queryError('acc_journal_lines', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const doc = byId.get(str(row.document_id))
      if (!doc) continue
      const side = sideOf(row.side)
      if (!isPartida(doc, { side, accountId: str(row.account_id) }, excluded)) continue
      const list = out.get(doc.id) ?? []
      list.push({ id: str(row.id), documentId: doc.id, side, amountCents: cents(row.amount_cents) })
      out.set(doc.id, list)
    }
  }
  return out
}

/** Σ imputaciones vigentes (sin desaplicar) por partida, del lado de cada una. */
async function loadAllocatedSums(
  tenantId: string,
  lines: readonly PartidaLine[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (lines.length === 0) return out
  const supabase = await readerClient()
  const debit = lines.filter((l) => l.side === 'debit').map((l) => l.id)
  const credit = lines.filter((l) => l.side === 'credit').map((l) => l.id)
  const queries = [
    ...chunks(debit, MULTI_ROW_CHUNK).map((chunk) =>
      supabase
        .from('acc_allocations')
        .select('debit_line_id, amount_cents')
        .eq('tenant_id', tenantId)
        .in('debit_line_id', chunk)
        .is('voided_on', null)
        .then((r) => ({ ...r, key: 'debit_line_id' as const })),
    ),
    ...chunks(credit, MULTI_ROW_CHUNK).map((chunk) =>
      supabase
        .from('acc_allocations')
        .select('credit_line_id, amount_cents')
        .eq('tenant_id', tenantId)
        .in('credit_line_id', chunk)
        .is('voided_on', null)
        .then((r) => ({ ...r, key: 'credit_line_id' as const })),
    ),
  ]
  for (const result of await Promise.all(queries)) {
    if (result.error) throw queryError('acc_allocations', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const id = str(row[result.key])
      out.set(id, (out.get(id) ?? 0) + cents(row.amount_cents))
    }
  }
  return out
}

function openInfo(
  doc: { kind: DocumentKind; status: 'posted' | 'voided'; id: string },
  partidas: ReadonlyMap<string, PartidaLine[]>,
  allocated: ReadonlyMap<string, number>,
): { openCents: number | null; paymentStatus: PaymentStatus } {
  if (doc.status === 'voided') return { openCents: null, paymentStatus: 'voided' }
  const lines = partidas.get(doc.id)
  if (PARTIDA_SIDE[doc.kind] === undefined || !lines || lines.length === 0) {
    return { openCents: null, paymentStatus: 'none' }
  }
  let amount = 0
  let open = 0
  for (const line of lines) {
    amount += line.amountCents
    open += Math.max(0, line.amountCents - (allocated.get(line.id) ?? 0))
  }
  if (!STATUS_KINDS.has(doc.kind)) return { openCents: open, paymentStatus: 'none' }
  const paymentStatus: PaymentStatus = open <= 0 ? 'paid' : open >= amount ? 'unpaid' : 'partial'
  return { openCents: open, paymentStatus }
}

/** Roles de los renglones que dicen «en qué» se gastó. */
const IMPUTATION_ROLES = ['net', 'gross', 'non_taxed', 'exempt'] as const
const IMPUTATION_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'purchase',
  'purchase_credit_note',
  'purchase_debit_note',
  'expense',
])

/** La cuenta del renglón de mayor importe de cada compra o gasto. */
async function loadImputations(
  tenantId: string,
  docs: readonly DocBase[],
): Promise<Map<string, string>> {
  const ids = docs.filter((d) => IMPUTATION_KINDS.has(d.kind)).map((d) => d.id)
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const supabase = await readerClient()
  const results = await Promise.all(
    chunks(ids, MULTI_ROW_CHUNK).map((chunk) =>
      supabase
        .from('acc_document_lines')
        .select('document_id, account_id, amount_cents')
        .eq('tenant_id', tenantId)
        .in('document_id', chunk)
        .in('role', IMPUTATION_ROLES),
    ),
  )
  const best = new Map<string, { accountId: string; amount: number }>()
  for (const result of results) {
    if (result.error) throw queryError('acc_document_lines', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const docId = str(row.document_id)
      const amount = cents(row.amount_cents)
      const current = best.get(docId)
      if (!current || amount > current.amount) {
        best.set(docId, { accountId: str(row.account_id), amount })
      }
    }
  }
  const names = await namesById(
    tenantId,
    'acc_accounts',
    [...best.values()].map((b) => b.accountId),
  )
  for (const [docId, b] of best) {
    const account = names.get(b.accountId)
    if (account) out.set(docId, str(account.name))
  }
  return out
}

type SettlementInfo = { means: DocumentAmountItem[]; appliedTo: DocumentAmountItem[] }

/** «Banco Nación · $ 500.000» primero el más grande; mismo importe, por nombre. */
function byAmountDesc(a: DocumentAmountItem, b: DocumentAmountItem): number {
  return b.amountCents - a.amountCents || a.label.localeCompare(b.label, 'es')
}

/**
 * Pagos y cobros: con qué cajas se movió la plata (renglones `treasury`) y qué
 * comprobantes cancelaron: las imputaciones vigentes que hizo cada uno (en un
 * pago, las partidas de deuda del Haber; en un cobro, las del Debe), más las
 * que después consumieron lo que quedó a cuenta (un «Imputar» o un pago
 * posterior que usó ese saldo a favor).
 */
async function loadSettlements(
  tenantId: string,
  docs: readonly DocBase[],
  partidas: ReadonlyMap<string, PartidaLine[]>,
): Promise<Map<string, SettlementInfo>> {
  const wanted = docs.filter((d) => SETTLEMENT_KINDS.has(d.kind))
  const out = new Map<string, SettlementInfo>()
  if (wanted.length === 0) return out
  for (const d of wanted) out.set(d.id, { means: [], appliedTo: [] })
  const kindOf = new Map(wanted.map((d) => [d.id, d.kind]))
  const ids = wanted.map((d) => d.id)
  // Lo que quedó a cuenta: la partida propia de cada pago (Debe) o cobro (Haber).
  const ownerOfLine = new Map<string, string>()
  const paymentLines: string[] = []
  const collectionLines: string[] = []
  for (const d of wanted) {
    for (const line of partidas.get(d.id) ?? []) {
      ownerOfLine.set(line.id, d.id)
      if (d.kind === 'payment') paymentLines.push(line.id)
      else collectionLines.push(line.id)
    }
  }
  const supabase = await readerClient()
  const ALLOCATION_COLUMNS = 'id, document_id, debit_line_id, credit_line_id, amount_cents'

  const [lineResults, allocationResults] = await Promise.all([
    Promise.all(
      chunks(ids, MULTI_ROW_CHUNK).map((chunk) =>
        supabase
          .from('acc_document_lines')
          .select('document_id, treasury_account_id, amount_cents')
          .eq('tenant_id', tenantId)
          .in('document_id', chunk)
          .eq('role', 'treasury'),
      ),
    ),
    Promise.all([
      ...chunks(ids, MULTI_ROW_CHUNK).map((chunk) =>
        supabase
          .from('acc_allocations')
          .select(ALLOCATION_COLUMNS)
          .eq('tenant_id', tenantId)
          .in('document_id', chunk)
          .is('voided_on', null),
      ),
      ...chunks(paymentLines, MULTI_ROW_CHUNK).map((chunk) =>
        supabase
          .from('acc_allocations')
          .select(ALLOCATION_COLUMNS)
          .eq('tenant_id', tenantId)
          .in('debit_line_id', chunk)
          .is('voided_on', null),
      ),
      ...chunks(collectionLines, MULTI_ROW_CHUNK).map((chunk) =>
        supabase
          .from('acc_allocations')
          .select(ALLOCATION_COLUMNS)
          .eq('tenant_id', tenantId)
          .in('credit_line_id', chunk)
          .is('voided_on', null),
      ),
    ]),
  ])

  // Medios: Σ por caja de cada comprobante.
  const meansRaw = new Map<string, Map<string, number>>()
  for (const result of lineResults) {
    if (result.error) throw queryError('acc_document_lines', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const docId = str(row.document_id)
      const treasuryId = str(row.treasury_account_id)
      if (!treasuryId) continue
      const perDoc = meansRaw.get(docId) ?? new Map<string, number>()
      perDoc.set(treasuryId, (perDoc.get(treasuryId) ?? 0) + cents(row.amount_cents))
      meansRaw.set(docId, perDoc)
    }
  }

  // Aplicado a: la partida de deuda de cada imputación (Haber en pagos, Debe en cobros).
  const appliedRaw = new Map<string, Map<string, number>>()
  const seenAllocations = new Set<string>()
  for (const result of allocationResults) {
    if (result.error) throw queryError('acc_allocations', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const allocationId = str(row.id)
      if (seenAllocations.has(allocationId)) continue
      seenAllocations.add(allocationId)
      const debitLine = str(row.debit_line_id)
      const creditLine = str(row.credit_line_id)
      // Una imputación cuenta para el pago o cobro que la hizo y para el que
      // tenía a cuenta la partida que consumió (pueden ser dos distintos).
      const owners = new Set<string>()
      const creator = str(row.document_id)
      if (kindOf.has(creator)) owners.add(creator)
      const debitOwner = ownerOfLine.get(debitLine)
      if (debitOwner && kindOf.get(debitOwner) === 'payment') owners.add(debitOwner)
      const creditOwner = ownerOfLine.get(creditLine)
      if (creditOwner && kindOf.get(creditOwner) === 'collection') owners.add(creditOwner)
      for (const owner of owners) {
        const target = kindOf.get(owner) === 'payment' ? creditLine : debitLine
        if (!target) continue
        const perDoc = appliedRaw.get(owner) ?? new Map<string, number>()
        perDoc.set(target, (perDoc.get(target) ?? 0) + cents(row.amount_cents))
        appliedRaw.set(owner, perDoc)
      }
    }
  }

  const lineIds = [...appliedRaw.values()].flatMap((m) => [...m.keys()])
  const [treasuries, docOfLine] = await Promise.all([
    namesById(
      tenantId,
      'acc_treasury_accounts',
      [...meansRaw.values()].flatMap((m) => [...m.keys()]),
    ),
    documentsOfLines(tenantId, lineIds),
  ])
  const linkedDocs = await namesById(
    tenantId,
    'acc_documents',
    [...new Set(docOfLine.values())],
    DOC_LINK_COLUMNS,
  )

  for (const [docId, perDoc] of meansRaw) {
    const info = out.get(docId)
    if (!info) continue
    for (const [treasuryId, amount] of perDoc) {
      const treasury = treasuries.get(treasuryId)
      info.means.push({
        id: treasuryId,
        label: treasury ? str(treasury.name) : 'Caja o cuenta',
        amountCents: amount,
      })
    }
    info.means.sort(byAmountDesc)
  }
  for (const [docId, perDoc] of appliedRaw) {
    const info = out.get(docId)
    if (!info) continue
    // Varias partidas del mismo comprobante (por ejemplo, un cierre del día con
    // dos tarjetas) se juntan en una sola fila.
    const perTarget = new Map<string, DocumentAmountItem>()
    for (const [lineId, amount] of perDoc) {
      const targetId = docOfLine.get(lineId) ?? null
      const row = targetId ? linkedDocs.get(targetId) : undefined
      const key = targetId ?? lineId
      const current = perTarget.get(key)
      if (current) {
        current.amountCents += amount
      } else {
        perTarget.set(key, {
          id: row ? targetId : null,
          label: row ? toLink(row).title : 'Comprobante',
          amountCents: amount,
        })
      }
    }
    info.appliedTo = [...perTarget.values()].sort(byAmountDesc)
  }
  return out
}

/** El comprobante de cada línea del diario (para nombrar lo que canceló un pago o un cobro). */
async function documentsOfLines(
  tenantId: string,
  lineIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = uniqueIds(lineIds)
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const supabase = await readerClient()
  const results = await Promise.all(
    chunks(ids).map((chunk) =>
      supabase
        .from('acc_journal_lines')
        .select('id, document_id')
        .eq('tenant_id', tenantId)
        .in('id', chunk),
    ),
  )
  for (const result of results) {
    if (result.error) throw queryError('acc_journal_lines', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (isRecord(row)) out.set(str(row.id), str(row.document_id))
    }
  }
  return out
}

async function enrichDocuments(
  tenantId: string,
  docs: readonly DocBase[],
): Promise<DocumentListRow[]> {
  const [partidas, imputations] = await Promise.all([
    loadPartidas(tenantId, docs),
    loadImputations(tenantId, docs),
  ])
  const [allocated, settlements] = await Promise.all([
    loadAllocatedSums(tenantId, [...partidas.values()].flat()),
    loadSettlements(tenantId, docs, partidas),
  ])
  return docs.map((doc) => {
    const { openCents, paymentStatus } = openInfo(doc, partidas, allocated)
    const settlement = settlements.get(doc.id) ?? null
    return {
      id: doc.id,
      seq: doc.seq,
      kind: doc.kind,
      title: titleOf(doc),
      voucherType: doc.voucherType,
      pointOfSale: doc.pointOfSale,
      number: doc.number,
      partyId: doc.partyId,
      partyName: doc.partyName,
      issueDate: doc.issueDate,
      accountingDate: doc.accountingDate,
      dueDate: doc.dueDate,
      description: doc.description,
      totalCents: doc.totalCents,
      openCents,
      paymentStatus,
      status: doc.status,
      imputation: imputations.get(doc.id) ?? null,
      means: settlement ? settlement.means : null,
      appliedTo: settlement ? settlement.appliedTo : null,
      createdByName: doc.createdByName,
      createdAt: doc.createdAt,
    }
  })
}

/** Lo que PostgREST no deja pasar dentro de un `or=(…)`: se cambia por espacios. */
function cleanSearch(q: string): string {
  return q
    .replace(/[,()*%\\:"'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

const PAYMENT_STATUS_FILTERS: ReadonlySet<DocumentStatusFilter> = new Set([
  'unpaid',
  'partial',
  'paid',
])
/** Tope de comprobantes que se leen para filtrar por estado de pago. */
const STATUS_SCAN_LIMIT = 1000

/**
 * Comprobantes del período (H.7 «Comprobantes» y «Pagos», H.9 «Facturas»), el
 * más nuevo primero, 50 por página (`?despues=`). Cada fila trae su pendiente
 * y su estado de pago. Con filtro de estado de pago se leen hasta 1.000
 * comprobantes del período (`truncated` avisa si había más).
 */
export async function listDocuments(
  tenantId: string,
  filters: DocumentListFilters,
): Promise<DocumentListPage> {
  const { from, to } = requireRange(filters.from, filters.to)
  const status = filters.status ?? 'all'
  const limit = clampLimit(filters.limit, LIST_PAGE_SIZE, 200)
  const token = decodePageToken(filters.after)
  const offset = token ? Math.max(0, int(token.cursor.o)) : 0
  const byPaymentStatus = PAYMENT_STATUS_FILTERS.has(status)

  const supabase = await readerClient()
  let query = supabase
    .from('acc_documents')
    .select(DOC_LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .gte('accounting_date', from)
    .lte('accounting_date', to)

  let kinds = (filters.kinds ?? []).filter((k) => (DOCUMENT_KINDS as readonly string[]).includes(k))
  if (byPaymentStatus) {
    kinds = (kinds.length > 0 ? kinds : [...STATUS_KINDS]).filter((k) => STATUS_KINDS.has(k))
    if (kinds.length === 0) {
      return { rows: [], nextCursor: null, totalRows: 0, truncated: false }
    }
  }
  if (kinds.length > 0) query = query.in('kind', kinds)
  if (filters.partyId) {
    if (!isUuid(filters.partyId)) {
      return { rows: [], nextCursor: null, totalRows: 0, truncated: false }
    }
    query = query.eq('party_id', filters.partyId)
  }
  if (status === 'voided') query = query.eq('status', 'voided')
  else if (status !== 'all') query = query.eq('status', 'posted')

  const raw = filters.q?.trim() ?? ''
  if (raw) {
    const voucher = parseVoucherNumber(raw)
    const numeric = /^#?\s*(\d{1,10})$/.exec(raw)
    if (voucher) {
      query = query.eq('point_of_sale', voucher.pointOfSale).eq('number', voucher.number)
    } else if (numeric?.[1]) {
      const n = Number(numeric[1])
      query = raw.startsWith('#')
        ? query.eq('seq', n)
        : query.or(`number.eq.${n},seq.eq.${n},description.ilike.*${n}*`)
    } else {
      const text = cleanSearch(raw)
      if (text) {
        query = query.or(`description.ilike.*${text}*,party_name_snapshot.ilike.*${text}*`)
      }
    }
  }

  query = query.order('accounting_date', { ascending: false }).order('seq', { ascending: false })

  if (byPaymentStatus) {
    const { data, error, count } = await query.range(0, STATUS_SCAN_LIMIT - 1)
    if (error) throw queryError('acc_documents', error)
    const docs = ((data ?? []) as unknown[]).filter(isRecord).map(parseDocBase)
    const enriched = (await enrichDocuments(tenantId, docs)).filter(
      (row) => row.paymentStatus === status,
    )
    const rows = enriched.slice(offset, offset + limit)
    const seen = offset + rows.length
    return {
      rows,
      nextCursor: seen < enriched.length ? encodeCursor({ o: offset + limit }, seen) : null,
      totalRows: enriched.length,
      truncated: (count ?? 0) > STATUS_SCAN_LIMIT,
    }
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw queryError('acc_documents', error)
  const docs = ((data ?? []) as unknown[]).filter(isRecord).map(parseDocBase)
  const rows = await enrichDocuments(tenantId, docs)
  const total = count ?? offset + rows.length
  const seen = offset + rows.length
  return {
    rows,
    nextCursor:
      rows.length === limit && seen < total ? encodeCursor({ o: offset + limit }, seen) : null,
    totalRows: total,
    truncated: false,
  }
}

// ─── Detalle ─────────────────────────────────────────────────────────────────

const DOC_DETAIL_COLUMNS =
  'id, bundle_id, period_id, seq, kind, voucher_type, afip_voucher_code, party_id, party_name_snapshot, party_doc_number_snapshot, party_iva_condition_snapshot, issue_date, accounting_date, due_date, point_of_sale, number, shift, description, notes, total_cents, control_account_id, related_document_id, replaces_document_id, reverses_document_id, corrects_document_id, recurring_expense_id, settles_commissions, counted_cents, expected_book_cents, warnings_ack, override_reason, status, voided_at, voided_by_name, void_reason, created_by_name, created_at'

const DOC_LINK_COLUMNS =
  'id, seq, kind, voucher_type, point_of_sale, number, accounting_date, total_cents, status, bundle_id, replaces_document_id, reverses_document_id'

const ENTRY_COLUMNS =
  'id, document_id, period_id, kind, entry_date, number, description, total_cents, status, is_mirror, created_by_name, created_at, voided_at, voided_by_name, void_reason'

const JOURNAL_LINE_COLUMNS =
  'id, entry_id, document_id, line_no, account_id, side, amount_cents, party_id, due_date, memo'

function toLink(row: UnknownRecord): DocumentLink {
  const kind = documentKind(row.kind)
  return {
    id: str(row.id),
    seq: int(row.seq),
    title: titleOf({
      kind,
      voucherType: strOrNull(row.voucher_type),
      pointOfSale: intOrNull(row.point_of_sale),
      number: intOrNull(row.number),
    }),
    kind,
    accountingDate: day(row.accounting_date),
    totalCents: cents(row.total_cents),
    status: statusOf(row.status),
  }
}

function fiscalAmounts(row: UnknownRecord): Record<FiscalAmountKey, number> {
  const out = {} as Record<FiscalAmountKey, number>
  for (const key of FISCAL_AMOUNT_KEYS) out[key] = cents(row[key])
  return out
}

type JournalLineRaw = {
  id: string
  entryId: string
  documentId: string
  lineNo: number
  accountId: string
  side: Side
  amountCents: number
  partyId: string | null
  dueDate: string | null
  memo: string | null
}

function parseJournalLineRaw(row: UnknownRecord): JournalLineRaw {
  return {
    id: str(row.id),
    entryId: str(row.entry_id),
    documentId: str(row.document_id),
    lineNo: int(row.line_no),
    accountId: str(row.account_id),
    side: sideOf(row.side),
    amountCents: cents(row.amount_cents),
    partyId: strOrNull(row.party_id),
    dueDate: dayOrNull(row.due_date),
    memo: strOrNull(row.memo),
  }
}

type AllocationRaw = {
  id: string
  kind: string
  amountCents: number
  appliedOn: string
  voidedOn: string | null
  debitLineId: string
  creditLineId: string
  createdByName: string
  createdAt: string
}

async function loadAllocationsFor(
  tenantId: string,
  lineIds: readonly string[],
): Promise<AllocationRaw[]> {
  const ids = uniqueIds(lineIds)
  if (ids.length === 0) return []
  const supabase = await readerClient()
  const results = await Promise.all(
    chunks(ids, 50).map((chunk) => {
      const list = chunk.join(',')
      return supabase
        .from('acc_allocations')
        .select(
          'id, kind, amount_cents, applied_on, voided_on, debit_line_id, credit_line_id, created_by_name, created_at',
        )
        .eq('tenant_id', tenantId)
        .or(`debit_line_id.in.(${list}),credit_line_id.in.(${list})`)
    }),
  )
  const seen = new Set<string>()
  const out: AllocationRaw[] = []
  for (const result of results) {
    if (result.error) throw queryError('acc_allocations', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (!isRecord(row)) continue
      const id = str(row.id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        kind: str(row.kind),
        amountCents: cents(row.amount_cents),
        appliedOn: day(row.applied_on),
        voidedOn: dayOrNull(row.voided_on),
        debitLineId: str(row.debit_line_id),
        creditLineId: str(row.credit_line_id),
        createdByName: str(row.created_by_name),
        createdAt: str(row.created_at),
      })
    }
  }
  return out
}

/** Σ imputaciones vigentes de cada partida (para el pendiente de las líneas del asiento). */
function allocatedByLine(allocations: readonly AllocationRaw[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of allocations) {
    if (a.voidedOn !== null) continue
    out.set(a.debitLineId, (out.get(a.debitLineId) ?? 0) + a.amountCents)
    out.set(a.creditLineId, (out.get(a.creditLineId) ?? 0) + a.amountCents)
  }
  return out
}

/**
 * El número provisorio de un asiento de un mes abierto: el mismo que muestra el
 * diario (`acc_report_journal` del día del asiento). Si no se puede calcular,
 * `null` (la pantalla dice «Provisorio» sin número).
 */
async function provisionalNumberOf(
  tenantId: string,
  entryId: string,
  entryDate: string,
): Promise<number | null> {
  if (!entryDate) return null
  const outcome = await settleQuery(
    callRpcRows('acc_report_journal', {
      p_tenant_id: tenantId,
      p_from: entryDate,
      p_to: entryDate,
      p_after: null,
      p_limit: 200,
    }),
  )
  if (!outcome.ok) return null
  const row = outcome.data.find((r) => r.entry_id === entryId)
  return row ? intOrNull(row.number) : null
}

async function buildEntryDetail(
  tenantId: string,
  entryRow: UnknownRecord,
  lines: readonly JournalLineRaw[],
  allocations: readonly AllocationRaw[],
  periodStatus: 'open' | 'closed',
  document: DocumentLink | null,
): Promise<EntryDetail> {
  const number = intOrNull(entryRow.number)
  const needsProvisional = number === null && statusOf(entryRow.status) === 'posted'
  const [accounts, parties, provisionalNumber] = await Promise.all([
    namesById(
      tenantId,
      'acc_accounts',
      lines.map((l) => l.accountId),
      'id, code, name',
    ),
    namesById(
      tenantId,
      'acc_parties',
      lines.map((l) => l.partyId),
    ),
    needsProvisional
      ? provisionalNumberOf(tenantId, str(entryRow.id), day(entryRow.entry_date))
      : Promise.resolve(null),
  ])
  const allocated = allocatedByLine(allocations)
  const detailLines: EntryLineDetail[] = lines
    .map((l) => {
      const account = accounts.get(l.accountId)
      const party = l.partyId ? parties.get(l.partyId) : undefined
      return {
        id: l.id,
        lineNo: l.lineNo,
        accountId: l.accountId,
        accountCode: account ? str(account.code) : '',
        accountName: account ? str(account.name) : '',
        side: l.side,
        amountCents: l.amountCents,
        partyId: l.partyId,
        partyName: party ? str(party.name) : null,
        dueDate: l.dueDate,
        memo: l.memo,
        openCents: l.partyId ? Math.max(0, l.amountCents - (allocated.get(l.id) ?? 0)) : null,
      }
    })
    .sort((a, b) => (a.side === b.side ? a.lineNo - b.lineNo : a.side === 'debit' ? -1 : 1))
  let debitCents = 0
  let creditCents = 0
  for (const l of detailLines) {
    if (l.side === 'debit') debitCents += l.amountCents
    else creditCents += l.amountCents
  }
  return {
    id: str(entryRow.id),
    documentId: str(entryRow.document_id),
    kind: entryKind(entryRow.kind),
    entryDate: day(entryRow.entry_date),
    number,
    provisionalNumber,
    description: str(entryRow.description),
    totalCents: cents(entryRow.total_cents),
    status: statusOf(entryRow.status),
    isMirror: bool(entryRow.is_mirror),
    periodId: str(entryRow.period_id),
    periodStatus,
    createdByName: str(entryRow.created_by_name),
    createdAt: str(entryRow.created_at),
    voidedAt: instantOrNull(entryRow.voided_at),
    voidedByName: strOrNull(entryRow.voided_by_name),
    voidReason: strOrNull(entryRow.void_reason),
    document,
    lines: detailLines,
    debitCents,
    creditCents,
  }
}

/** El otro comprobante de cada imputación (el pago de una factura, la factura de un pago). */
async function allocationDetails(
  tenantId: string,
  allocations: readonly AllocationRaw[],
  ownLineIds: ReadonlySet<string>,
): Promise<AllocationDetail[]> {
  if (allocations.length === 0) return []
  const otherLineIds = allocations.map((a) =>
    ownLineIds.has(a.debitLineId) ? a.creditLineId : a.debitLineId,
  )
  const supabase = await readerClient()
  const lineResults = await Promise.all(
    chunks(uniqueIds(otherLineIds)).map((chunk) =>
      supabase
        .from('acc_journal_lines')
        .select('id, document_id')
        .eq('tenant_id', tenantId)
        .in('id', chunk),
    ),
  )
  const docOfLine = new Map<string, string>()
  for (const result of lineResults) {
    if (result.error) throw queryError('acc_journal_lines', result.error)
    for (const row of (result.data ?? []) as unknown[]) {
      if (isRecord(row)) docOfLine.set(str(row.id), str(row.document_id))
    }
  }
  const docs = await namesById(tenantId, 'acc_documents', [...docOfLine.values()], DOC_LINK_COLUMNS)
  return allocations
    .map((a, i) => {
      const otherLine = otherLineIds[i] ?? ''
      const docId = docOfLine.get(otherLine) ?? null
      const doc = docId ? docs.get(docId) : undefined
      const link = doc ? toLink(doc) : null
      return {
        id: a.id,
        kind: a.kind,
        amountCents: a.amountCents,
        appliedOn: a.appliedOn,
        voidedOn: a.voidedOn,
        otherDocumentId: docId,
        otherDocumentTitle: link?.title ?? null,
        otherDocumentSeq: link?.seq ?? null,
        createdByName: a.createdByName,
        createdAt: a.createdAt,
      }
    })
    .sort(
      (a, b) => b.appliedOn.localeCompare(a.appliedOn) || b.createdAt.localeCompare(a.createdAt),
    )
}

/**
 * Un comprobante con todo lo que muestra su detalle (H.14): renglones,
 * comprobante fiscal, asiento, imputaciones e historia (reemplazos,
 * anulaciones, lo guardado junto). `null` si no existe en este bar.
 */
export async function getDocument(
  tenantId: string,
  documentId: string,
): Promise<DocumentDetail | null> {
  if (!isUuid(documentId)) return null
  const supabase = await readerClient()
  const docResult = await supabase
    .from('acc_documents')
    .select(DOC_DETAIL_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', documentId)
    .maybeSingle()
  if (docResult.error) throw queryError('acc_documents', docResult.error)
  if (!isRecord(docResult.data)) return null
  const doc = docResult.data
  const kind = documentKind(doc.kind)

  const linkIds = uniqueIds([
    doc.related_document_id,
    doc.replaces_document_id,
    doc.reverses_document_id,
    doc.corrects_document_id,
  ])
  const linkFilter = [
    `bundle_id.eq.${str(doc.bundle_id)}`,
    `replaces_document_id.eq.${documentId}`,
    `reverses_document_id.eq.${documentId}`,
    ...(linkIds.length > 0 ? [`id.in.(${linkIds.join(',')})`] : []),
  ].join(',')

  const [linesResult, vouchersResult, entryResult, jlResult, periodResult, linksResult] =
    await Promise.all([
      supabase
        .from('acc_document_lines')
        .select(
          'id, line_no, role, account_id, side, amount_cents, party_id, due_date, treasury_account_id, sales_method_id, vat_rate_bp, base_cents, tax_kind, channel, certificate_number, reference, memo',
        )
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .order('line_no', { ascending: true }),
      supabase
        .from('acc_fiscal_vouchers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId),
      supabase
        .from('acc_journal_entries')
        .select(ENTRY_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .maybeSingle(),
      supabase
        .from('acc_journal_lines')
        .select(JOURNAL_LINE_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .order('line_no', { ascending: true }),
      supabase
        .from('acc_periods')
        .select('id, month, kind, status')
        .eq('tenant_id', tenantId)
        .eq('id', str(doc.period_id))
        .maybeSingle(),
      supabase
        .from('acc_documents')
        .select(DOC_LINK_COLUMNS)
        .eq('tenant_id', tenantId)
        .or(linkFilter),
    ])
  if (linesResult.error) throw queryError('acc_document_lines', linesResult.error)
  if (vouchersResult.error) throw queryError('acc_fiscal_vouchers', vouchersResult.error)
  if (entryResult.error) throw queryError('acc_journal_entries', entryResult.error)
  if (jlResult.error) throw queryError('acc_journal_lines', jlResult.error)
  if (periodResult.error) throw queryError('acc_periods', periodResult.error)
  if (linksResult.error) throw queryError('acc_documents', linksResult.error)

  const docLines = ((linesResult.data ?? []) as unknown[]).filter(isRecord)
  const journalLines = ((jlResult.data ?? []) as unknown[])
    .filter(isRecord)
    .map(parseJournalLineRaw)
  const period = isRecord(periodResult.data) ? periodResult.data : null
  const periodStatus: 'open' | 'closed' = period?.status === 'closed' ? 'closed' : 'open'

  const partyLineIds = journalLines.filter((l) => l.partyId !== null).map((l) => l.id)
  const [allocations, accounts, parties, treasuries, methods] = await Promise.all([
    loadAllocationsFor(tenantId, partyLineIds),
    namesById(
      tenantId,
      'acc_accounts',
      docLines.map((l) => l.account_id),
      'id, code, name',
    ),
    namesById(
      tenantId,
      'acc_parties',
      docLines.map((l) => l.party_id),
    ),
    namesById(
      tenantId,
      'acc_treasury_accounts',
      docLines.map((l) => l.treasury_account_id),
    ),
    namesById(
      tenantId,
      'acc_sales_methods',
      docLines.map((l) => l.sales_method_id),
    ),
  ])

  const entry = isRecord(entryResult.data)
    ? await buildEntryDetail(
        tenantId,
        entryResult.data,
        journalLines,
        allocations,
        periodStatus,
        toLink(doc),
      )
    : null

  const ownLineIds = new Set(journalLines.map((l) => l.id))
  const allocationList = await allocationDetails(tenantId, allocations, ownLineIds)

  // Pendiente: mismas reglas que la lista (partidas del lado que deja deuda o crédito).
  const docBase = parseDocBase(doc)
  const partidas = new Map<string, PartidaLine[]>()
  if (PARTIDA_SIDE[kind]) {
    const excluded = await vatPendingAccounts(tenantId)
    partidas.set(
      documentId,
      journalLines
        .filter((l) => l.partyId !== null && isPartida(docBase, l, excluded))
        .map((l) => ({ id: l.id, documentId, side: l.side, amountCents: l.amountCents })),
    )
  }
  const { openCents, paymentStatus } = openInfo(docBase, partidas, allocatedByLine(allocations))

  const links = ((linksResult.data ?? []) as unknown[]).filter(isRecord)
  const linkById = new Map(links.map((row) => [str(row.id), row]))
  const linkTo = (id: unknown): DocumentLink | null => {
    const row = typeof id === 'string' ? linkById.get(id) : undefined
    return row ? toLink(row) : null
  }
  const replacedByRow = links.find((row) => row.replaces_document_id === documentId)
  const reversedByRow = links.find((row) => row.reverses_document_id === documentId)

  const createdAt = str(doc.created_at)
  const createdMs = Date.parse(createdAt)
  return {
    id: documentId,
    seq: int(doc.seq),
    bundleId: str(doc.bundle_id),
    kind,
    title: titleOf(docBase),
    voucherType: docBase.voucherType,
    afipVoucherCode: intOrNull(doc.afip_voucher_code),
    pointOfSale: docBase.pointOfSale,
    number: docBase.number,
    partyId: docBase.partyId,
    partyName: docBase.partyName,
    partyDocNumber: strOrNull(doc.party_doc_number_snapshot),
    partyIvaCondition: strOrNull(doc.party_iva_condition_snapshot),
    issueDate: docBase.issueDate,
    accountingDate: docBase.accountingDate,
    dueDate: docBase.dueDate,
    shift: strOrNull(doc.shift),
    description: docBase.description,
    notes: strOrNull(doc.notes),
    totalCents: docBase.totalCents,
    countedCents: centsOrNull(doc.counted_cents),
    expectedBookCents: centsOrNull(doc.expected_book_cents),
    settlesCommissions: bool(doc.settles_commissions),
    recurringExpenseId: strOrNull(doc.recurring_expense_id),
    warningsAck: strings(doc.warnings_ack),
    overrideReason: strOrNull(doc.override_reason),
    status: docBase.status,
    voidedAt: instantOrNull(doc.voided_at),
    voidedByName: strOrNull(doc.voided_by_name),
    voidReason: strOrNull(doc.void_reason),
    createdByName: docBase.createdByName,
    createdAt,
    period: period
      ? {
          id: str(period.id),
          month: day(period.month),
          kind: str(period.kind),
          status: periodStatus,
        }
      : null,
    lines: docLines.map((l) => {
      const account = accounts.get(str(l.account_id))
      const party = parties.get(str(l.party_id))
      const treasury = treasuries.get(str(l.treasury_account_id))
      const method = methods.get(str(l.sales_method_id))
      const vatRateBp = intOrNull(l.vat_rate_bp)
      const taxKind = strOrNull(l.tax_kind)
      const role = str(l.role)
      return {
        id: str(l.id),
        lineNo: int(l.line_no),
        role,
        roleLabel: lineRoleLabel(role, { vatRateBp, taxKind }),
        accountId: str(l.account_id),
        accountCode: account ? str(account.code) : '',
        accountName: account ? str(account.name) : '',
        side: sideOf(l.side),
        amountCents: cents(l.amount_cents),
        partyId: strOrNull(l.party_id),
        partyName: party ? str(party.name) : null,
        dueDate: dayOrNull(l.due_date),
        treasuryAccountId: strOrNull(l.treasury_account_id),
        treasuryName: treasury ? str(treasury.name) : null,
        salesMethodId: strOrNull(l.sales_method_id),
        salesMethodName: method ? str(method.name) : null,
        vatRateBp,
        baseCents: centsOrNull(l.base_cents),
        taxKind,
        channel: strOrNull(l.channel),
        certificateNumber: strOrNull(l.certificate_number),
        reference: strOrNull(l.reference),
        memo: strOrNull(l.memo),
      }
    }),
    fiscalVouchers: ((vouchersResult.data ?? []) as unknown[]).filter(isRecord).map((v) => ({
      id: str(v.id),
      book: v.book === 'sales' ? 'sales' : 'purchases',
      periodMonth: day(v.period_month),
      voucherDate: day(v.voucher_date),
      voucherType: str(v.voucher_type),
      afipVoucherCode: intOrNull(v.afip_voucher_code),
      isCreditNote: bool(v.is_credit_note),
      isReversal: bool(v.is_reversal),
      pointOfSale: int(v.point_of_sale),
      numberFrom: int(v.number_from),
      numberTo: intOrNull(v.number_to),
      counterpartyName: str(v.counterparty_name),
      counterpartyDocType: int(v.counterparty_doc_type),
      counterpartyDocNumber: str(v.counterparty_doc_number),
      counterpartyIvaCondition: str(v.counterparty_iva_condition),
      channel: strOrNull(v.channel),
      amounts: fiscalAmounts(v),
      voided: bool(v.voided),
    })),
    entry,
    openCents,
    paymentStatus,
    allocations: allocationList,
    bundleSiblings: links
      .filter((row) => row.bundle_id === doc.bundle_id && row.id !== documentId)
      .map(toLink)
      .sort((a, b) => a.seq - b.seq),
    related: linkTo(doc.related_document_id),
    replaces: linkTo(doc.replaces_document_id),
    replacedBy: replacedByRow ? toLink(replacedByRow) : null,
    reverses: linkTo(doc.reverses_document_id),
    reversedBy: reversedByRow ? toLink(reversedByRow) : null,
    corrects: linkTo(doc.corrects_document_id),
    undoUntil: new Date(
      (Number.isFinite(createdMs) ? createdMs : 0) + UNDO_WINDOW_MS,
    ).toISOString(),
  }
}

/** Un asiento con sus líneas (H.14 `/asientos/[id]`). `null` si no existe en este bar. */
export async function getEntry(tenantId: string, entryId: string): Promise<EntryDetail | null> {
  if (!isUuid(entryId)) return null
  const supabase = await readerClient()
  const [entryResult, linesResult] = await Promise.all([
    supabase
      .from('acc_journal_entries')
      .select(ENTRY_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', entryId)
      .maybeSingle(),
    supabase
      .from('acc_journal_lines')
      .select(JOURNAL_LINE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('entry_id', entryId)
      .order('line_no', { ascending: true }),
  ])
  if (entryResult.error) throw queryError('acc_journal_entries', entryResult.error)
  if (linesResult.error) throw queryError('acc_journal_lines', linesResult.error)
  if (!isRecord(entryResult.data)) return null
  const entryRow = entryResult.data
  const lines = ((linesResult.data ?? []) as unknown[]).filter(isRecord).map(parseJournalLineRaw)

  const [periodResult, allocations, docResult] = await Promise.all([
    supabase
      .from('acc_periods')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('id', str(entryRow.period_id))
      .maybeSingle(),
    loadAllocationsFor(
      tenantId,
      lines.filter((l) => l.partyId !== null).map((l) => l.id),
    ),
    supabase
      .from('acc_documents')
      .select(DOC_LINK_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', str(entryRow.document_id))
      .maybeSingle(),
  ])
  if (periodResult.error) throw queryError('acc_periods', periodResult.error)
  if (docResult.error) throw queryError('acc_documents', docResult.error)
  const periodStatus =
    isRecord(periodResult.data) && periodResult.data.status === 'closed' ? 'closed' : 'open'
  const document = isRecord(docResult.data) ? toLink(docResult.data) : null
  return buildEntryDetail(tenantId, entryRow, lines, allocations, periodStatus, document)
}

// ─── Cierres del día (H.9) ───────────────────────────────────────────────────

export type DailyCloseDayStatus = 'loaded' | 'missing' | 'pending' | 'future' | 'before_start'

export type DailyCloseDay = {
  date: string
  /**
   * `loaded` ✓ con su total · `missing` «Falta» · `pending` es el día de
   * servicio de hoy (todavía no falta) · `future` · `before_start` antes de que
   * arranque Administración.
   */
  status: DailyCloseDayStatus
  /** Los cierres de ese día (uno por turno), en orden de carga. */
  closes: Array<{ id: string; seq: number; shift: string | null; totalCents: number }>
  /** Σ de los cierres del día; `null` si no hay ninguno. */
  totalCents: number | null
}

export type DailyCloseCalendar = {
  /** Primer día del mes. */
  month: string
  days: DailyCloseDay[]
  /** Σ de lo vendido en los cierres del mes (nunca es ganancia). */
  soldCents: number
  loadedDays: number
  missingDays: number
  /**
   * El primer día sin cierre desde el inicio de Administración, mirando hasta
   * 30 días atrás (H.9: «Cargar cierre» va ahí). `null` si no falta ninguno: el
   * cierre a cargar es el del día de servicio.
   */
  firstMissingDate: string | null
  /** Hoy para el bar (antes de las 5:00 es ayer): no cuenta como faltante. */
  serviceDay: string
  booksStartDate: string | null
}

/** Días hacia atrás que mira «Cargar cierre» buscando el primero que falta. */
const MISSING_CLOSE_LOOKBACK_DAYS = 30

/**
 * El estado de un día en el calendario de cierres. Puro (lo prueban los tests):
 * un día con cierre está cargado aunque sea anterior al inicio; el día de
 * servicio de hoy todavía no falta (hasta las 5:00 del día siguiente).
 */
export function dailyCloseStatus(input: {
  date: string
  hasClose: boolean
  booksStartDate: string | null
  serviceDay: string
}): DailyCloseDayStatus {
  if (input.hasClose) return 'loaded'
  if (input.booksStartDate !== null && input.date < input.booksStartDate) return 'before_start'
  if (input.date > input.serviceDay) return 'future'
  if (input.date === input.serviceDay) return 'pending'
  return 'missing'
}

/**
 * La ventana donde «Cargar cierre» busca el primer día que falta: desde el
 * inicio de Administración (o 30 días atrás, lo que sea más nuevo) hasta ayer
 * (el día de servicio de hoy no falta). `null` si no hay días para mirar.
 */
export function missingCloseWindow(
  booksStartDate: string | null,
  serviceDay: string,
): { from: string; to: string } | null {
  if (booksStartDate === null) return null
  const from = maxIsoDay(booksStartDate, addDays(serviceDay, -MISSING_CLOSE_LOOKBACK_DAYS))
  const to = addDays(serviceDay, -1)
  return from <= to ? { from, to } : null
}

/**
 * El calendario de cierres del día de un mes (H.9 «Cierres del día»): cada día
 * con ✓ y su total o «Falta», lo vendido en el mes y el primer día que falta
 * (para el botón «Cargar cierre»). `month` = `yyyy-MM` o un día del mes.
 */
export async function getDailyCloseCalendar(
  tenantId: string,
  month: string,
  opts: { serviceDay?: string | null } = {},
): Promise<DailyCloseCalendar> {
  const from = requireMonth(month)
  const to = endOfMonth(from)
  const serviceDay = optionalDay(opts.serviceDay) ?? serviceDayInCordoba()
  const supabase = await readerClient()

  const settings = await supabase
    .from('acc_settings')
    .select('books_start_date')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (settings.error) throw queryError('acc_settings', settings.error)
  const booksStartDate = isRecord(settings.data) ? dayOrNull(settings.data.books_start_date) : null

  const lookback = missingCloseWindow(booksStartDate, serviceDay)

  const [monthCloses, windowCloses] = await Promise.all([
    supabase
      .from('acc_documents')
      .select('id, seq, accounting_date, shift, total_cents')
      .eq('tenant_id', tenantId)
      .eq('kind', 'sales_close')
      .eq('status', 'posted')
      .gte('accounting_date', from)
      .lte('accounting_date', to)
      .order('accounting_date', { ascending: true })
      .order('seq', { ascending: true })
      .limit(1000),
    lookback
      ? supabase
          .from('acc_documents')
          .select('accounting_date')
          .eq('tenant_id', tenantId)
          .eq('kind', 'sales_close')
          .eq('status', 'posted')
          .gte('accounting_date', lookback.from)
          .lte('accounting_date', lookback.to)
          .limit(1000)
      : null,
  ])
  if (monthCloses.error) throw queryError('acc_documents', monthCloses.error)
  if (windowCloses?.error) throw queryError('acc_documents', windowCloses.error)

  const byDay = new Map<string, DailyCloseDay['closes']>()
  for (const row of (monthCloses.data ?? []) as unknown[]) {
    if (!isRecord(row)) continue
    const date = dayOrNull(row.accounting_date)
    if (!date) continue
    const list = byDay.get(date) ?? []
    list.push({
      id: str(row.id),
      seq: int(row.seq),
      shift: strOrNull(row.shift),
      totalCents: cents(row.total_cents),
    })
    byDay.set(date, list)
  }

  let soldCents = 0
  let loadedDays = 0
  let missingDays = 0
  const days: DailyCloseDay[] = eachIsoDay(from, to).map((date) => {
    const closes = byDay.get(date) ?? []
    const total = closes.reduce((sum, c) => sum + c.totalCents, 0)
    const status = dailyCloseStatus({
      date,
      hasClose: closes.length > 0,
      booksStartDate,
      serviceDay,
    })
    if (status === 'loaded') {
      loadedDays += 1
      soldCents += total
    } else if (status === 'missing') {
      missingDays += 1
    }
    return { date, status, closes, totalCents: closes.length > 0 ? total : null }
  })

  let firstMissingDate: string | null = null
  if (lookback && windowCloses) {
    const loaded = new Set<string>()
    for (const row of (windowCloses.data ?? []) as unknown[]) {
      const date = isRecord(row) ? dayOrNull(row.accounting_date) : null
      if (date) loaded.add(date)
    }
    firstMissingDate = eachIsoDay(lookback.from, lookback.to).find((d) => !loaded.has(d)) ?? null
  }

  return {
    month: from,
    days,
    soldCents,
    loadedDays,
    missingDays,
    firstMissingDate,
    serviceDay,
    booksStartDate,
  }
}

// ─── Gastos fijos ────────────────────────────────────────────────────────────

const RECURRING_COLUMNS =
  'id, name, party_id, account_id, voucher_type, vat_rate_bp, amount_cents, frequency, due_day, next_due_date, remind_days_before, treasury_account_id, active, last_document_id, notes, updated_at'

const FREQUENCY_MONTHS = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 } as const
type Frequency = keyof typeof FREQUENCY_MONTHS

function frequencyOf(value: unknown): Frequency {
  return value === 'bimonthly' || value === 'quarterly' || value === 'yearly' ? value : 'monthly'
}

/** El vencimiento `months` meses antes o después, con el día ajustado al mes corto. */
function shiftDue(iso: string, months: number, dueDay: number): string {
  const ym = addMonthsToYearMonth(monthOf(iso), months)
  const year = Number(ym.slice(0, 4))
  const month = Number(ym.slice(5, 7))
  return toIsoDay(year, month, Math.min(Math.max(1, dueDay), daysInMonth(year, month)))
}

/**
 * «Este mes» de un gasto fijo:
 * - vence este mes o ya venció (`next_due_date` ≤ fin de mes) → `pending`;
 * - si el vencimiento de este mes ya pasó al próximo: `loaded` si hay un
 *   comprobante cargado después del vencimiento anterior a ese, si no `skipped`;
 * - este mes no le toca vencer → `upcoming`.
 */
export function recurringMonthStatus(input: {
  nextDueDate: string
  frequency: Frequency
  dueDay: number
  lastDocumentDate: string | null
  today: string
}): RecurringMonthStatus {
  if (input.nextDueDate <= endOfMonth(input.today)) return 'pending'
  const step = FREQUENCY_MONTHS[input.frequency]
  const previousDue = shiftDue(input.nextDueDate, -step, input.dueDay)
  if (monthOf(previousDue) !== monthOf(input.today)) return 'upcoming'
  const beforePrevious = shiftDue(input.nextDueDate, -2 * step, input.dueDay)
  return input.lastDocumentDate !== null && input.lastDocumentDate > beforePrevious
    ? 'loaded'
    : 'skipped'
}

async function parseRecurring(
  tenantId: string,
  rows: readonly UnknownRecord[],
  today: string,
): Promise<RecurringExpenseRow[]> {
  const [parties, accounts, treasuries, docs] = await Promise.all([
    namesById(
      tenantId,
      'acc_parties',
      rows.map((r) => r.party_id),
    ),
    namesById(
      tenantId,
      'acc_accounts',
      rows.map((r) => r.account_id),
    ),
    namesById(
      tenantId,
      'acc_treasury_accounts',
      rows.map((r) => r.treasury_account_id),
    ),
    namesById(
      tenantId,
      'acc_documents',
      rows.map((r) => r.last_document_id),
      'id, accounting_date, status',
    ),
  ])
  return rows.map((row) => {
    const frequency = frequencyOf(row.frequency)
    const dueDay = int(row.due_day)
    const nextDueDate = day(row.next_due_date, today)
    const lastDoc = docs.get(str(row.last_document_id))
    const lastDocumentDate =
      lastDoc && lastDoc.status !== 'voided' ? dayOrNull(lastDoc.accounting_date) : null
    const party = parties.get(str(row.party_id))
    const account = accounts.get(str(row.account_id))
    const treasury = treasuries.get(str(row.treasury_account_id))
    return {
      id: str(row.id),
      name: str(row.name),
      partyId: strOrNull(row.party_id),
      partyName: party ? str(party.name) : null,
      accountId: str(row.account_id),
      accountName: account ? str(account.name) : null,
      voucherType: strOrNull(row.voucher_type),
      vatRateBp: intOrNull(row.vat_rate_bp),
      amountCents: centsOrNull(row.amount_cents),
      frequency,
      dueDay,
      nextDueDate,
      remindDaysBefore: int(row.remind_days_before),
      treasuryAccountId: strOrNull(row.treasury_account_id),
      treasuryName: treasury ? str(treasury.name) : null,
      active: bool(row.active),
      lastDocumentId: strOrNull(row.last_document_id),
      lastDocumentDate,
      notes: strOrNull(row.notes),
      updatedAt: str(row.updated_at),
      monthStatus: recurringMonthStatus({
        nextDueDate,
        frequency,
        dueDay,
        lastDocumentDate,
        today,
      }),
      daysToDue: daysBetween(today, nextDueDate),
    }
  })
}

/** Gastos fijos (H.7 «Gastos fijos»), el próximo a vencer primero. */
export async function listRecurringExpenses(
  tenantId: string,
  opts: { includeInactive?: boolean; today?: string | null } = {},
): Promise<RecurringExpenseRow[]> {
  const today = optionalDay(opts.today) ?? todayInCordoba()
  const supabase = await readerClient()
  let query = supabase
    .from('acc_recurring_expenses')
    .select(RECURRING_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('next_due_date', { ascending: true })
    .order('name', { ascending: true })
    .limit(500)
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw queryError('acc_recurring_expenses', error)
  return parseRecurring(tenantId, ((data ?? []) as unknown[]).filter(isRecord), today)
}

export async function getRecurringExpense(
  tenantId: string,
  id: string,
): Promise<RecurringExpenseRow | null> {
  if (!isUuid(id)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_recurring_expenses')
    .select(RECURRING_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw queryError('acc_recurring_expenses', error)
  if (!isRecord(data)) return null
  const [row] = await parseRecurring(tenantId, [data], todayInCordoba())
  return row ?? null
}
