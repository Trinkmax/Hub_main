import type { ResolvedNavGroup, ResolvedNavItem } from './nav-config'

function stripQuery(href: string): string {
  return href.split('?')[0] ?? href
}

/** ¿El pathname actual matchea el path (sin query) de este href? */
export function matchesPath(pathname: string, href: string, exact?: boolean): boolean {
  const path = stripQuery(href)
  if (exact) return pathname === path
  if (pathname === path) return true
  return pathname.startsWith(`${path}/`)
}

function flatten(groups: ResolvedNavGroup[]): ResolvedNavItem[] {
  const out: ResolvedNavItem[] = []
  for (const g of groups) {
    for (const item of g.items) {
      out.push(item)
      if (item.children) out.push(...item.children)
    }
  }
  return out
}

/**
 * ¿La query del href está contenida en la query actual? Un href sin query pasa
 * siempre (su requisito es vacío). Un href con `?segment=walkin` sólo pasa si
 * TODOS sus params están presentes con igual valor en `search`.
 */
function queryMatches(href: string, current: URLSearchParams): boolean {
  const qIndex = href.indexOf('?')
  if (qIndex === -1) return true
  const required = new URLSearchParams(href.slice(qIndex + 1))
  for (const [key, value] of required) {
    if (current.get(key) !== value) return false
  }
  return true
}

/**
 * Set de hrefs activos para el sidebar. Reglas:
 *  1. Gana el match de pathname más específico (longest-prefix), aplanando
 *     padres + hijos para cruzar niveles de anidación.
 *  2. Entre los que empatan en ese pathname, sólo quedan activos los que además
 *     satisfacen su query (subset de la query actual). El padre, sin query, pasa
 *     siempre — pero `SidebarParent` suprime su highlight cuando un hijo está
 *     activo (`selfActive && !childActive`).
 *
 * Así `/x/clientes?segment=walkin` activa SÓLO Walk-in (no Reservas a la vez), y
 * `/x/clientes` pelado activa SÓLO el padre Personas. Pura y testeable: recibe
 * `search` como string (no usa hooks) para poder mockearse en Vitest.
 */
export function computeActiveHrefs(
  pathname: string,
  search: string,
  groups: ResolvedNavGroup[],
): Set<string> {
  const all = flatten(groups)
  const current = new URLSearchParams(search)

  let maxLen = 0
  for (const item of all) {
    if (item.newTab) continue
    if (matchesPath(pathname, item.href, item.exact)) {
      const len = stripQuery(item.href).length
      if (len > maxLen) maxLen = len
    }
  }

  const active = new Set<string>()
  if (maxLen === 0) return active

  for (const item of all) {
    if (item.newTab) continue
    if (!matchesPath(pathname, item.href, item.exact)) continue
    if (stripQuery(item.href).length !== maxLen) continue
    if (queryMatches(item.href, current)) active.add(item.href)
  }
  return active
}
