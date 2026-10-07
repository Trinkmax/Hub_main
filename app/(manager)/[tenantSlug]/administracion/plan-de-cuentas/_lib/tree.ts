/**
 * El árbol del plan de cuentas (H.16 + #16), puro:
 * - el orden de árbol sale de los grupos (`parentId`), no del código: desde la #16 el código es una
 *   etiqueta libre y una cuenta movida de grupo conserva el suyo;
 * - qué filas se ven según lo desplegado y los filtros (código o nombre, tipo, activas o inactivas,
 *   hasta qué nivel);
 * - el código que se propone para una cuenta nueva (espejo de `acc_next_child_code`);
 * - qué tipo puede tener una cuenta y qué pasa al moverla con todo lo que tiene adentro.
 */

import {
  compareAccountCode,
  normalizeCodeQuery,
  treeEntries,
} from '@/components/administracion/account-paths'
import { plural } from '@/components/administracion/format'
import { rankAccount } from '@/components/administracion/search'
import { childTypeAllowed, isResultType, nextChildCode } from '@/lib/accounting/chart'
import { ACCOUNT_TYPES, type AccountType, type Side } from '@/lib/accounting/types'
import { formatCents } from '@/lib/money'

export type ChartAccount = {
  id: string
  code: string
  name: string
  type: AccountType
  normalSide: Side
  parentId: string | null
  /** 1 = cuenta principal (ACTIVO, PASIVO…). */
  level: number
  postable: boolean
  active: boolean
  systemKey: string | null
  requiresParty: boolean
  isTreasury: boolean
  purchaseSelectable: boolean
  manualSelectable: boolean
  description: string | null
  /** Debe − Haber al día (grupos: la suma de sus cuentas); `null` si no se pudo calcular. */
  balanceCents: number | null
  hasChildren: boolean
  updatedAt: string
}

/** Hasta 8 niveles (`account_level_too_deep`). */
export const MAX_CHART_LEVEL = 8

/** Cómo se dice cada tipo (singular, para «Tipo: Activo»). */
export const ACCOUNT_TYPE_NAMES: Readonly<Record<AccountType, string>> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio neto',
  income: 'Ingreso',
  expense: 'Egreso',
}

/** «una cuenta de activo», para las explicaciones. */
export const ACCOUNT_TYPE_OF: Readonly<Record<AccountType, string>> = {
  asset: 'de activo',
  liability: 'de pasivo',
  equity: 'de patrimonio neto',
  income: 'de ingresos',
  expense: 'de egresos',
}

// ─── Índice ──────────────────────────────────────────────────────────────────

export type ChartIndex = {
  /** En orden de árbol: cada grupo antes que lo que tiene adentro; hermanas por código. */
  ordered: readonly ChartAccount[]
  byId: ReadonlyMap<string, ChartAccount>
  /** 0 para las cuentas principales. */
  depth: ReadonlyMap<string, number>
  /** Ids de la raíz al grupo de cada cuenta. */
  ancestors: ReadonlyMap<string, readonly string[]>
  children: ReadonlyMap<string, readonly ChartAccount[]>
  /** Todos los códigos del bar (el código es único). */
  codes: readonly string[]
  /** El nivel más profundo que hay (1 = solo principales). */
  maxLevel: number
}

export function indexChart(accounts: readonly ChartAccount[]): ChartIndex {
  const entries = treeEntries(accounts)
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const depth = new Map<string, number>()
  const ancestors = new Map<string, readonly string[]>()
  const children = new Map<string, ChartAccount[]>()
  let maxDepth = 0
  for (const entry of entries) {
    const id = entry.account.id
    depth.set(id, entry.depth)
    ancestors.set(id, entry.ancestors)
    maxDepth = Math.max(maxDepth, entry.depth)
    if (entry.parentId) {
      const list = children.get(entry.parentId)
      if (list) list.push(entry.account)
      else children.set(entry.parentId, [entry.account])
    }
  }
  return {
    ordered: entries.map((e) => e.account),
    byId,
    depth,
    ancestors,
    children,
    codes: accounts.map((a) => a.code),
    maxLevel: accounts.length > 0 ? maxDepth + 1 : 0,
  }
}

export function childrenOf(index: ChartIndex, id: string): readonly ChartAccount[] {
  return index.children.get(id) ?? []
}

export function parentOf(index: ChartIndex, account: ChartAccount): ChartAccount | null {
  return account.parentId ? (index.byId.get(account.parentId) ?? null) : null
}

/** Todo lo que una cuenta tiene adentro, a cualquier profundidad, en orden de árbol. */
export function descendantsOf(index: ChartIndex, id: string): ChartAccount[] {
  const out: ChartAccount[] = []
  const walk = (parent: string) => {
    for (const child of childrenOf(index, parent)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

/** Cuántos niveles tiene adentro (0 = no tiene nada). */
export function subtreeHeight(index: ChartIndex, id: string): number {
  const base = index.depth.get(id) ?? 0
  let height = 0
  for (const d of descendantsOf(index, id)) {
    height = Math.max(height, (index.depth.get(d.id) ?? base) - base)
  }
  return height
}

/** «ACTIVO › Activo corriente › Caja y bancos» (el camino hasta el grupo de la cuenta). */
export function pathLabel(index: ChartIndex, id: string, separator = ' › '): string {
  return (index.ancestors.get(id) ?? [])
    .map((a) => index.byId.get(a)?.name ?? '')
    .filter((name) => name !== '')
    .join(separator)
}

// ─── Lo que se ve ────────────────────────────────────────────────────────────

export type ChartStatusFilter = 'active' | 'inactive' | 'all'
export type ChartTypeFilter = AccountType | 'all'

export type ChartFilter = {
  query: string
  status: ChartStatusFilter
  type: ChartTypeFilter
  /** Grupos desplegados (no cuenta mientras se busca). */
  expanded: ReadonlySet<string>
}

export type ChartVisibleRow = ChartAccount & {
  /** Sangría: 0 para las cuentas principales. */
  depth: number
  /** Tiene adentro algo que se ve con estos filtros (lleva la flecha). */
  expandable: boolean
  open: boolean
  /** Cumple los filtros (las demás filas que se ven son el camino hasta una que cumple). */
  match: boolean
}

export type ChartView = {
  rows: ChartVisibleRow[]
  /** Cuántas cuentas cumplen los filtros. */
  matches: number
  /** Buscando (o viendo las inactivas) se abre el camino de todo lo que aparece. */
  autoOpen: boolean
}

function statusOk(account: ChartAccount, status: ChartStatusFilter): boolean {
  return status === 'all' || (status === 'active' ? account.active : !account.active)
}

/**
 * Las filas a dibujar, en orden de árbol. Una cuenta aparece si cumple los filtros o si tiene adentro
 * algo que los cumple (es su camino). Buscando por código o nombre, o mirando las inactivas, se abre
 * todo el camino; si no, una cuenta se ve cuando todos sus grupos están desplegados.
 */
export function chartView(index: ChartIndex, filter: ChartFilter): ChartView {
  const query = normalizeCodeQuery(filter.query.trim())
  const autoOpen = query !== '' || filter.status === 'inactive'
  const passes = (a: ChartAccount) =>
    statusOk(a, filter.status) &&
    (filter.type === 'all' || a.type === filter.type) &&
    (query === '' || rankAccount(a, query) >= 0)

  // De abajo hacia arriba: un grupo es relevante si cumple o si algo de adentro cumple.
  const matches = new Set<string>()
  const relevant = new Set<string>()
  for (let i = index.ordered.length - 1; i >= 0; i -= 1) {
    const account = index.ordered[i]
    if (!account) continue
    if (passes(account)) {
      matches.add(account.id)
      relevant.add(account.id)
    }
    if (relevant.has(account.id) && account.parentId) relevant.add(account.parentId)
  }

  const rows: ChartVisibleRow[] = []
  for (const account of index.ordered) {
    if (!relevant.has(account.id)) continue
    const ancestors = index.ancestors.get(account.id) ?? []
    if (!autoOpen && ancestors.some((id) => !filter.expanded.has(id))) continue
    const expandable = childrenOf(index, account.id).some((c) => relevant.has(c.id))
    rows.push({
      ...account,
      depth: index.depth.get(account.id) ?? 0,
      expandable,
      open: expandable && (autoOpen || filter.expanded.has(account.id)),
      match: matches.has(account.id),
    })
  }
  return { rows, matches: matches.size, autoOpen }
}

/** Los grupos que tienen algo adentro (para desplegar todo). */
export function groupsWithChildren(index: ChartIndex): Set<string> {
  return new Set([...index.children.keys()].filter((id) => index.byId.has(id)))
}

/**
 * «Ver hasta el nivel N»: los grupos desplegados para que se vean los niveles 1 a N (nivel 1 = solo
 * las principales). Después cada grupo se abre o se cierra a mano.
 */
export function expandedForLevel(index: ChartIndex, level: number): Set<string> {
  const open = new Set<string>()
  for (const id of groupsWithChildren(index)) {
    if ((index.depth.get(id) ?? 0) < level - 1) open.add(id)
  }
  return open
}

/** El nivel que coincide exactamente con lo desplegado, o `null` si se abrió o cerró algo a mano. */
export function levelOfExpanded(index: ChartIndex, expanded: ReadonlySet<string>): number | null {
  // Solo cuentan los grupos que hoy tienen algo adentro (lo desplegado puede tener ids viejos).
  const groups = groupsWithChildren(index)
  const open = new Set([...expanded].filter((id) => groups.has(id)))
  for (let level = 1; level <= Math.max(1, index.maxLevel); level += 1) {
    const preset = expandedForLevel(index, level)
    if (preset.size !== open.size) continue
    if ([...preset].every((id) => open.has(id))) return level
  }
  return null
}

/** Lo desplegado al entrar: las principales abiertas y, si se llega con una cuenta, su camino. */
export function initialExpanded(index: ChartIndex, focusId: string | null): Set<string> {
  const open = expandedForLevel(index, 2)
  for (const id of focusId ? (index.ancestors.get(focusId) ?? []) : []) open.add(id)
  return open
}

// ─── Códigos que se proponen ─────────────────────────────────────────────────

/**
 * El siguiente código libre adentro de un grupo, con su estilo (espejo de `acc_next_child_code`):
 * `1.1.01.01.000` → `1.1.01.01.008`; `1.1.01` → `1.1.01.04`; y el esquema sin puntos (`1101` con
 * hijas `110101`… → `110104`).
 */
export function proposeChildCode(index: ChartIndex, parent: ChartAccount): string {
  if (!parent.code.includes('.') && /^\d+$/.test(parent.code)) {
    const undotted = childrenOf(index, parent.id).some((c) => !c.code.includes('.'))
    if (undotted) {
      const re = new RegExp(`^${parent.code}(\\d{1,6})$`)
      let max = 0
      let width = 2
      for (const code of index.codes) {
        const digits = re.exec(code)?.[1]
        if (!digits) continue
        max = Math.max(max, Number(digits))
        width = Math.max(width, digits.length)
      }
      const next = String(max + 1)
      return `${parent.code}${next.padStart(Math.max(width, next.length), '0')}`
    }
  }
  return nextChildCode(parent.code, index.codes)
}

/**
 * El código de una cuenta principal nueva: la siguiente de las que hay, con su forma
 * (`5.0.00.00.000` → `6.0.00.00.000`; `5` → `6`).
 */
export function proposeRootCode(index: ChartIndex): string {
  let best: string[] | null = null
  let max = 0
  for (const account of index.ordered) {
    if ((index.depth.get(account.id) ?? 0) !== 0) continue
    const segs = account.code.split('.')
    const first = Number(segs[0])
    if (Number.isSafeInteger(first) && first >= max) {
      max = first
      best = segs
    }
  }
  const shape = best ?? ['0']
  const width = shape[0]?.length ?? 1
  const rest = shape.slice(1).map((s) => '0'.repeat(Math.max(1, s.length)))
  const taken = new Set(index.codes)
  for (let n = max + 1; n < max + 1000; n += 1) {
    const code = [String(n).padStart(width, '0'), ...rest].join('.')
    if (!taken.has(code)) return code
  }
  return String(max + 1)
}

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type TypeChoice =
  | { kind: 'fixed'; type: AccountType; reason: string }
  | { kind: 'choose'; options: AccountType[]; fallback: AccountType | null }

/**
 * El tipo de una cuenta nueva: una principal elige cualquiera; adentro de un grupo de ingresos o
 * egresos se elige entre los dos; en el resto toma el del grupo.
 */
export function createTypeChoice(parent: ChartAccount | null): TypeChoice {
  if (!parent) return { kind: 'choose', options: [...ACCOUNT_TYPES], fallback: null }
  if (isResultType(parent.type)) {
    return { kind: 'choose', options: ['income', 'expense'], fallback: parent.type }
  }
  return {
    kind: 'fixed',
    type: parent.type,
    reason: `Toma el tipo de su grupo (${ACCOUNT_TYPE_NAMES[parent.type].toLowerCase()}).`,
  }
}

/** El tipo de una cuenta que ya existe: qué se puede elegir y, si no se puede, por qué. */
export function editTypeChoice(index: ChartIndex, account: ChartAccount): TypeChoice {
  const fixed = (reason: string): TypeChoice => ({ kind: 'fixed', type: account.type, reason })
  if (account.systemKey) return fixed('La usa el sistema: no cambia de tipo.')
  if (account.isTreasury) return fixed('Es la cuenta de una caja o banco: no cambia de tipo.')
  const parent = parentOf(index, account)
  if (parent) {
    if (isResultType(parent.type) && isResultType(account.type)) {
      return { kind: 'choose', options: ['income', 'expense'], fallback: account.type }
    }
    return fixed('Toma el tipo de su grupo.')
  }
  const kids = childrenOf(index, account.id)
  const options = ACCOUNT_TYPES.filter((t) => kids.every((c) => childTypeAllowed(t, c.type)))
  if (options.length <= 1) return fixed('Lo deciden las cuentas que tiene adentro.')
  return { kind: 'choose', options, fallback: account.type }
}

// ─── Mover ───────────────────────────────────────────────────────────────────

export type MoveCheck =
  | { ok: true; typeAfter: AccountType; typeChanges: boolean }
  | { ok: false; reason: string }

/**
 * ¿Puede ir adentro de `target` (`null` = que quede como cuenta principal)? Las reglas de la base
 * (#16): nunca adentro de sí misma, la madre es un grupo, hasta 8 niveles, y si el grupo nuevo es de
 * otro tipo (fuera de ingresos/egresos) la cuenta toma ese tipo, cosa que no pueden hacer las del
 * sistema, las de una caja ni un grupo con cuentas adentro. Los movimientos los mira la base.
 */
export function checkMove(
  index: ChartIndex,
  account: ChartAccount,
  target: ChartAccount | null,
): MoveCheck {
  if ((target?.id ?? null) === account.parentId) {
    return { ok: false, reason: target ? 'Ya está adentro de ese grupo.' : 'Ya es una principal.' }
  }
  if (!target) {
    return account.postable
      ? { ok: false, reason: 'Una cuenta imputable tiene que estar adentro de un grupo.' }
      : { ok: true, typeAfter: account.type, typeChanges: false }
  }
  if (target.postable) {
    return { ok: false, reason: 'Es una cuenta imputable: no puede tener cuentas adentro.' }
  }
  if (target.id === account.id || (index.ancestors.get(target.id) ?? []).includes(account.id)) {
    return { ok: false, reason: 'No puede ir adentro de sí misma ni de lo que tiene adentro.' }
  }
  const targetLevel = (index.depth.get(target.id) ?? 0) + 1
  if (targetLevel + 1 + subtreeHeight(index, account.id) > MAX_CHART_LEVEL) {
    return { ok: false, reason: 'Quedaría a más de 8 niveles.' }
  }
  if (childTypeAllowed(target.type, account.type)) {
    return { ok: true, typeAfter: account.type, typeChanges: false }
  }
  const own = ACCOUNT_TYPE_OF[account.type]
  if (account.systemKey) {
    return { ok: false, reason: `La usa el sistema: solo puede ir a un grupo ${own}.` }
  }
  if (account.isTreasury) {
    return { ok: false, reason: `Es la cuenta de una caja: solo puede ir a un grupo ${own}.` }
  }
  if (childrenOf(index, account.id).length > 0) {
    return { ok: false, reason: `Tiene cuentas adentro: solo puede ir a un grupo ${own}.` }
  }
  return { ok: true, typeAfter: target.type, typeChanges: true }
}

/** Los grupos (activos) adonde puede ir, en orden de árbol. */
export function moveTargets(index: ChartIndex, account: ChartAccount): ChartAccount[] {
  return index.ordered.filter((g) => !g.postable && g.active && checkMove(index, account, g).ok)
}

export type MoveSummary = {
  /** Cuentas que se mueven: la cuenta y todo lo que tiene adentro. */
  count: number
  /** Lo que tiene adentro. */
  descendants: number
  /** De todas las que se mueven, las desactivadas (se mueven igual). */
  inactive: number
  from: ChartAccount | null
  to: ChartAccount | null
  typeFrom: AccountType
  typeTo: AccountType
}

export function moveSummary(
  index: ChartIndex,
  account: ChartAccount,
  target: ChartAccount | null,
): MoveSummary {
  const inside = descendantsOf(index, account.id)
  const check = checkMove(index, account, target)
  return {
    count: 1 + inside.length,
    descendants: inside.length,
    inactive: [account, ...inside].filter((a) => !a.active).length,
    from: parentOf(index, account),
    to: target,
    typeFrom: account.type,
    typeTo: check.ok ? check.typeAfter : account.type,
  }
}

/** «Se mueve 1 cuenta.» / «Se mueven 24 cuentas: «Gastos del local» y las 23 que tiene adentro.» */
export function moveCountText(summary: MoveSummary, name: string): string {
  if (summary.descendants === 0) return 'Se mueve 1 cuenta.'
  const inside =
    summary.descendants === 1
      ? 'la que tiene adentro'
      : `las ${summary.descendants} que tiene adentro`
  return `Se mueven ${summary.count} cuentas: «${name}» y ${inside}.`
}

// ─── Desactivar ──────────────────────────────────────────────────────────────

/**
 * Por qué no se puede desactivar, con lo que se sabe acá (las reglas de la base explicadas en
 * criollo): la usa el sistema, tiene cuentas activas adentro, o tiene saldo. Lo demás (cajas,
 * proveedores, gastos fijos) lo contesta la base al guardar. `null` = se puede intentar.
 */
export function deactivationBlock(
  index: ChartIndex,
  account: ChartAccount,
  balancesAvailable: boolean,
): string | null {
  if (account.systemKey) {
    return 'La usa el sistema para armar asientos: no se desactiva. Si querés que use otra, cambiala en «Cuentas del sistema».'
  }
  const active = childrenOf(index, account.id).filter((c) => c.active).length
  if (active > 0) {
    return `Tiene ${plural(active, 'cuenta activa', 'cuentas activas')} adentro: desactivalas primero o movelas a otro grupo.`
  }
  if (
    account.postable &&
    balancesAvailable &&
    account.balanceCents !== null &&
    account.balanceCents !== 0
  ) {
    return `Tiene saldo (${formatCents(Math.abs(account.balanceCents))}): pasalo a otra cuenta con un asiento manual y después desactivala.`
  }
  return null
}

/** Las hermanas por código (para listas que no son el árbol). */
export function byCode(a: ChartAccount, b: ChartAccount): number {
  return compareAccountCode(a.code, b.code)
}
