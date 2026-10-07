/**
 * El árbol del plan de cuentas (H.16), puro: qué filas se ven según lo
 * desplegado, la búsqueda (código o nombre, sin tildes; «1101» encuentra
 * 1.1.01) y los filtros. La lista llega entera y ordenada por código (≤ 300).
 */

import { rankAccount } from '@/components/administracion/search'
import type { AccountType } from '@/lib/accounting/types'

export type ChartAccount = {
  id: string
  code: string
  name: string
  type: AccountType
  parentId: string | null
  /** 1 = rubro principal (Activo, Pasivo…). */
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

export type ChartTypeFilter = AccountType | 'all'

export type ChartFilter = {
  query: string
  showInactive: boolean
  type: ChartTypeFilter
  /** Grupos desplegados (sin búsqueda). */
  expanded: ReadonlySet<string>
}

export type ChartVisibleRow = ChartAccount & {
  /** Sangría: 0 para los rubros principales. */
  depth: number
  /** El grupo se ve abierto (buscando, siempre). */
  open: boolean
  /** Coincide con la búsqueda (las demás filas visibles son su camino). */
  match: boolean
}

/** Los rubros principales arrancan abiertos: se ven Activo › Disponibilidades, etc. */
export function defaultExpanded(accounts: readonly ChartAccount[]): Set<string> {
  return new Set(accounts.filter((a) => a.level <= 1 && a.hasChildren).map((a) => a.id))
}

/** Todos los grupos (para «Expandir todo»). */
export function allGroups(accounts: readonly ChartAccount[]): Set<string> {
  return new Set(accounts.filter((a) => a.hasChildren).map((a) => a.id))
}

function passesFilters(a: ChartAccount, filter: ChartFilter): boolean {
  if (!filter.showInactive && !a.active) return false
  return filter.type === 'all' || a.type === filter.type
}

/**
 * Las filas a dibujar, en orden de código. Buscando: lo que coincide más su
 * camino (los grupos abiertos para que se entienda dónde está). Sin buscar:
 * una cuenta se ve si todos sus grupos de arriba están desplegados.
 */
export function visibleChartRows(
  accounts: readonly ChartAccount[],
  filter: ChartFilter,
): ChartVisibleRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const minLevel = accounts.reduce(
    (min, a) => Math.min(min, a.level || 1),
    Number.POSITIVE_INFINITY,
  )
  const depthOf = (a: ChartAccount) =>
    Math.max(0, (a.level || 1) - (Number.isFinite(minLevel) ? minLevel : 1))
  const query = filter.query.trim()

  if (query) {
    const keep = new Set<string>()
    const matches = new Set<string>()
    for (const a of accounts) {
      if (!passesFilters(a, filter) || rankAccount(a, query) < 0) continue
      matches.add(a.id)
      keep.add(a.id)
      let parent = a.parentId ? byId.get(a.parentId) : undefined
      while (parent && !keep.has(parent.id)) {
        keep.add(parent.id)
        parent = parent.parentId ? byId.get(parent.parentId) : undefined
      }
    }
    return accounts
      .filter((a) => keep.has(a.id))
      .map((a) => ({ ...a, depth: depthOf(a), open: a.hasChildren, match: matches.has(a.id) }))
  }

  const out: ChartVisibleRow[] = []
  for (const a of accounts) {
    if (!passesFilters(a, filter)) continue
    let visible = true
    let parent = a.parentId ? byId.get(a.parentId) : undefined
    while (parent) {
      if (!filter.expanded.has(parent.id)) {
        visible = false
        break
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    if (!visible) continue
    out.push({ ...a, depth: depthOf(a), open: filter.expanded.has(a.id), match: false })
  }
  return out
}

/**
 * «1.1.01» → el siguiente código libre de un grupo («1.1.01.04»). Es solo la
 * sugerencia que se ve: si el campo queda vacío, lo elige la base.
 */
export function suggestedChildCode(
  parent: ChartAccount,
  accounts: readonly ChartAccount[],
): string {
  const prefix = `${parent.code}.`
  let max = 0
  // Debajo de un rubro principal los códigos van de a uno («1.1»); más abajo, de a dos («1.1.01»).
  let width = parent.level <= 1 ? 1 : 2
  for (const a of accounts) {
    if (a.parentId !== parent.id || !a.code.startsWith(prefix)) continue
    const last = a.code.slice(prefix.length)
    if (!/^\d+$/.test(last)) continue
    width = Math.max(width, last.length)
    max = Math.max(max, Number(last))
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}
