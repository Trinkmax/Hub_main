import 'server-only'
import { TREASURY_KINDS, type TreasuryKind } from '@/lib/accounting/types'
import { todayInCordoba } from '@/lib/dates/zone'
import { getSubledger, getTrialBalance, type SubledgerRow } from './books'
import {
  bool,
  callRpcRows,
  cents,
  dayOrNull,
  int,
  isRecord,
  isUuid,
  optionalDay,
  type QueryPage,
  queryError,
  readerClient,
  requireRange,
  str,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Cajas y bancos (§F.9, H.11). Saldos con signo Debe − Haber: la tarjeta de la
 * empresa (pasivo) da negativo cuando se le debe; la UI lo dice como deuda.
 */

export type TreasuryBalanceRow = {
  treasuryId: string
  accountId: string | null
  name: string
  kind: TreasuryKind
  accountCode: string
  /** Alias del CBU/CVU (se muestra chico debajo del nombre). */
  alias: string | null
  bankName: string | null
  /** Puede quedar en negativo sin aviso (descubierto acordado). */
  allowNegative: boolean
  /** Las inactivas solo aparecen si tienen saldo. */
  active: boolean
  /** Debe − Haber al día: en la tarjeta de la empresa, la deuda es negativa. */
  balanceCents: number
  /** Billeteras: lo que falta acreditar (QR y transferencias). */
  pendingWalletCents: number
  lastMovementDate: string | null
  lastCheckedOn: string | null
}

export type TreasuryAccountRow = {
  id: string
  accountId: string
  accountCode: string | null
  name: string
  kind: TreasuryKind
  bankPartyId: string | null
  bankName: string | null
  cbuCvu: string | null
  alias: string | null
  accountNumber: string | null
  allowNegative: boolean
  lastCheckedOn: string | null
  sort: number
  active: boolean
  systemKey: string | null
  updatedAt: string
}

/** Una fila de «Movimientos de una caja»: la primera página empieza con «Saldo anterior». */
export type TreasuryMovementRow = {
  rowKind: 'opening' | 'line'
  entryId: string | null
  entryDate: string | null
  documentId: string | null
  documentSeq: number | null
  documentKind: string | null
  /** «Factura A 0003-00001290», «Movimiento entre cuentas». */
  documentLabel: string | null
  /** Concepto del asiento. */
  description: string | null
  /** Leyenda de la línea. */
  memo: string | null
  /** De dónde vino o a dónde fue: las otras cuentas del asiento («Proveedores · IVA crédito fiscal»). */
  counterpart: string | null
  /** Entró (Debe de la cuenta de la caja). */
  inCents: number
  /** Salió (Haber de la cuenta de la caja). */
  outCents: number
  /** Saldo acumulado, Debe − Haber (en la tarjeta de la empresa, negativo = deuda). */
  balanceCents: number
}

export type TreasuryMovementsPage = QueryPage<TreasuryMovementRow> & {
  treasury: TreasuryAccountRow
  from: string
  to: string
  /** Saldo al empezar el período (Debe − Haber). */
  openingCents: number
  /** Entró y salió en TODO el período (no solo en esta página). */
  inCents: number
  outCents: number
  closingCents: number
}

export const CASH_FLOW_CATEGORIES = [
  'sales',
  'suppliers',
  'taxes',
  'payroll',
  'bank',
  'partners',
  'other',
] as const
export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number]

export const CASH_FLOW_CATEGORY_LABELS: Readonly<Record<CashFlowCategory, string>> = {
  sales: 'Cobros de ventas',
  suppliers: 'Pagos a proveedores',
  taxes: 'Impuestos',
  payroll: 'Sueldos y cargas',
  bank: 'Comisiones y gastos bancarios',
  partners: 'Socios',
  other: 'Otros',
}

export type CashFlowRow = {
  /** Primer día del mes. */
  month: string
  category: string
  categoryLabel: string
  inflowCents: number
  outflowCents: number
  netCents: number
}

export type CashProjectionRow = {
  /** Lunes de la semana (o el primer día de la proyección). */
  weekStart: string
  inCents: number
  outCents: number
  projectedBalanceCents: number
}

function treasuryKind(value: unknown): TreasuryKind {
  return typeof value === 'string' && (TREASURY_KINDS as readonly string[]).includes(value)
    ? (value as TreasuryKind)
    : 'other'
}

/** La categoría del flujo en palabras; una que no conocemos se muestra tal cual. */
export function cashFlowCategoryLabel(category: string): string {
  return category in CASH_FLOW_CATEGORY_LABELS
    ? CASH_FLOW_CATEGORY_LABELS[category as CashFlowCategory]
    : category
}

/** Saldo de cada caja al día (F.9). Sin fecha, hoy en Córdoba. */
export async function listTreasuryBalances(
  tenantId: string,
  opts: { asOf?: string | null } = {},
): Promise<TreasuryBalanceRow[]> {
  const asOf = optionalDay(opts.asOf) ?? todayInCordoba()
  const supabase = await readerClient()
  const [raw, extras] = await Promise.all([
    callRpcRows('acc_report_treasury_balances', { p_tenant_id: tenantId, p_as_of: asOf }),
    // Lo que el reporte no trae (alias, banco, descubierto): una lectura chica.
    supabase
      .from('acc_treasury_accounts')
      .select('id, alias, bank_name, allow_negative')
      .eq('tenant_id', tenantId)
      .limit(500),
  ])
  if (extras.error) throw queryError('acc_treasury_accounts', extras.error)
  const byId = new Map<string, UnknownRecord>()
  for (const row of (extras.data ?? []) as unknown[]) {
    if (isRecord(row)) byId.set(str(row.id), row)
  }
  return raw.map((row) => {
    const treasuryId = str(row.treasury_id)
    const extra = byId.get(treasuryId)
    return {
      treasuryId,
      accountId: strOrNull(row.account_id),
      name: str(row.name),
      kind: treasuryKind(row.kind),
      accountCode: str(row.account_code),
      alias: extra ? strOrNull(extra.alias) : null,
      bankName: extra ? strOrNull(extra.bank_name) : null,
      allowNegative: extra ? bool(extra.allow_negative) : false,
      active: row.active === undefined || row.active === null ? true : bool(row.active),
      balanceCents: cents(row.balance_cents),
      pendingWalletCents: cents(row.pending_wallet_cents),
      lastMovementDate: dayOrNull(row.last_movement_date),
      lastCheckedOn: dayOrNull(row.last_checked_on),
    }
  })
}

const TREASURY_COLUMNS =
  'id, account_id, name, kind, bank_party_id, bank_name, cbu_cvu, alias, account_number, allow_negative, last_checked_on, sort, active, system_key, updated_at'

function parseTreasury(row: UnknownRecord, codes: ReadonlyMap<string, string>): TreasuryAccountRow {
  const accountId = str(row.account_id)
  return {
    id: str(row.id),
    accountId,
    accountCode: codes.get(accountId) ?? null,
    name: str(row.name),
    kind: treasuryKind(row.kind),
    bankPartyId: strOrNull(row.bank_party_id),
    bankName: strOrNull(row.bank_name),
    cbuCvu: strOrNull(row.cbu_cvu),
    alias: strOrNull(row.alias),
    accountNumber: strOrNull(row.account_number),
    allowNegative: bool(row.allow_negative),
    lastCheckedOn: dayOrNull(row.last_checked_on),
    sort: int(row.sort),
    active: bool(row.active),
    systemKey: strOrNull(row.system_key),
    updatedAt: str(row.updated_at),
  }
}

async function accountCodes(
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(isUuid))]
  if (unique.length === 0) return new Map()
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_accounts')
    .select('id, code')
    .eq('tenant_id', tenantId)
    .in('id', unique)
  if (error) throw queryError('acc_accounts', error)
  const map = new Map<string, string>()
  for (const row of (data ?? []) as unknown[]) {
    if (isRecord(row)) map.set(str(row.id), str(row.code))
  }
  return map
}

/** Cajas y cuentas del bar en el orden de Ajustes (las activas, salvo que se pidan todas). */
export async function listTreasuryAccounts(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<TreasuryAccountRow[]> {
  const supabase = await readerClient()
  let query = supabase
    .from('acc_treasury_accounts')
    .select(TREASURY_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('sort', { ascending: true })
    .order('name', { ascending: true })
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw queryError('acc_treasury_accounts', error)
  const rows = ((data ?? []) as unknown[]).filter(isRecord)
  const codes = await accountCodes(
    tenantId,
    rows.map((r) => str(r.account_id)),
  )
  return rows.map((row) => parseTreasury(row, codes))
}

export async function getTreasuryAccount(
  tenantId: string,
  treasuryId: string,
): Promise<TreasuryAccountRow | null> {
  if (!isUuid(treasuryId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_treasury_accounts')
    .select(TREASURY_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', treasuryId)
    .maybeSingle()
  if (error) throw queryError('acc_treasury_accounts', error)
  if (!isRecord(data)) return null
  const codes = await accountCodes(tenantId, [str(data.account_id)])
  return parseTreasury(data, codes)
}

function toMovement(row: SubledgerRow): TreasuryMovementRow {
  const v = row.values
  const text = (key: string): string | null => {
    const value = v[key]
    return typeof value === 'string' && value !== '' ? value : null
  }
  const amount = (key: string): number => {
    const value = v[key]
    return typeof value === 'number' ? value : 0
  }
  const seq = v.document_seq
  return {
    rowKind: row.rowKind,
    entryId: row.entryId,
    entryDate: row.date,
    documentId: row.documentId,
    documentSeq: typeof seq === 'number' ? seq : null,
    documentKind: text('document_kind'),
    documentLabel: text('document_label'),
    description: text('description'),
    memo: text('memo'),
    counterpart: text('counterpart'),
    inCents: amount('inflow_cents'),
    outCents: amount('outflow_cents'),
    balanceCents: amount('balance_cents'),
  }
}

/**
 * Movimientos de una caja en el período (H.11 `/cajas/[id]`): el subdiario de
 * disponibilidades de esa caja («Saldo anterior», contrapartida y saldo
 * acumulado calculado en la base) + Saldo · Entró · Salió de TODO el período,
 * que salen de sumas y saldos. `null` si la caja no existe en este bar.
 */
export async function getTreasuryMovements(
  tenantId: string,
  params: {
    treasuryId: string
    from: string
    to: string
    after?: string | null
    limit?: number | null
  },
): Promise<TreasuryMovementsPage | null> {
  const { from, to } = requireRange(params.from, params.to)
  const treasury = await getTreasuryAccount(tenantId, params.treasuryId)
  if (!treasury) return null

  const [page, trial] = await Promise.all([
    getSubledger(tenantId, {
      kind: 'treasury',
      treasuryId: treasury.id,
      from,
      to,
      after: params.after,
      limit: params.limit ?? 200,
    }),
    getTrialBalance(tenantId, { from, to }),
  ])

  const account = trial.rows.find((r) => r.accountId === treasury.accountId)
  const openingCents = account ? account.openingDebitCents - account.openingCreditCents : 0
  const inCents = account?.periodDebitCents ?? 0
  const outCents = account?.periodCreditCents ?? 0
  return {
    rows: page.rows.map(toMovement),
    nextCursor: page.nextCursor,
    totalRows: page.totalRows,
    treasury,
    from,
    to,
    openingCents,
    inCents,
    outCents,
    closingCents: openingCents + inCents - outCents,
  }
}

/** Flujo de caja realizado por mes y categoría (F.9). */
export async function getCashFlow(
  tenantId: string,
  params: { from: string; to: string },
): Promise<CashFlowRow[]> {
  const { from, to } = requireRange(params.from, params.to)
  const raw = await callRpcRows('acc_report_cash_flow', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
  })
  return raw.map((row) => {
    const category = str(row.category, 'other')
    const inflowCents = cents(row.inflow_cents)
    const outflowCents = cents(row.outflow_cents)
    return {
      month: dayOrNull(row.month) ?? '',
      category,
      categoryLabel: cashFlowCategoryLabel(category),
      inflowCents,
      outflowCents,
      netCents: inflowCents - outflowCents,
    }
  })
}

/** Proyección de las próximas semanas (F.9, opcional en la fase 4). */
export async function getCashProjection(
  tenantId: string,
  params: { asOf?: string | null; weeks?: number } = {},
): Promise<CashProjectionRow[]> {
  const asOf = optionalDay(params.asOf) ?? todayInCordoba()
  const weeks = Math.min(12, Math.max(1, Math.trunc(params.weeks ?? 4)))
  const raw = await callRpcRows('acc_report_cash_projection', {
    p_tenant_id: tenantId,
    p_as_of: asOf,
    p_weeks: weeks,
  })
  return raw.map((row) => ({
    weekStart: dayOrNull(row.week_start) ?? '',
    inCents: cents(row.expected_in_cents ?? row.in_cents),
    outCents: cents(row.expected_out_cents ?? row.out_cents),
    projectedBalanceCents: cents(row.projected_balance_cents),
  }))
}
