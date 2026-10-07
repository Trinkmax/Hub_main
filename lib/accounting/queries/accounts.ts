import 'server-only'
import { ACCOUNT_TYPES, type AccountType, type Side } from '@/lib/accounting/types'
import { todayInCordoba } from '@/lib/dates/zone'
import { getTrialBalance } from './books'
import {
  bool,
  dayOrNull,
  int,
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
 * filas) ordenado por código, y el saldo de cada cuenta al día.
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

function accountType(value: unknown): AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
    ? (value as AccountType)
    : 'asset'
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
