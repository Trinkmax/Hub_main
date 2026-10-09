import 'server-only'
import {
  AGING_TRAMOS,
  type AgingSummary,
  type AgingTramo,
  agingSummary,
  agingTramo,
  DEFAULT_SOON_DAYS,
  type TrafficLight,
  type TrafficLightResult,
  trafficLight,
} from '@/lib/accounting/aging'
import {
  type PartyContact,
  parseDeliveryDays,
  parsePartyContacts,
} from '@/lib/accounting/party-profile'
import {
  IVA_CONDITIONS,
  type IvaCondition,
  PARTY_KINDS,
  type PartyKind,
  TAX_ID_TYPES,
  type TaxIdType,
} from '@/lib/accounting/types'
import { daysBetween } from '@/lib/dates/civil'
import { todayInCordoba } from '@/lib/dates/zone'
import {
  bool,
  callRpcRows,
  cents,
  day,
  dayOrNull,
  int,
  intOrNull,
  isRecord,
  isUuid,
  keysetPage,
  keysetParams,
  optionalDay,
  type QueryPage,
  queryError,
  REPORT_PAGE_LIMIT,
  readerClient,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Proveedores, clientes y sus estados de cuenta (§F.7, H.7, H.9).
 *
 * - `payables` (le debés): proveedores, organismos, sueldos, socios, bancos y otros.
 * - `receivables` (te deben): clientes, tarjetas, billeteras y plataformas.
 * Se suman todas sus cuentas de control salvo «IVA a documentar».
 */

export type PartyGroup = 'payables' | 'receivables'

export const PAYABLE_PARTY_KINDS = [
  'supplier',
  'tax_agency',
  'payroll',
  'partner',
  'bank',
  'other',
] as const satisfies readonly PartyKind[]

export const RECEIVABLE_PARTY_KINDS = [
  'customer',
  'card_processor',
  'payment_wallet',
  'delivery_platform',
] as const satisfies readonly PartyKind[]

export function partyGroupOf(kind: PartyKind): PartyGroup {
  return (RECEIVABLE_PARTY_KINDS as readonly string[]).includes(kind) ? 'receivables' : 'payables'
}

export type PartyBalanceRow = {
  partyId: string
  partyName: string
  partyKind: PartyKind
  taxId: string | null
  tradeName: string | null
  active: boolean
  systemKey: string | null
  /** Σ abierto del lado deuda (Haber en pagables, Debe en cobrables). */
  debtCents: number
  /** Σ abierto del lado contrario: NC, anticipos, pagos a cuenta, «le debemos». */
  creditCents: number
  /** Deuda − a favor. */
  netCents: number
  notDueCents: number
  dueSoonCents: number
  overdue1to30Cents: number
  overdue31to60Cents: number
  overdue60PlusCents: number
  noDueCents: number
  /** Σ de los tres tramos vencidos. */
  overdueCents: number
  oldestDueDate: string | null
  nextDueDate: string | null
  /** La última partida del lado deuda: «Última compra» (proveedores) o última venta (clientes). */
  lastIncreaseDate: string | null
  trafficLight: TrafficLight
  /** Punto + texto (nunca solo color): «Vencida hace 3 días», «Al día». */
  trafficText: string
}

export type PartyListFilter = 'all' | 'with_debt' | 'overdue' | 'in_favor' | 'taxes_payroll'

/** Una fila de la lista de «Proveedores» o «Clientes y plataformas». */
export type PartyListRow = PartyBalanceRow

export type PartyListTotals = {
  debtCents: number
  overdueCents: number
  /** Lo que vence en los próximos `due_soon_days` (7) días. */
  dueSoonCents: number
  creditCents: number
  count: number
}

export type PartyList = {
  rows: PartyListRow[]
  /** Totales del grupo entero (sin el filtro ni la búsqueda): la franja de arriba. */
  totals: PartyListTotals
  asOf: string
}

export type PartyDetail = {
  id: string
  kind: PartyKind
  name: string
  tradeName: string | null
  taxIdType: TaxIdType
  taxId: string | null
  ivaCondition: IvaCondition
  email: string | null
  phone: string | null
  address: string | null
  paymentTermDays: number
  defaultAccountId: string | null
  defaultAccountName: string | null
  defaultVoucherType: string | null
  payableAccountId: string
  payableAccountName: string | null
  receivableAccountId: string
  receivableAccountName: string | null
  commissionVatMode: 'per_settlement' | 'monthly_invoice' | 'none'
  commissionBp: number | null
  iibbWithholdingBp: number | null
  vatWithholdingBp: number | null
  incomeTaxWithholdingBp: number | null
  sircupaBp: number | null
  notes: string | null
  active: boolean
  systemKey: string | null
  contacts: PartyContact[]
  /** 1 = lunes … 7 = domingo. */
  deliveryDays: number[]
  /** Con cuántos días de anticipación hay que pedirle; `null` = no se cargó. */
  orderLeadDays: number | null
  /** Para la concurrencia optimista de `saveParty` (`p_expected_updated_at`). */
  updatedAt: string
  /** El grupo que se lee primero en su ficha. */
  group: PartyGroup
}

export type PartyStatementRow = {
  rowKind: 'opening' | 'line'
  entryId: string | null
  documentId: string | null
  documentSeq: number | null
  documentKind: string | null
  entryDate: string | null
  documentLabel: string | null
  dueDate: string | null
  accountId: string | null
  memo: string | null
  /** «Facturas» (proveedor) / «Ventas» (cliente). */
  increaseCents: number
  /** «Pagos» (proveedor) / «Cobros» (cliente). */
  decreaseCents: number
  /** Saldo acumulado leído del lado de la deuda (positivo = le debés / te deben). */
  runningBalanceCents: number
  lineId: string | null
  /** Pendiente de la partida al final del período (`null` en la fila de saldo anterior). */
  openCents: number | null
}

export type PartyStatementPage = QueryPage<PartyStatementRow> & {
  from: string
  to: string
  /** Saldo al empezar el período; `null` en las páginas siguientes a la primera. */
  openingCents: number | null
}

export type OpenItemSide = 'debt' | 'credit'

export type OpenItemRow = {
  lineId: string
  documentId: string
  documentSeq: number | null
  documentKind: string | null
  documentLabel: string
  accountId: string
  accountCode: string | null
  accountName: string | null
  /** El lado de la partida: deuda o a favor (lo pedido con `side`). */
  side: OpenItemSide
  salesMethodId: string | null
  entryDate: string
  dueDate: string | null
  memo: string | null
  amountCents: number
  openCents: number
  /** Días de atraso (positivo = vencida; negativo = faltan días); `null` sin vencimiento. */
  daysOverdue: number | null
  bucket: AgingTramo
}

export type PartyPosition = {
  partyId: string
  group: PartyGroup
  asOf: string
  debtCents: number
  creditCents: number
  netCents: number
  aging: AgingSummary
  traffic: TrafficLightResult
  /** Partidas de deuda abiertas, la más vieja primero. */
  debtItems: OpenItemRow[]
  /** NC, anticipos, pagos a cuenta y «le debemos» sin aplicar. */
  creditItems: OpenItemRow[]
}

export type PartyOption = {
  id: string
  name: string
  tradeName: string | null
  kind: PartyKind
  taxId: string | null
  ivaCondition: IvaCondition
  active: boolean
  systemKey: string | null
  paymentTermDays: number
  defaultAccountId: string | null
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function partyKind(value: unknown): PartyKind {
  return typeof value === 'string' && (PARTY_KINDS as readonly string[]).includes(value)
    ? (value as PartyKind)
    : 'other'
}

function ivaCondition(value: unknown): IvaCondition {
  return typeof value === 'string' && (IVA_CONDITIONS as readonly string[]).includes(value)
    ? (value as IvaCondition)
    : 'sin_datos'
}

function taxIdType(value: unknown): TaxIdType {
  return typeof value === 'string' && (TAX_ID_TYPES as readonly string[]).includes(value)
    ? (value as TaxIdType)
    : 'none'
}

const LIGHTS: readonly TrafficLight[] = ['red', 'yellow', 'green', 'none']

function light(value: unknown): TrafficLight {
  return LIGHTS.includes(value as TrafficLight) ? (value as TrafficLight) : 'none'
}

function parseBalance(row: UnknownRecord): PartyBalanceRow {
  const overdue1to30Cents = cents(row.overdue_1_30_cents)
  const overdue31to60Cents = cents(row.overdue_31_60_cents)
  const overdue60PlusCents = cents(row.overdue_60_plus_cents)
  const debtCents = cents(row.debt_cents)
  const creditCents = cents(row.credit_cents)
  return {
    partyId: str(row.party_id),
    partyName: str(row.party_name),
    partyKind: partyKind(row.party_kind),
    taxId: strOrNull(row.tax_id),
    tradeName: strOrNull(row.trade_name),
    active: row.active === undefined || row.active === null ? true : bool(row.active),
    systemKey: strOrNull(row.system_key),
    debtCents,
    creditCents,
    netCents: row.net_cents === undefined ? debtCents - creditCents : cents(row.net_cents),
    notDueCents: cents(row.not_due_cents),
    dueSoonCents: cents(row.due_soon_cents),
    overdue1to30Cents,
    overdue31to60Cents,
    overdue60PlusCents,
    noDueCents: cents(row.no_due_cents),
    overdueCents:
      row.overdue_cents === undefined || row.overdue_cents === null
        ? overdue1to30Cents + overdue31to60Cents + overdue60PlusCents
        : cents(row.overdue_cents),
    oldestDueDate: dayOrNull(row.oldest_due_date),
    nextDueDate: dayOrNull(row.next_due_date),
    lastIncreaseDate: dayOrNull(row.last_increase_date),
    trafficLight: light(row.traffic_light),
    trafficText: str(row.traffic_text, debtCents > 0 ? 'Al día' : 'Sin deuda'),
  }
}

function parseOpenItem(row: UnknownRecord, asOf: string, side: OpenItemSide): OpenItemRow {
  const dueDate = dayOrNull(row.due_date)
  const rawBucket = str(row.bucket)
  const bucket = (AGING_TRAMOS as readonly string[]).includes(rawBucket)
    ? (rawBucket as AgingTramo)
    : agingTramo(dueDate, asOf)
  return {
    lineId: str(row.line_id),
    documentId: str(row.document_id),
    documentSeq: intOrNull(row.document_seq),
    documentKind: strOrNull(row.document_kind),
    documentLabel: str(row.document_label),
    accountId: str(row.account_id),
    accountCode: strOrNull(row.account_code),
    accountName: strOrNull(row.account_name),
    side,
    salesMethodId: strOrNull(row.sales_method_id),
    entryDate: day(row.entry_date),
    dueDate,
    memo: strOrNull(row.memo),
    amountCents: cents(row.amount_cents),
    openCents: cents(row.open_cents),
    daysOverdue:
      intOrNull(row.days_overdue) ?? (dueDate === null ? null : daysBetween(dueDate, asOf)),
    bucket,
  }
}

/** Sin tildes y en minúsculas, para buscar «Lopez» y encontrar «López». */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Los tipos de partícipe de un grupo (para filtrar combos y búsquedas). */
export function partyKindsOf(group: PartyGroup): readonly PartyKind[] {
  return group === 'payables' ? PAYABLE_PARTY_KINDS : RECEIVABLE_PARTY_KINDS
}

// ─── Funciones ───────────────────────────────────────────────────────────────

/** Saldos con antigüedad y semáforo de un grupo al día (F.7). Sin fecha, hoy. */
export async function listPartyBalances(
  tenantId: string,
  params: { group: PartyGroup; asOf?: string | null },
): Promise<PartyBalanceRow[]> {
  const asOf = optionalDay(params.asOf) ?? todayInCordoba()
  const raw = await callRpcRows('acc_report_party_balances', {
    p_tenant_id: tenantId,
    p_as_of: asOf,
    p_group: params.group,
  })
  return raw.map(parseBalance)
}

function matchesFilter(row: PartyListRow, filter: PartyListFilter): boolean {
  switch (filter) {
    case 'with_debt':
      return row.debtCents > 0
    case 'overdue':
      return row.overdueCents > 0
    case 'in_favor':
      return row.creditCents > 0
    case 'taxes_payroll':
      return (
        row.partyKind === 'tax_agency' ||
        row.partyKind === 'payroll' ||
        row.systemKey === 'sindicato'
      )
    case 'all':
      return true
  }
}

function matchesQuery(row: PartyListRow, q: string): boolean {
  const key = searchKey(q)
  if (!key) return true
  if (searchKey(row.partyName).includes(key)) return true
  if (row.tradeName && searchKey(row.tradeName).includes(key)) return true
  const digits = q.replace(/\D/g, '')
  return digits.length >= 3 && (row.taxId ?? '').includes(digits)
}

/**
 * La lista de «Proveedores» o «Clientes y plataformas» (H.7, H.9): los
 * partícipes del grupo que están activos o tienen algo abierto, con saldo,
 * antigüedad, semáforo y última compra o venta. Lo más urgente primero. Los
 * totales son del grupo entero (la franja de arriba), sin filtro ni búsqueda.
 */
export async function listParties(
  tenantId: string,
  params: {
    group: PartyGroup
    asOf?: string | null
    q?: string | null
    filter?: PartyListFilter
  },
): Promise<PartyList> {
  const asOf = optionalDay(params.asOf) ?? todayInCordoba()
  const all = await listPartyBalances(tenantId, { group: params.group, asOf })

  const totals: PartyListTotals = {
    debtCents: 0,
    overdueCents: 0,
    dueSoonCents: 0,
    creditCents: 0,
    count: all.length,
  }
  for (const row of all) {
    totals.debtCents += row.debtCents
    totals.overdueCents += row.overdueCents
    totals.dueSoonCents += row.dueSoonCents
    totals.creditCents += row.creditCents
  }

  const filter = params.filter ?? 'all'
  const q = params.q?.trim() ?? ''
  const rows = all
    .filter((row) => matchesFilter(row, filter) && matchesQuery(row, q))
    .sort(
      (a, b) =>
        b.overdueCents - a.overdueCents ||
        b.debtCents - a.debtCents ||
        a.partyName.localeCompare(b.partyName, 'es'),
    )
  return { rows, totals, asOf }
}

const PARTY_DETAIL_COLUMNS =
  'id, kind, name, trade_name, tax_id_type, tax_id, iva_condition, email, phone, address, payment_term_days, default_account_id, default_voucher_type, payable_account_id, receivable_account_id, commission_vat_mode, commission_bp, iibb_withholding_bp, vat_withholding_bp, income_tax_withholding_bp, sircupa_bp, notes, active, system_key, contacts, delivery_days, order_lead_days, updated_at'

/** La ficha de un proveedor o cliente (datos, cuentas y tasas). `null` si no existe en este bar. */
export async function getParty(tenantId: string, partyId: string): Promise<PartyDetail | null> {
  if (!isUuid(partyId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_parties')
    .select(PARTY_DETAIL_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', partyId)
    .maybeSingle()
  if (error) throw queryError('acc_parties', error)
  if (!isRecord(data)) return null

  const accountIds = [data.default_account_id, data.payable_account_id, data.receivable_account_id]
    .map((v) => strOrNull(v))
    .filter((v): v is string => v !== null && isUuid(v))
  const names = new Map<string, string>()
  if (accountIds.length > 0) {
    const accounts = await supabase
      .from('acc_accounts')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .in('id', [...new Set(accountIds)])
    if (accounts.error) throw queryError('acc_accounts', accounts.error)
    for (const row of (accounts.data ?? []) as unknown[]) {
      if (isRecord(row)) names.set(str(row.id), str(row.name))
    }
  }

  const kind = partyKind(data.kind)
  const defaultAccountId = strOrNull(data.default_account_id)
  const payableAccountId = str(data.payable_account_id)
  const receivableAccountId = str(data.receivable_account_id)
  const mode = data.commission_vat_mode
  return {
    id: str(data.id),
    kind,
    name: str(data.name),
    tradeName: strOrNull(data.trade_name),
    taxIdType: taxIdType(data.tax_id_type),
    taxId: strOrNull(data.tax_id),
    ivaCondition: ivaCondition(data.iva_condition),
    email: strOrNull(data.email),
    phone: strOrNull(data.phone),
    address: strOrNull(data.address),
    paymentTermDays: int(data.payment_term_days),
    defaultAccountId,
    defaultAccountName: defaultAccountId ? (names.get(defaultAccountId) ?? null) : null,
    defaultVoucherType: strOrNull(data.default_voucher_type),
    payableAccountId,
    payableAccountName: names.get(payableAccountId) ?? null,
    receivableAccountId,
    receivableAccountName: names.get(receivableAccountId) ?? null,
    commissionVatMode: mode === 'per_settlement' || mode === 'monthly_invoice' ? mode : 'none',
    commissionBp: intOrNull(data.commission_bp),
    iibbWithholdingBp: intOrNull(data.iibb_withholding_bp),
    vatWithholdingBp: intOrNull(data.vat_withholding_bp),
    incomeTaxWithholdingBp: intOrNull(data.income_tax_withholding_bp),
    sircupaBp: intOrNull(data.sircupa_bp),
    notes: strOrNull(data.notes),
    active: bool(data.active),
    systemKey: strOrNull(data.system_key),
    contacts: parsePartyContacts(data.contacts),
    deliveryDays: parseDeliveryDays(data.delivery_days),
    orderLeadDays: intOrNull(data.order_lead_days),
    updatedAt: str(data.updated_at),
    group: partyGroupOf(kind),
  }
}

function parseStatementRow(row: UnknownRecord): PartyStatementRow {
  const opening = row.row_kind === 'opening'
  return {
    rowKind: opening ? 'opening' : 'line',
    entryId: strOrNull(row.entry_id),
    documentId: strOrNull(row.document_id),
    documentSeq: intOrNull(row.document_seq),
    documentKind: strOrNull(row.document_kind),
    entryDate: dayOrNull(row.entry_date),
    documentLabel: strOrNull(row.document_label),
    dueDate: dayOrNull(row.due_date),
    accountId: strOrNull(row.account_id),
    memo: strOrNull(row.memo),
    increaseCents: cents(row.increase_cents),
    decreaseCents: cents(row.decrease_cents),
    runningBalanceCents: cents(row.running_balance_cents),
    lineId: strOrNull(row.line_id),
    openCents: opening ? null : intOrNull(row.open_cents),
  }
}

/**
 * Estado de cuenta de un partícipe en el período (F.7), con «Saldo anterior»
 * en la primera página y saldo acumulado calculado en la base. El saldo final
 * es, por construcción, su saldo en las cuentas de control.
 */
export async function getPartyStatement(
  tenantId: string,
  params: {
    partyId: string
    /** `null` = todas sus cuentas de control (salvo «IVA a documentar»). */
    accountId?: string | null
    from: string
    to: string
    after?: string | null
    limit?: number | null
  },
): Promise<PartyStatementPage> {
  const { from, to } = requireRange(params.from, params.to)
  if (!isUuid(params.partyId)) {
    return { rows: [], nextCursor: null, totalRows: 0, from, to, openingCents: 0 }
  }
  const { p_after, p_limit, seen } = keysetParams(
    params.after,
    params.limit,
    200,
    REPORT_PAGE_LIMIT,
  )
  const raw = await callRpcRows('acc_report_party_statement', {
    p_tenant_id: tenantId,
    p_party_id: params.partyId,
    p_account_id: params.accountId && isUuid(params.accountId) ? params.accountId : null,
    p_from: from,
    p_to: to,
    p_after,
    p_limit,
  })
  const page = keysetPage(raw, {
    limit: p_limit,
    seen,
    map: parseStatementRow,
    isCounted: (row) => row.row_kind !== 'opening',
  })
  const opening = page.rows.find((r) => r.rowKind === 'opening')
  return {
    ...page,
    from,
    to,
    openingCents: opening ? opening.runningBalanceCents : p_after ? null : 0,
  }
}

/**
 * Partidas abiertas de un partícipe (F.7): `debt` = facturas o ventas
 * pendientes; `credit` = NC, anticipos y pagos a cuenta. Sin fecha, el estado
 * actual (igual que el trigger de imputaciones: lo que se puede pagar o cobrar
 * ahora); con fecha, «al día X». La base las ordena por vencimiento (sin
 * vencimiento al final): es el orden en que se tildan en «Pagar» y «Cobrar».
 * `accountId` limita a una cuenta de control (también «IVA a documentar»).
 */
export async function listOpenItems(
  tenantId: string,
  params: {
    partyId: string
    side: OpenItemSide
    asOf?: string | null
    accountId?: string | null
  },
): Promise<OpenItemRow[]> {
  if (!isUuid(params.partyId)) return []
  const asOf = optionalDay(params.asOf)
  const raw = await callRpcRows('acc_report_open_items', {
    p_tenant_id: tenantId,
    p_party_id: params.partyId,
    p_as_of: asOf,
    p_side: params.side,
    p_account_id: params.accountId && isUuid(params.accountId) ? params.accountId : null,
  })
  const reference = asOf ?? todayInCordoba()
  return raw
    .map((row) => parseOpenItem(row, reference, params.side))
    .filter((item) => item.openCents > 0)
}

/**
 * Saldo, antigüedad y semáforo de un partícipe (encabezado de su ficha, H.7):
 * se arma con sus partidas abiertas y los mismos cortes que la lista
 * (`lib/accounting/aging`). Sin fecha, el estado de hoy.
 */
export async function getPartyPosition(
  tenantId: string,
  params: { partyId: string; group: PartyGroup; asOf?: string | null; soonDays?: number },
): Promise<PartyPosition> {
  const asOf = optionalDay(params.asOf)
  const reference = asOf ?? todayInCordoba()
  const soonDays = params.soonDays ?? DEFAULT_SOON_DAYS
  const [debtItems, creditItems] = await Promise.all([
    listOpenItems(tenantId, { partyId: params.partyId, side: 'debt', asOf }),
    listOpenItems(tenantId, { partyId: params.partyId, side: 'credit', asOf }),
  ])
  const items = debtItems.map((i) => ({ dueDate: i.dueDate, openCents: i.openCents }))
  const debtCents = debtItems.reduce((sum, i) => sum + i.openCents, 0)
  const creditCents = creditItems.reduce((sum, i) => sum + i.openCents, 0)
  return {
    partyId: params.partyId,
    group: params.group,
    asOf: reference,
    debtCents,
    creditCents,
    netCents: debtCents - creditCents,
    aging: agingSummary(items, reference, soonDays),
    traffic: trafficLight({ items, creditCents, asOf: reference, soonDays, group: params.group }),
    debtItems,
    creditItems,
  }
}

const PARTY_OPTION_COLUMNS =
  'id, kind, name, trade_name, tax_id, iva_condition, active, system_key, payment_term_days, default_account_id'

function parseOption(row: UnknownRecord): PartyOption {
  return {
    id: str(row.id),
    name: str(row.name),
    tradeName: strOrNull(row.trade_name),
    kind: partyKind(row.kind),
    taxId: strOrNull(row.tax_id),
    ivaCondition: ivaCondition(row.iva_condition),
    active: bool(row.active),
    systemKey: strOrNull(row.system_key),
    paymentTermDays: int(row.payment_term_days),
    defaultAccountId: strOrNull(row.default_account_id),
  }
}

function optionRank(option: PartyOption, key: string, digits: string): number {
  const name = searchKey(option.name)
  const trade = option.tradeName ? searchKey(option.tradeName) : ''
  if (name.startsWith(key) || trade.startsWith(key)) return 0
  if (name.includes(key) || trade.includes(key)) return 1
  if (digits.length >= 3 && (option.taxId ?? '').includes(digits)) return 2
  return -1
}

/**
 * Buscador de proveedores y clientes (EntityPicker): por nombre, nombre de
 * fantasía (sin tildes) o CUIT. Sin texto, los primeros por nombre.
 */
export async function searchParties(
  tenantId: string,
  params: {
    q?: string | null
    kinds?: readonly PartyKind[]
    limit?: number
    includeInactive?: boolean
  } = {},
): Promise<PartyOption[]> {
  const limit = Math.min(50, Math.max(1, Math.trunc(params.limit ?? 20)))
  const supabase = await readerClient()
  let query = supabase
    .from('acc_parties')
    .select(PARTY_OPTION_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  const kinds = (params.kinds ?? []).filter((k) => (PARTY_KINDS as readonly string[]).includes(k))
  if (kinds.length > 0) query = query.in('kind', kinds)
  if (!params.includeInactive) query = query.eq('active', true)
  const q = params.q?.trim() ?? ''
  const { data, error } = await query.limit(q ? 1000 : limit)
  if (error) throw queryError('acc_parties', error)
  const options = ((data ?? []) as unknown[]).filter(isRecord).map(parseOption)
  if (!q) return options.slice(0, limit)

  const key = searchKey(q)
  const digits = q.replace(/\D/g, '')
  return options
    .map((option) => ({ option, rank: optionRank(option, key, digits) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.option.name.localeCompare(b.option.name, 'es'))
    .slice(0, limit)
    .map((x) => x.option)
}
