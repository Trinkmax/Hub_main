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

/** Los params que pide un href (`?segment=walkin` → 1 param; sin query → ninguno). */
function requiredParams(href: string): URLSearchParams {
  const qIndex = href.indexOf('?')
  return new URLSearchParams(qIndex === -1 ? '' : href.slice(qIndex + 1))
}

/**
 * ¿La query del href está contenida en la query actual? Un href sin query pasa
 * siempre (su requisito es vacío). Un href con `?segment=walkin` sólo pasa si
 * TODOS sus params están presentes con igual valor en `current`.
 */
function queryMatches(href: string, current: URLSearchParams): boolean {
  for (const [key, value] of requiredParams(href)) {
    if (current.get(key) !== value) return false
  }
  return true
}

type Match = { length: number; params: number }

/** ¿`a` es más específico que `b`? Path más largo; a igual path, más params pedidos. */
function moreSpecific(a: Match, b: Match): boolean {
  return a.length > b.length || (a.length === b.length && a.params > b.params)
}

/**
 * El mejor match de una entrada para la URL actual, mirando su href y sus
 * `activePaths` (las otras rutas de su sección); `null` si ninguno matchea.
 */
function bestMatch(
  pathname: string,
  current: URLSearchParams,
  item: ResolvedNavItem,
): Match | null {
  let best: Match | null = null
  for (const target of [item.href, ...(item.activePaths ?? [])]) {
    if (!matchesPath(pathname, target, item.exact) || !queryMatches(target, current)) continue
    const match = { length: stripQuery(target).length, params: [...requiredParams(target)].length }
    if (!best || moreSpecific(match, best)) best = match
  }
  return best
}

/**
 * La entrada del sidebar que corresponde a la página abierta, como Set de
 * hrefs: vacío o con UNO solo — nunca quedan dos resaltadas. Reglas:
 *  1. Cada entrada matchea por su href o por cualquiera de sus `activePaths`,
 *     por prefijo con borde de segmento (`/x/reservas` no matchea
 *     `/x/reservas-viejas`); las `exact`, sólo por igualdad.
 *  2. Gana el match más largo (el más específico): `/x/local/captura` es de
 *     Clientes y `/x/local/mesas` es del plano, aunque compartan `/x/local`.
 *  3. Un target con query (`?segment=…`) sólo matchea si la query actual la
 *     contiene, y a igual path le gana al que no pide nada. Si empatan del
 *     todo, gana la primera en el orden del menú.
 *  4. Las que abren en otra pestaña (`newTab`) nunca quedan resaltadas.
 *
 * Pura y testeable: recibe `search` como string (no usa hooks) para poder
 * mockearse en Vitest.
 */
export function computeActiveHrefs(
  pathname: string,
  search: string,
  groups: ResolvedNavGroup[],
): Set<string> {
  const current = new URLSearchParams(search)
  let winner: { href: string; match: Match } | null = null

  for (const group of groups) {
    for (const item of group.items) {
      if (item.newTab) continue
      const match = bestMatch(pathname, current, item)
      if (match && (!winner || moreSpecific(match, winner.match))) {
        winner = { href: item.href, match }
      }
    }
  }

  return new Set(winner ? [winner.href] : [])
}
