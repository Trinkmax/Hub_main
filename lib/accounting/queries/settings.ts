import 'server-only'
import {
  CHANNELS,
  type Channel,
  SALES_METHOD_KINDS,
  SAS_IVA_CONDITIONS,
  type SalesMethodKind,
  type SasIvaCondition,
} from '@/lib/accounting/types'
import {
  bool,
  day,
  dayOrNull,
  instantOrNull,
  int,
  isRecord,
  namesById,
  queryError,
  readerClient,
  str,
  strOrNull,
} from './shared'

/**
 * Ajustes de Administración (H.17): datos de la SAS, medios de cobro y puntos
 * de venta. Lectura directa de las tablas (RLS de lectores).
 */

export type AccountingSettings = {
  legalName: string
  cuit: string | null
  ivaCondition: SasIvaCondition
  iibbRegime: 'local' | 'convenio_multilateral' | 'exento' | 'no_inscripto'
  iibbNumber: string | null
  iibbJurisdictionCode: number
  activityStartDate: string | null
  fiscalAddress: string | null
  booksStartDate: string
  fiscalYearEndMonth: number
  ivaSettlementMode: 'on_close' | 'manual'
  ivaDueDay: number
  iibbDueDay: number
  vatToleranceCents: number
  bankTaxCreditComputableBp: number
  bankTaxDebitComputableBp: number
  uninvoicedSalesMode: 'separate_accounts' | 'single_account'
  closedPeriodVoidIvaMode: 'adjustment_only' | 'negative_row'
  dueSoonDays: number
  openingStatus: 'pending' | 'posted' | 'skipped'
  setupCompletedAt: string | null
  /** Para la concurrencia optimista de `saveSettings`. */
  updatedAt: string
  /** Hay comprobantes cargados: `iva_condition` y `books_start_date` quedan fijos. */
  hasDocuments: boolean
  /** Hay meses cerrados: el mes de cierre del ejercicio queda fijo. */
  hasClosedPeriods: boolean
}

export type SalesMethodRow = {
  id: string
  name: string
  kind: SalesMethodKind
  channel: Channel
  treasuryAccountId: string | null
  treasuryName: string | null
  partyId: string | null
  partyName: string | null
  settlementDays: number
  sort: number
  active: boolean
  systemKey: string | null
  updatedAt: string
}

export type SalesPointRow = {
  id: string
  number: number
  label: string
  defaultChannel: Channel
  active: boolean
  updatedAt: string
}

const SETTINGS_COLUMNS =
  'legal_name, cuit, iva_condition, iibb_regime, iibb_number, iibb_jurisdiction_code, activity_start_date, fiscal_address, books_start_date, fiscal_year_end_month, iva_settlement_mode, iva_due_day, iibb_due_day, vat_tolerance_cents, bank_tax_credit_computable_bp, bank_tax_debit_computable_bp, uninvoiced_sales_mode, closed_period_void_iva_mode, due_soon_days, opening_status, setup_completed_at, updated_at'

function sasIvaCondition(value: unknown): SasIvaCondition {
  return typeof value === 'string' && (SAS_IVA_CONDITIONS as readonly string[]).includes(value)
    ? (value as SasIvaCondition)
    : 'responsable_inscripto'
}

function channel(value: unknown): Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value)
    ? (value as Channel)
    : 'salon'
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Datos de la SAS y parámetros. `null` si Administración todavía no se
 * configuró (no hay fila).
 */
export async function getAccountingSettings(tenantId: string): Promise<AccountingSettings | null> {
  const supabase = await readerClient()
  const [settings, documents, closed] = await Promise.all([
    supabase.from('acc_settings').select(SETTINGS_COLUMNS).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('acc_documents').select('id').eq('tenant_id', tenantId).limit(1),
    supabase
      .from('acc_periods')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'closed')
      .limit(1),
  ])
  if (settings.error) throw queryError('acc_settings', settings.error)
  if (documents.error) throw queryError('acc_documents', documents.error)
  if (closed.error) throw queryError('acc_periods', closed.error)
  const row = settings.data
  if (!isRecord(row)) return null
  return {
    legalName: str(row.legal_name),
    cuit: strOrNull(row.cuit),
    ivaCondition: sasIvaCondition(row.iva_condition),
    iibbRegime: oneOf(
      row.iibb_regime,
      ['local', 'convenio_multilateral', 'exento', 'no_inscripto'] as const,
      'local',
    ),
    iibbNumber: strOrNull(row.iibb_number),
    iibbJurisdictionCode: int(row.iibb_jurisdiction_code),
    activityStartDate: dayOrNull(row.activity_start_date),
    fiscalAddress: strOrNull(row.fiscal_address),
    booksStartDate: day(row.books_start_date),
    fiscalYearEndMonth: int(row.fiscal_year_end_month) || 12,
    ivaSettlementMode: row.iva_settlement_mode === 'manual' ? 'manual' : 'on_close',
    ivaDueDay: int(row.iva_due_day),
    iibbDueDay: int(row.iibb_due_day),
    vatToleranceCents: int(row.vat_tolerance_cents),
    bankTaxCreditComputableBp: int(row.bank_tax_credit_computable_bp),
    bankTaxDebitComputableBp: int(row.bank_tax_debit_computable_bp),
    uninvoicedSalesMode:
      row.uninvoiced_sales_mode === 'single_account' ? 'single_account' : 'separate_accounts',
    closedPeriodVoidIvaMode:
      row.closed_period_void_iva_mode === 'negative_row' ? 'negative_row' : 'adjustment_only',
    dueSoonDays: int(row.due_soon_days) || 7,
    openingStatus: oneOf(row.opening_status, ['pending', 'posted', 'skipped'] as const, 'pending'),
    setupCompletedAt: instantOrNull(row.setup_completed_at),
    updatedAt: str(row.updated_at),
    hasDocuments: (documents.data ?? []).length > 0,
    hasClosedPeriods: (closed.data ?? []).length > 0,
  }
}

/** Medios de cobro en el orden del cierre del día (el de Thinkeon). */
export async function listSalesMethods(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<SalesMethodRow[]> {
  const supabase = await readerClient()
  let query = supabase
    .from('acc_sales_methods')
    .select(
      'id, name, kind, channel, treasury_account_id, party_id, settlement_days, sort, active, system_key, updated_at',
    )
    .eq('tenant_id', tenantId)
    .order('sort', { ascending: true })
    .order('name', { ascending: true })
    .limit(500)
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw queryError('acc_sales_methods', error)
  const rows = ((data ?? []) as unknown[]).filter(isRecord)
  const [treasuries, parties] = await Promise.all([
    namesById(
      tenantId,
      'acc_treasury_accounts',
      rows.map((r) => r.treasury_account_id),
    ),
    namesById(
      tenantId,
      'acc_parties',
      rows.map((r) => r.party_id),
    ),
  ])
  return rows.map((row) => {
    const treasury = treasuries.get(str(row.treasury_account_id))
    const party = parties.get(str(row.party_id))
    return {
      id: str(row.id),
      name: str(row.name),
      kind: oneOf(row.kind, SALES_METHOD_KINDS, 'treasury'),
      channel: channel(row.channel),
      treasuryAccountId: strOrNull(row.treasury_account_id),
      treasuryName: treasury ? str(treasury.name) : null,
      partyId: strOrNull(row.party_id),
      partyName: party ? str(party.name) : null,
      settlementDays: int(row.settlement_days),
      sort: int(row.sort),
      active: bool(row.active),
      systemKey: strOrNull(row.system_key),
      updatedAt: str(row.updated_at),
    }
  })
}

/** Puntos de venta de la SAS, por número. */
export async function listSalesPoints(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<SalesPointRow[]> {
  const supabase = await readerClient()
  let query = supabase
    .from('acc_sales_points')
    .select('id, number, label, default_channel, active, updated_at')
    .eq('tenant_id', tenantId)
    .order('number', { ascending: true })
    .limit(500)
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw queryError('acc_sales_points', error)
  return ((data ?? []) as unknown[]).filter(isRecord).map((row) => ({
    id: str(row.id),
    number: int(row.number),
    label: str(row.label),
    defaultChannel: channel(row.default_channel),
    active: bool(row.active),
    updatedAt: str(row.updated_at),
  }))
}
