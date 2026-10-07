import 'server-only'
import { ACCOUNT_TYPES, type AccountType, type Side } from '@/lib/accounting/types'
import { todayInCordoba } from '@/lib/dates/zone'
import { getTrialBalance } from './books'
import {
  asRecords,
  bool,
  dayOrNull,
  int,
  intOrNull,
  isRecord,
  isUuid,
  optionalDay,
  queryError,
  readerClient,
  settleQuery,
  str,
  strings,
  strOrNull,
  type UnknownRecord,
} from './shared'

/**
 * Plan de cuentas (§F.14, H.16): `select` directo de `acc_accounts` (≤ 300
 * filas) ordenado por código, y el saldo de cada cuenta al día. También lee lo
 * que devuelven `acc_import_accounts` y `acc_remap_system_account` (#16).
 */

export type AccountRow = {
  id: string
  code: string
  name: string
  type: AccountType
  normalSide: Side
  parentId: string | null
  level: number
  /** Ancestros, de la raíz al padre. */
  path: string[]
  postable: boolean
  active: boolean
  systemKey: string | null
  requiresParty: boolean
  isTreasury: boolean
  purchaseSelectable: boolean
  manualSelectable: boolean
  description: string | null
  sort: number
  /** Para la concurrencia optimista de `saveAccount`. */
  updatedAt: string
}

export type AccountWithBalance = AccountRow & {
  /** Debe − Haber al día (grupos: suma de sus hojas); `null` si la base no lo pudo calcular. */
  balanceCents: number | null
  /** El saldo leído del lado normal de la cuenta (positivo = saldo normal). */
  normalBalanceCents: number | null
  hasChildren: boolean
}

export type AccountsWithBalances = {
  asOf: string
  rows: AccountWithBalance[]
  /** `false` si no se pudieron calcular los saldos (la lista igual se muestra). */
  balancesAvailable: boolean
}

const ACCOUNT_COLUMNS =
  'id, code, name, type, normal_side, parent_id, level, path, postable, active, system_key, requires_party, is_treasury, purchase_selectable, manual_selectable, description, sort, updated_at'

function accountTypeOrNull(value: unknown): AccountType | null {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
    ? (value as AccountType)
    : null
}

function accountType(value: unknown): AccountType {
  return accountTypeOrNull(value) ?? 'asset'
}

function sideOrNull(value: unknown): Side | null {
  return value === 'debit' || value === 'credit' ? value : null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseAccount(row: UnknownRecord): AccountRow {
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    type: accountType(row.type),
    normalSide: row.normal_side === 'credit' ? 'credit' : 'debit',
    parentId: strOrNull(row.parent_id),
    level: int(row.level),
    path: strings(row.path),
    postable: bool(row.postable),
    active: bool(row.active),
    systemKey: strOrNull(row.system_key),
    requiresParty: bool(row.requires_party),
    isTreasury: bool(row.is_treasury),
    purchaseSelectable: bool(row.purchase_selectable),
    manualSelectable: bool(row.manual_selectable),
    description: strOrNull(row.description),
    sort: int(row.sort),
    updatedAt: str(row.updated_at),
  }
}

/** Orden por código segmento a segmento («1.1.2» antes que «1.1.10»). */
export function compareAccountCodes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i += 1) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    const diff = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)
    if (diff !== 0) return diff
  }
  return 0
}

/** El plan de cuentas en orden de código (las activas, salvo que se pidan todas). */
export async function listAccounts(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<AccountRow[]> {
  const supabase = await readerClient()
  let query = supabase
    .from('acc_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('code', { ascending: true })
    .limit(1000)
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw queryError('acc_accounts', error)
  return ((data ?? []) as unknown[])
    .filter(isRecord)
    .map(parseAccount)
    .sort((a, b) => compareAccountCodes(a.code, b.code))
}

export async function getAccount(tenantId: string, accountId: string): Promise<AccountRow | null> {
  if (!isUuid(accountId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', accountId)
    .maybeSingle()
  if (error) throw queryError('acc_accounts', error)
  return isRecord(data) ? parseAccount(data) : null
}

/**
 * El árbol del plan con el saldo de cada cuenta al día (H.16): patrimoniales
 * con toda su historia; resultados, desde el inicio del ejercicio. Los grupos
 * suman sus hojas. Si los saldos no se pueden calcular, la lista sale igual con
 * `balancesAvailable: false`.
 */
export async function listAccountsWithBalances(
  tenantId: string,
  opts: { asOf?: string | null; includeInactive?: boolean } = {},
): Promise<AccountsWithBalances> {
  const asOf = optionalDay(opts.asOf) ?? todayInCordoba()
  const [accounts, trial] = await Promise.all([
    listAccounts(tenantId, { includeInactive: opts.includeInactive }),
    settleQuery(getTrialBalance(tenantId, { from: asOf, to: asOf })),
  ])
  const balances = new Map<string, number>()
  if (trial.ok) {
    for (const row of trial.data.rows) {
      if (row.isVirtual) continue
      balances.set(row.accountId, row.closingDebitCents - row.closingCreditCents)
    }
  }
  const parents = new Set(accounts.map((a) => a.parentId).filter((id): id is string => id !== null))
  return {
    asOf: dayOrNull(asOf) ?? asOf,
    balancesAvailable: trial.ok,
    rows: accounts.map((account) => {
      const balance = trial.ok ? (balances.get(account.id) ?? 0) : null
      return {
        ...account,
        balanceCents: balance,
        normalBalanceCents:
          balance === null ? null : account.normalSide === 'debit' ? balance : 0 - balance,
        hasChildren: parents.has(account.id),
      }
    }),
  }
}

// ─── Importar un plan (`acc_import_accounts`, #16) ───────────────────────────

/** Qué pasa con cada línea: alta, cambio, nada o error (no se importa nada mientras haya uno). */
export type ChartImportAction = 'create' | 'update' | 'none' | 'error'

/** Lo que cambia de una cuenta que ya existe. */
export type ChartImportChange =
  | 'name'
  | 'description'
  | 'parent'
  | 'type'
  | 'normal_side'
  | 'postable'

const IMPORT_ACTIONS: readonly ChartImportAction[] = ['create', 'update', 'none', 'error']
const IMPORT_CHANGES: readonly ChartImportChange[] = [
  'name',
  'description',
  'parent',
  'type',
  'normal_side',
  'postable',
]

export type ChartImportResultRow = {
  /** Línea de lo que se mandó, desde 1. */
  row: number
  code: string
  name: string
  action: ChartImportAction
  /** La cuenta que ya existe con ese código (o la nueva, si se aplicó). */
  accountId: string | null
  /** El grupo que queda (el pedido o el inferido por el código); `null` = cuenta principal. */
  parentCode: string | null
  level: number | null
  type: AccountType | null
  normalSide: Side | null
  postable: boolean | null
  /** Es una cuenta del sistema: la UI lo resalta si cambia. */
  systemKey: string | null
  /** Es la cuenta de una caja (su nombre no se cambia desde acá). */
  isTreasury: boolean
  changes: ChartImportChange[]
  previous: {
    name: string | null
    parentCode: string | null
    type: AccountType | null
    normalSide: Side | null
    postable: boolean | null
    description: string | null
  } | null
  /** Clave del catálogo (`import_parent_not_found`, `code_invalid`…). */
  error: string | null
  /** Datos del error (`{parent_code}`, `{row}`, `{account_code, account_name}`), solo escalares. */
  errorDetail: Record<string, string | number | boolean | null>
}

export type ChartImportResult = {
  dryRun: boolean
  applied: boolean
  total: number
  creates: number
  updates: number
  unchanged: number
  errors: number
  rows: ChartImportResultRow[]
}

function scalars(value: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!isRecord(value)) return out
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v
    }
  }
  return out
}

function importRow(r: UnknownRecord, index: number): ChartImportResultRow {
  const action = IMPORT_ACTIONS.find((a) => a === r.action) ?? 'error'
  const error = strOrNull(r.error)
  const previous = isRecord(r.previous)
    ? {
        name: strOrNull(r.previous.name),
        parentCode: strOrNull(r.previous.parent_code),
        type: accountTypeOrNull(r.previous.type),
        normalSide: sideOrNull(r.previous.normal_side),
        postable: boolOrNull(r.previous.postable),
        description: strOrNull(r.previous.description),
      }
    : null
  return {
    row: intOrNull(r.row) ?? index + 1,
    code: str(r.code),
    name: str(r.name),
    // Una fila con error siempre cuenta como error (aunque la acción no llegue).
    action: error ? 'error' : action,
    accountId: isUuid(r.account_id) ? r.account_id : null,
    parentCode: strOrNull(r.parent_code),
    level: intOrNull(r.level),
    type: accountTypeOrNull(r.type),
    normalSide: sideOrNull(r.normal_side),
    postable: boolOrNull(r.postable),
    systemKey: strOrNull(r.system_key),
    isTreasury: r.is_treasury === true,
    changes: strings(r.changes).filter((c): c is ChartImportChange =>
      (IMPORT_CHANGES as readonly string[]).includes(c),
    ),
    previous,
    error: error ?? (action === 'error' ? 'import_failed' : null),
    errorDetail: scalars(r.error_detail),
  }
}

/**
 * Lo que devuelve `acc_import_accounts` (ensayo o real), en camelCase. Los conteos se recalculan de
 * las filas: son los que la pantalla muestra al lado de cada una.
 */
export function parseChartImportResult(raw: unknown): ChartImportResult | null {
  if (!isRecord(raw)) return null
  const rows = asRecords(raw.rows).map(importRow)
  const count = (action: ChartImportAction) => rows.filter((r) => r.action === action).length
  return {
    dryRun: raw.dry_run !== false,
    applied: raw.applied === true,
    total: rows.length,
    creates: count('create'),
    updates: count('update'),
    unchanged: count('none'),
    errors: count('error'),
    rows,
  }
}

// ─── Claves del sistema (`acc_remap_system_account`, #16) ────────────────────

export type SystemRemapResult = {
  systemKey: string
  /** `false` si ya era esa cuenta (no se escribió nada). */
  changed: boolean
  from: { id: string; code: string; name: string } | null
  to: { id: string; code: string; name: string }
  /** Proveedores, clientes u organismos que usaban la anterior como cuenta de control. */
  partiesRepointed: number
}

function accountBrief(value: unknown): { id: string; code: string; name: string } | null {
  if (!isRecord(value) || !isUuid(value.id)) return null
  return { id: value.id, code: str(value.code), name: str(value.name) }
}

export function parseSystemRemapResult(raw: unknown): SystemRemapResult | null {
  if (!isRecord(raw)) return null
  const to = accountBrief(raw.to)
  if (!to) return null
  return {
    systemKey: str(raw.system_key),
    changed: raw.changed === true,
    from: accountBrief(raw.from),
    to,
    partiesRepointed: intOrNull(raw.parties_repointed) ?? 0,
  }
}
