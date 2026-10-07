import 'server-only'

/**
 * Contexto del motor de imputación (G.1): cuentas, cajas con saldo,
 * partícipes, medios de cobro, puntos de venta y las partidas que el
 * formulario referencia, con su abierto ACTUAL. Siempre DESDE LA BASE (nunca
 * lo que manda el cliente): la acción recalcula la propuesta con esto y la
 * compara con el hash que vio la persona (E.7).
 *
 * Una llamada a `acc_posting_context` (INVOKER, bajo la RLS de quien llama;
 * empieza con `acc_assert_reader`), cacheada por request, más las lecturas de
 * partidas abiertas (tablas `acc_*` con `tenant_id` explícito + la RLS).
 *
 * Las funciones de parseo son puras (las prueba `accounting-context.test.ts`).
 */

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { AccFailureState } from './action-state'
import { ACC_ERRORS, ACC_GENERIC_ERROR, accErrorMessage, mapAccError } from './errors'
import { isSystemAccountKey, SYSTEM_ACCOUNT_KEYS, type SystemAccountKey } from './system-keys'
import {
  ACCOUNT_TYPES,
  type AccountRef,
  type Cents,
  CHANNELS,
  COMMISSION_VAT_MODES,
  type IsoDate,
  IVA_CONDITIONS,
  type OpenItemRef,
  PARTY_KINDS,
  type PartyRef,
  type PostingContext,
  type PostingSettings,
  SALES_METHOD_KINDS,
  SAS_IVA_CONDITIONS,
  type SalesMethodRef,
  type SalesPointRef,
  type SasIvaCondition,
  SIDES,
  type Side,
  TAX_ID_TYPES,
  TREASURY_KINDS,
  type TreasuryRef,
  type VoucherType,
} from './types'
import { isVoucherType, voucherDisplay } from './voucher-types'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export const IIBB_REGIMES = ['local', 'convenio_multilateral', 'exento', 'no_inscripto'] as const
export type IibbRegime = (typeof IIBB_REGIMES)[number]
export const IVA_SETTLEMENT_MODES = ['on_close', 'manual'] as const
export type IvaSettlementMode = (typeof IVA_SETTLEMENT_MODES)[number]
export const UNINVOICED_SALES_MODES = ['separate_accounts', 'single_account'] as const
export type UninvoicedSalesMode = (typeof UNINVOICED_SALES_MODES)[number]
export const CLOSED_PERIOD_VOID_IVA_MODES = ['adjustment_only', 'negative_row'] as const
export type ClosedPeriodVoidIvaMode = (typeof CLOSED_PERIOD_VOID_IVA_MODES)[number]
export const OPENING_STATUSES = ['pending', 'posted', 'skipped'] as const
export type OpeningStatus = (typeof OPENING_STATUSES)[number]

/** `acc_settings` en camelCase (la plata, en centavos; las fechas, `yyyy-MM-dd`). */
export type AccSettingsRow = {
  tenantId: string
  legalName: string
  cuit: string | null
  ivaCondition: SasIvaCondition
  iibbRegime: IibbRegime
  iibbNumber: string | null
  iibbJurisdictionCode: number
  activityStartDate: IsoDate | null
  fiscalAddress: string | null
  booksStartDate: IsoDate
  fiscalYearEndMonth: number
  ivaSettlementMode: IvaSettlementMode
  ivaDueDay: number
  iibbDueDay: number
  /** Ajuste silencioso del IVA por alícuota (0 a 100 centavos). */
  vatToleranceCents: number
  bankTaxCreditComputableBp: number
  bankTaxDebitComputableBp: number
  uninvoicedSalesMode: UninvoicedSalesMode
  closedPeriodVoidIvaMode: ClosedPeriodVoidIvaMode
  dueSoonDays: number
  openingStatus: OpeningStatus
  setupCompletedAt: string | null
  /** Token de concurrencia de `saveSettings` (`expectedUpdatedAt`). */
  updatedAt: string
}

export type CatalogAccount = AccountRef & {
  parentId: string | null
  level: number
  manualSelectable: boolean
  sort: number
}

export type CatalogParty = PartyRef & {
  systemKey: string | null
  defaultAccountId: string | null
  defaultVoucherType: VoucherType | null
  updatedAt: string | null
}

export type CatalogTreasury = TreasuryRef & {
  accountCode: string
  bankName: string | null
  cbuCvu: string | null
  alias: string | null
  accountNumber: string | null
  lastCheckedOn: IsoDate | null
  sort: number
  systemKey: string | null
  updatedAt: string | null
}

export type CatalogSalesMethod = SalesMethodRef & {
  active: boolean
  systemKey: string | null
  updatedAt: string | null
}

export type CatalogSalesPoint = SalesPointRef & {
  id: string
  active: boolean
  updatedAt: string | null
}

/** Lo que devuelve `acc_posting_context`, normalizado (para el motor y los selectores). */
export type PostingCatalog = {
  tenantId: string
  /** Hoy en el bar (`acc_today`). */
  today: IsoDate
  settings: AccSettingsRow
  /** Todo el plan, en orden de código (incluye grupos e inactivas). */
  accounts: CatalogAccount[]
  /** Todos los partícipes, en orden de nombre (incluye inactivos). */
  parties: CatalogParty[]
  /** Todas las cajas, en el orden de la base, con su saldo de libro. */
  treasuries: CatalogTreasury[]
  /** Todos los medios de cobro, en el orden del cierre del día. */
  methods: CatalogSalesMethod[]
  salesPoints: CatalogSalesPoint[]
}

/** Qué partidas abiertas trae el contexto además del catálogo. */
export type PostingContextRefs = {
  /** Partidas puntuales (pago, cobro, imputación): `acc_journal_lines.id`. */
  lineIds?: ReadonlyArray<string>
  /**
   * Todas las partidas abiertas de un partícipe (opcionalmente de una sola
   * cuenta de control). Ej.: la factura mensual de comisiones libera el «IVA a
   * documentar» FIFO.
   */
  openItemsOf?: ReadonlyArray<{ partyId: string; accountId?: string | null }>
}

/** No se pudo armar el contexto: trae el estado listo para la acción o el formulario. */
export class AccountingContextError extends Error {
  readonly state: AccFailureState
  constructor(state: AccFailureState) {
    super(state.message)
    this.name = 'AccountingContextError'
    this.state = state
  }
}

// ─── Lectura segura del jsonb ────────────────────────────────────────────────

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Entero (bigint puede llegar como texto). */
function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim())) {
    const n = Number(v.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function oneOf<T extends string>(list: ReadonlyArray<T>, v: unknown): T | null {
  return typeof v === 'string' && (list as ReadonlyArray<string>).includes(v) ? (v as T) : null
}

/** `'2026-10-01'` (o un timestamp: se queda con el día). */
function isoDay(v: unknown): IsoDate | null {
  const t = text(v)
  if (!t) return null
  const day = t.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function rows(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter(isRec) : []
}

// ─── Parseo (puro) ───────────────────────────────────────────────────────────

/** Una fila de `acc_settings` (`to_jsonb`) → `AccSettingsRow`, o `null` si no es una. */
export function parseSettingsRow(raw: unknown): AccSettingsRow | null {
  if (!isRec(raw)) return null
  const tenantId = text(raw.tenant_id)
  const legalName = text(raw.legal_name)
  const booksStartDate = isoDay(raw.books_start_date)
  const updatedAt = text(raw.updated_at)
  if (!tenantId || !legalName || !booksStartDate || !updatedAt) return null
  return {
    tenantId,
    legalName,
    cuit: text(raw.cuit),
    ivaCondition: oneOf(SAS_IVA_CONDITIONS, raw.iva_condition) ?? 'responsable_inscripto',
    iibbRegime: oneOf(IIBB_REGIMES, raw.iibb_regime) ?? 'local',
    iibbNumber: text(raw.iibb_number),
    iibbJurisdictionCode: int(raw.iibb_jurisdiction_code) ?? 904,
    activityStartDate: isoDay(raw.activity_start_date),
    fiscalAddress: text(raw.fiscal_address),
    booksStartDate,
    fiscalYearEndMonth: int(raw.fiscal_year_end_month) ?? 12,
    ivaSettlementMode: oneOf(IVA_SETTLEMENT_MODES, raw.iva_settlement_mode) ?? 'on_close',
    ivaDueDay: int(raw.iva_due_day) ?? 20,
    iibbDueDay: int(raw.iibb_due_day) ?? 15,
    vatToleranceCents: int(raw.vat_tolerance_cents) ?? 1,
    bankTaxCreditComputableBp: int(raw.bank_tax_credit_computable_bp) ?? 3300,
    bankTaxDebitComputableBp: int(raw.bank_tax_debit_computable_bp) ?? 3300,
    uninvoicedSalesMode:
      oneOf(UNINVOICED_SALES_MODES, raw.uninvoiced_sales_mode) ?? 'separate_accounts',
    closedPeriodVoidIvaMode:
      oneOf(CLOSED_PERIOD_VOID_IVA_MODES, raw.closed_period_void_iva_mode) ?? 'adjustment_only',
    dueSoonDays: int(raw.due_soon_days) ?? 7,
    openingStatus: oneOf(OPENING_STATUSES, raw.opening_status) ?? 'pending',
    setupCompletedAt: text(raw.setup_completed_at),
    updatedAt,
  }
}

function parseAccount(r: Rec): CatalogAccount | null {
  const id = text(r.id)
  const code = text(r.code)
  const name = text(r.name)
  const type = oneOf(ACCOUNT_TYPES, r.type)
  const normalSide = oneOf(SIDES, r.normal_side)
  if (!id || !code || !name || !type || !normalSide) return null
  return {
    id,
    code,
    name,
    type,
    normalSide,
    postable: bool(r.postable),
    active: bool(r.active, true),
    requiresParty: bool(r.requires_party),
    isTreasury: bool(r.is_treasury),
    purchaseSelectable: bool(r.purchase_selectable),
    systemKey: isSystemAccountKey(r.system_key) ? r.system_key : null,
    description: text(r.description),
    parentId: text(r.parent_id),
    // La base manda `level`; si faltara, los segmentos significativos del código
    // (`1.1.01.00.000` → 3, como `chartLevel`), no todos los segmentos.
    level: int(r.level) ?? code.replace(/(\.0+)+$/, '').split('.').length,
    manualSelectable: bool(r.manual_selectable, true),
    sort: int(r.sort) ?? 0,
  }
}

function parseParty(r: Rec): CatalogParty | null {
  const id = text(r.id)
  const kind = oneOf(PARTY_KINDS, r.kind)
  const name = text(r.name)
  const payableAccountId = text(r.payable_account_id)
  const receivableAccountId = text(r.receivable_account_id)
  if (!id || !kind || !name || !payableAccountId || !receivableAccountId) return null
  const voucher = r.default_voucher_type
  return {
    id,
    kind,
    name,
    tradeName: text(r.trade_name),
    taxIdType: oneOf(TAX_ID_TYPES, r.tax_id_type) ?? 'none',
    taxId: text(r.tax_id),
    ivaCondition: oneOf(IVA_CONDITIONS, r.iva_condition) ?? 'sin_datos',
    paymentTermDays: int(r.payment_term_days) ?? 0,
    payableAccountId,
    receivableAccountId,
    commissionVatMode: oneOf(COMMISSION_VAT_MODES, r.commission_vat_mode) ?? 'none',
    rates: {
      commissionBp: int(r.commission_bp),
      iibbWithholdingBp: int(r.iibb_withholding_bp),
      vatWithholdingBp: int(r.vat_withholding_bp),
      incomeTaxWithholdingBp: int(r.income_tax_withholding_bp),
      sircupaBp: int(r.sircupa_bp),
    },
    active: bool(r.active, true),
    systemKey: text(r.system_key),
    defaultAccountId: text(r.default_account_id),
    defaultVoucherType: isVoucherType(voucher) ? voucher : null,
    updatedAt: text(r.updated_at),
  }
}

function parseTreasury(r: Rec): CatalogTreasury | null {
  const id = text(r.id)
  const accountId = text(r.account_id)
  const name = text(r.name)
  const kind = oneOf(TREASURY_KINDS, r.kind)
  if (!id || !accountId || !name || !kind) return null
  return {
    id,
    accountId,
    name,
    kind,
    allowNegative: bool(r.allow_negative),
    bankPartyId: text(r.bank_party_id),
    balanceCents: int(r.balance_cents) ?? 0,
    active: bool(r.active, true),
    accountCode: text(r.account_code) ?? '',
    bankName: text(r.bank_name),
    cbuCvu: text(r.cbu_cvu),
    alias: text(r.alias),
    accountNumber: text(r.account_number),
    lastCheckedOn: isoDay(r.last_checked_on),
    sort: int(r.sort) ?? 0,
    systemKey: text(r.system_key),
    updatedAt: text(r.updated_at),
  }
}

function parseMethod(r: Rec): CatalogSalesMethod | null {
  const id = text(r.id)
  const name = text(r.name)
  const kind = oneOf(SALES_METHOD_KINDS, r.kind)
  const channel = oneOf(CHANNELS, r.channel)
  if (!id || !name || !kind || !channel) return null
  return {
    id,
    name,
    kind,
    channel,
    treasuryAccountId: text(r.treasury_account_id),
    partyId: text(r.party_id),
    settlementDays: int(r.settlement_days) ?? 0,
    sort: int(r.sort) ?? 0,
    active: bool(r.active, true),
    systemKey: text(r.system_key),
    updatedAt: text(r.updated_at),
  }
}

function parseSalesPoint(r: Rec): CatalogSalesPoint | null {
  const id = text(r.id)
  const number = int(r.number)
  if (!id || number === null) return null
  return {
    id,
    number,
    label: text(r.label) ?? `Punto de venta ${number}`,
    defaultChannel: oneOf(CHANNELS, r.default_channel) ?? 'salon',
    active: bool(r.active, true),
    updatedAt: text(r.updated_at),
  }
}

function parseList<T>(raw: unknown, parse: (r: Rec) => T | null, what: string): T[] {
  const out: T[] = []
  let dropped = 0
  for (const r of rows(raw)) {
    const parsed = parse(r)
    if (parsed) out.push(parsed)
    else dropped += 1
  }
  if (dropped > 0)
    console.error('[accounting.context] filas que no se pudieron leer', what, dropped)
  return out
}

/**
 * La respuesta de `acc_posting_context` → `PostingCatalog`. `null` si todavía
 * no hay `acc_settings` (Administración sin configurar) o la forma no es la
 * esperada.
 */
export function parsePostingCatalog(raw: unknown): PostingCatalog | null {
  if (!isRec(raw)) return null
  const tenantId = text(raw.tenant_id)
  const today = isoDay(raw.today)
  const settings = parseSettingsRow(raw.settings)
  if (!tenantId || !today || !settings) return null
  return {
    tenantId,
    today,
    settings,
    accounts: parseList(raw.accounts, parseAccount, 'accounts'),
    parties: parseList(raw.parties, parseParty, 'parties'),
    treasuries: parseList(raw.treasuries, parseTreasury, 'treasuries'),
    methods: parseList(raw.methods, parseMethod, 'methods'),
    salesPoints: parseList(raw.sales_points, parseSalesPoint, 'sales_points'),
  }
}

/** Los parámetros de `acc_settings` que usa el motor. */
export function postingSettingsOf(s: AccSettingsRow): PostingSettings {
  return {
    ivaCondition: s.ivaCondition,
    booksStartDate: s.booksStartDate,
    vatToleranceCents: s.vatToleranceCents,
    bankTaxCreditComputableBp: s.bankTaxCreditComputableBp,
    bankTaxDebitComputableBp: s.bankTaxDebitComputableBp,
    uninvoicedSalesMode: s.uninvoicedSalesMode,
    ivaDueDay: s.ivaDueDay,
    iibbDueDay: s.iibbDueDay,
  }
}

/** Claves de sistema que faltan en el plan del bar (debería ser siempre `[]`). */
export function missingSystemKeys(accounts: ReadonlyArray<AccountRef>): SystemAccountKey[] {
  const present = new Set(accounts.map((a) => a.systemKey).filter((k) => k !== null))
  return SYSTEM_ACCOUNT_KEYS.filter((k) => !present.has(k))
}

function stripAccount(a: CatalogAccount): AccountRef {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    normalSide: a.normalSide,
    postable: a.postable,
    active: a.active,
    requiresParty: a.requiresParty,
    isTreasury: a.isTreasury,
    purchaseSelectable: a.purchaseSelectable,
    systemKey: a.systemKey,
    description: a.description,
  }
}

function contextBug(detail: Record<string, unknown>): AccountingContextError {
  return new AccountingContextError({
    ok: false,
    code: 'error',
    message: accErrorMessage('invalid_bundle'),
    detail: { key: 'context_incomplete', bug: true, ...detail },
  })
}

/**
 * Catálogo + partidas → `PostingContext` (E.2). Puro. Tira
 * `AccountingContextError` si al plan le falta una cuenta de sistema (el motor
 * no podría armar ningún asiento: es un error de la puesta en marcha).
 */
export function buildPostingContext(
  catalog: PostingCatalog,
  openItems: ReadonlyArray<OpenItemRef> = [],
): PostingContext {
  const accounts = new Map<string, AccountRef>()
  const sys: Partial<Record<SystemAccountKey, AccountRef>> = {}
  for (const a of catalog.accounts) {
    const ref = stripAccount(a)
    accounts.set(a.id, ref)
    if (a.systemKey && !sys[a.systemKey]) sys[a.systemKey] = ref
  }
  const missing = SYSTEM_ACCOUNT_KEYS.filter((k) => !sys[k])
  if (missing.length > 0) throw contextBug({ missing: missing.join(',') })

  const parties = new Map<string, PartyRef>()
  for (const p of catalog.parties) {
    parties.set(p.id, {
      id: p.id,
      kind: p.kind,
      name: p.name,
      tradeName: p.tradeName,
      taxIdType: p.taxIdType,
      taxId: p.taxId,
      ivaCondition: p.ivaCondition,
      paymentTermDays: p.paymentTermDays,
      payableAccountId: p.payableAccountId,
      receivableAccountId: p.receivableAccountId,
      commissionVatMode: p.commissionVatMode,
      rates: p.rates,
      active: p.active,
    })
  }
  const treasuries = new Map<string, TreasuryRef>()
  for (const t of catalog.treasuries) {
    treasuries.set(t.id, {
      id: t.id,
      accountId: t.accountId,
      name: t.name,
      kind: t.kind,
      allowNegative: t.allowNegative,
      bankPartyId: t.bankPartyId,
      balanceCents: t.balanceCents,
      active: t.active,
    })
  }
  const methods = new Map<string, SalesMethodRef>()
  for (const m of catalog.methods) {
    methods.set(m.id, {
      id: m.id,
      name: m.name,
      kind: m.kind,
      channel: m.channel,
      treasuryAccountId: m.treasuryAccountId,
      partyId: m.partyId,
      settlementDays: m.settlementDays,
      sort: m.sort,
    })
  }
  const salesPoints = new Map<number, SalesPointRef>()
  for (const s of catalog.salesPoints) {
    salesPoints.set(s.number, {
      number: s.number,
      label: s.label,
      defaultChannel: s.defaultChannel,
    })
  }
  const items = new Map<string, OpenItemRef>()
  for (const item of openItems) items.set(item.lineId, item)

  return {
    tenantId: catalog.tenantId,
    today: catalog.today,
    settings: postingSettingsOf(catalog.settings),
    accounts,
    sys: sys as Record<SystemAccountKey, AccountRef>,
    parties,
    treasuries,
    methods,
    salesPoints,
    openItems: items,
  }
}

// ─── Partidas abiertas (puro) ────────────────────────────────────────────────

export type RawJournalLine = {
  id: string
  document_id: string
  document_line_id: string
  party_id: string | null
  account_id: string
  side: string
  amount_cents: number | string
  due_date: string | null
  entry_date: string
}

export type RawDocument = {
  id: string
  status: string
  kind: string
  voucher_type: string | null
  point_of_sale: number | null
  number: number | string | null
  description: string | null
  seq: number | string | null
}

export type RawAllocation = {
  debit_line_id: string
  credit_line_id: string
  amount_cents: number | string
}

/** «Factura A 0003-00001234»; sin comprobante fiscal, la descripción; si no, «#124». */
export function documentLabel(doc: RawDocument): string {
  const number = int(doc.number)
  const pos = int(doc.point_of_sale)
  if (isVoucherType(doc.voucher_type) && doc.voucher_type !== 'sin_comprobante') {
    return voucherDisplay(doc.voucher_type, pos, number)
  }
  const description = text(doc.description)
  if (description) return description
  const seq = int(doc.seq)
  return seq === null ? 'Comprobante' : `#${seq}`
}

/**
 * Lo que queda abierto de cada línea: importe − imputaciones vigentes de SU
 * lado (una partida Debe la cancelan imputaciones donde es `debit_line_id`; una
 * Haber, donde es `credit_line_id`). Las imputaciones tienen que venir ya
 * filtradas por `voided_on is null`.
 */
export function openAmounts(
  lines: ReadonlyArray<Pick<RawJournalLine, 'id' | 'side' | 'amount_cents'>>,
  allocations: ReadonlyArray<RawAllocation>,
): Map<string, Cents> {
  const usedDebit = new Map<string, number>()
  const usedCredit = new Map<string, number>()
  for (const a of allocations) {
    const amount = int(a.amount_cents) ?? 0
    usedDebit.set(a.debit_line_id, (usedDebit.get(a.debit_line_id) ?? 0) + amount)
    usedCredit.set(a.credit_line_id, (usedCredit.get(a.credit_line_id) ?? 0) + amount)
  }
  const out = new Map<string, Cents>()
  for (const l of lines) {
    const amount = int(l.amount_cents) ?? 0
    const used = l.side === 'debit' ? (usedDebit.get(l.id) ?? 0) : (usedCredit.get(l.id) ?? 0)
    out.set(l.id, amount - used)
  }
  return out
}

/**
 * Líneas + comprobantes + imputaciones → `OpenItemRef`. Quedan afuera las
 * líneas sin partícipe (no son partidas) y las de comprobantes anulados.
 * Con `onlyOpen`, también las ya canceladas.
 */
export function toOpenItems(input: {
  lines: ReadonlyArray<RawJournalLine>
  documents: ReadonlyArray<RawDocument>
  allocations: ReadonlyArray<RawAllocation>
  methodByDocLine: ReadonlyMap<string, string | null>
  onlyOpen: boolean
}): OpenItemRef[] {
  const docs = new Map(input.documents.map((d) => [d.id, d]))
  const open = openAmounts(input.lines, input.allocations)
  const out: OpenItemRef[] = []
  for (const l of input.lines) {
    const doc = docs.get(l.document_id)
    const side = oneOf<Side>(SIDES, l.side)
    const amount = int(l.amount_cents)
    const entryDate = isoDay(l.entry_date)
    if (!doc || doc.status !== 'posted' || !l.party_id || !side || amount === null || !entryDate) {
      continue
    }
    const openCents = open.get(l.id) ?? amount
    if (input.onlyOpen && openCents <= 0) continue
    out.push({
      lineId: l.id,
      documentId: l.document_id,
      partyId: l.party_id,
      accountId: l.account_id,
      side,
      amountCents: amount,
      openCents,
      entryDate,
      dueDate: isoDay(l.due_date),
      label: documentLabel(doc),
      salesMethodId: input.methodByDocLine.get(l.document_line_id) ?? null,
    })
  }
  return out
}

// ─── Lecturas ────────────────────────────────────────────────────────────────

type Supabase = Awaited<ReturnType<typeof createClient>>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids por pedido: 100 UUID ≈ 3,7 KB de URL (PostgREST va por GET). */
const IN_CHUNK = 100
/** Filas por página de PostgREST (su máximo por defecto). */
const PAGE = 1000
/** Tope de partidas de un partícipe que se miran (FIFO desde la más vieja). */
const MAX_PARTY_LINES = 5000

const LINE_COLUMNS =
  'id, document_id, document_line_id, party_id, account_id, side, amount_cents, due_date, entry_date'

function chunks<T>(list: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function uniqueUuids(ids: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const id of ids) if (typeof id === 'string' && UUID_RE.test(id)) out.add(id.toLowerCase())
  return [...out]
}

function readFailure(error: { message?: string; code?: string } | null): AccountingContextError {
  console.error('[accounting.context] lectura', error?.code, error?.message)
  return new AccountingContextError(mapAccError(error ?? { message: ACC_GENERIC_ERROR }))
}

async function selectByIds<T>(
  supabase: Supabase,
  table: string,
  columns: string,
  tenantId: string,
  column: string,
  ids: ReadonlyArray<string>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const results = await Promise.all(
    chunks(ids, IN_CHUNK).map((chunk) =>
      supabase.from(table).select(columns).eq('tenant_id', tenantId).in(column, chunk),
    ),
  )
  const out: T[] = []
  for (const r of results) {
    if (r.error) throw readFailure(r.error)
    out.push(...((r.data ?? []) as unknown as T[]))
  }
  return out
}

/** Imputaciones vigentes que tocan estas líneas (de cualquiera de los dos lados). */
async function allocationsForLines(
  supabase: Supabase,
  tenantId: string,
  lineIds: ReadonlyArray<string>,
): Promise<RawAllocation[]> {
  if (lineIds.length === 0) return []
  const results = await Promise.all(
    chunks(lineIds, IN_CHUNK / 2).map((chunk) =>
      supabase
        .from('acc_allocations')
        .select('id, debit_line_id, credit_line_id, amount_cents')
        .eq('tenant_id', tenantId)
        .is('voided_on', null)
        .or(`debit_line_id.in.(${chunk.join(',')}),credit_line_id.in.(${chunk.join(',')})`),
    ),
  )
  // Una imputación entre dos líneas pedidas aparece en dos chunks: se cuenta una vez.
  const byId = new Map<string, RawAllocation>()
  for (const r of results) {
    if (r.error) throw readFailure(r.error)
    for (const row of (r.data ?? []) as unknown as Array<RawAllocation & { id: string }>) {
      byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

async function pagedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  max: number,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, Math.min(from + PAGE, max) - 1)
    if (error) throw readFailure(error as { message?: string; code?: string })
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

async function linesOfParty(
  supabase: Supabase,
  tenantId: string,
  partyId: string,
  accountId: string | null,
): Promise<{ lines: RawJournalLine[]; allocations: RawAllocation[] }> {
  const [lines, allocations] = await Promise.all([
    pagedSelect<RawJournalLine>((from, to) => {
      let q = supabase
        .from('acc_journal_lines')
        .select(LINE_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('party_id', partyId)
      if (accountId) q = q.eq('account_id', accountId)
      return q.order('entry_date', { ascending: true }).order('id').range(from, to)
    }, MAX_PARTY_LINES),
    pagedSelect<RawAllocation>((from, to) => {
      let q = supabase
        .from('acc_allocations')
        .select('debit_line_id, credit_line_id, amount_cents')
        .eq('tenant_id', tenantId)
        .eq('party_id', partyId)
        .is('voided_on', null)
      if (accountId) q = q.eq('account_id', accountId)
      return q.order('id').range(from, to)
    }, MAX_PARTY_LINES * 4),
  ])
  return { lines, allocations }
}

/** Comprobantes y medio de cobro de las líneas que quedaron (solo las que hacen falta). */
async function decorate(
  supabase: Supabase,
  tenantId: string,
  lines: ReadonlyArray<RawJournalLine>,
): Promise<{ documents: RawDocument[]; methodByDocLine: Map<string, string | null> }> {
  const [documents, docLines] = await Promise.all([
    selectByIds<RawDocument>(
      supabase,
      'acc_documents',
      'id, status, kind, voucher_type, point_of_sale, number, description, seq',
      tenantId,
      'id',
      uniqueUuids(lines.map((l) => l.document_id)),
    ),
    selectByIds<{ id: string; sales_method_id: string | null }>(
      supabase,
      'acc_document_lines',
      'id, sales_method_id',
      tenantId,
      'id',
      uniqueUuids(lines.map((l) => l.document_line_id)),
    ),
  ])
  return {
    documents,
    methodByDocLine: new Map(docLines.map((d) => [d.id, d.sales_method_id])),
  }
}

/**
 * Las partidas que pide el formulario, con su abierto de HOY. Las puntuales
 * (`lineIds`) vuelven aunque estén canceladas (el motor contesta
 * `allocation_exceeds_open` con el abierto real); las de un partícipe, solo
 * las abiertas.
 */
export async function loadOpenItems(
  tenantId: string,
  refs: PostingContextRefs = {},
): Promise<OpenItemRef[]> {
  const lineIds = uniqueUuids(refs.lineIds ?? [])
  const parties = (refs.openItemsOf ?? []).filter((p) => UUID_RE.test(p.partyId))
  if (lineIds.length === 0 && parties.length === 0) return []
  const supabase = await createClient()
  const out = new Map<string, OpenItemRef>()

  if (lineIds.length > 0) {
    const lines = await selectByIds<RawJournalLine>(
      supabase,
      'acc_journal_lines',
      LINE_COLUMNS,
      tenantId,
      'id',
      lineIds,
    )
    const [allocations, extra] = await Promise.all([
      allocationsForLines(supabase, tenantId, lineIds),
      decorate(supabase, tenantId, lines),
    ])
    for (const item of toOpenItems({ lines, allocations, ...extra, onlyOpen: false })) {
      out.set(item.lineId, item)
    }
  }

  for (const p of parties) {
    const accountId = p.accountId && UUID_RE.test(p.accountId) ? p.accountId : null
    const { lines, allocations } = await linesOfParty(supabase, tenantId, p.partyId, accountId)
    const open = openAmounts(lines, allocations)
    const candidates = lines.filter((l) => (open.get(l.id) ?? 0) > 0)
    const extra = await decorate(supabase, tenantId, candidates)
    for (const item of toOpenItems({
      lines: candidates,
      allocations,
      ...extra,
      onlyOpen: true,
    })) {
      if (!out.has(item.lineId)) out.set(item.lineId, item)
    }
  }
  return [...out.values()]
}

/**
 * `acc_posting_context` del bar, normalizado y cacheado por request. Tira
 * `AccountingContextError` (con el estado para la UI) si la base no deja leer,
 * si la función no está desplegada o si Administración no está configurada.
 */
export const loadPostingCatalog = cache(async (tenantId: string): Promise<PostingCatalog> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('acc_posting_context', { p_tenant_id: tenantId })
  if (error) {
    console.error('[accounting.context] acc_posting_context', error.code, error.message)
    throw new AccountingContextError(mapAccError(error))
  }
  const catalog = parsePostingCatalog(data)
  if (!catalog) {
    throw new AccountingContextError({
      ok: false,
      code: ACC_ERRORS.not_set_up.code,
      message: accErrorMessage('not_set_up'),
      detail: { key: 'not_set_up' },
    })
  }
  return catalog
})

/**
 * El contexto del motor para este bar y estas partidas (G.3: «DESDE LA BASE,
 * nunca lo del cliente»). Para páginas: tira `AccountingContextError` (el
 * `error.tsx` de la sección lo muestra). Para acciones, `tryLoadPostingContext`.
 */
export async function loadPostingContext(
  tenantId: string,
  refs: PostingContextRefs = {},
): Promise<PostingContext> {
  const [catalog, openItems] = await Promise.all([
    loadPostingCatalog(tenantId),
    loadOpenItems(tenantId, refs),
  ])
  return buildPostingContext(catalog, openItems)
}

export type PostingContextResult =
  | { ok: true; ctx: PostingContext }
  | { ok: false; state: AccFailureState }

/** `loadPostingContext` sin tirar: el estado de error va directo a la acción. */
export async function tryLoadPostingContext(
  tenantId: string,
  refs: PostingContextRefs = {},
): Promise<PostingContextResult> {
  try {
    return { ok: true, ctx: await loadPostingContext(tenantId, refs) }
  } catch (error) {
    if (error instanceof AccountingContextError) return { ok: false, state: error.state }
    console.error(
      '[accounting.context] inesperado',
      error instanceof Error ? error.message : 'unknown',
    )
    return { ok: false, state: { ok: false, code: 'error', message: ACC_GENERIC_ERROR } }
  }
}
