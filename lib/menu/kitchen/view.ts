/**
 * Lo que se ve en «A dónde va cada cosa», puro: la etiqueta de estación de cada renglón, la
 * regla de cada categoría en palabras, el titular con su número y la barra de reparto.
 *
 * Todo sale de `routing.ts`, que es la regla de la base. Acá solo se le da forma para la
 * pantalla.
 */

import { namesSummary } from './modifiers'
import {
  ancestorsOf,
  type BranchStats,
  type CartaTree,
  EMPTY_BRANCH,
  exceptionsOf,
  inheritedByCategory,
  inheritedByItem,
  NO_CATEGORY_ID,
  NO_CATEGORY_NAME,
  PATH_SEPARATOR,
  pathLabel,
  type Resolution,
  type RoutingStats,
  resolveCategory,
  ruleSentence,
} from './routing'
import type { KitchenStation } from './types'

/** Lo que la etiqueta de estación de un renglón necesita saber. */
export type SlotInfo = {
  node: 'category' | 'item'
  id: string
  /** El nombre de la categoría o del producto. */
  name: string
  /** `own` = puesta acá · `inherited` = viene de arriba · `none` = no tiene. */
  source: Resolution['source']
  /** La estación propia, si tiene. */
  ownId: string | null
  /** La estación a la que va (puede estar apagada). */
  station: KitchenStation | null
  /** Con `inherited`: de qué categoría viene. */
  fromName: string | null
  /** Lo que le tocaría si no tuviera estación propia, y a quién seguiría. */
  fallback: { station: KitchenStation | null; fromName: string | null }
  /** No tiene estación y hay productos que quedan sin una. */
  warn: boolean
  /** Una categoría sin estación cuyos productos ya tienen (cada rama la suya). */
  mixed: ReadonlyArray<KitchenStation> | null
}

export type CategoryView = {
  id: string
  name: string
  /** 0 = arriba de todo. */
  depth: number
  active: boolean
  slot: SlotInfo
  branch: BranchStats
  /** «Todo a Cocina, menos Ensaladas (Fríos).» Solo si algo de adentro se aparta. */
  rule: string | null
  /** Tiene algo para desplegar: productos o subcategorías. */
  hasInside: boolean
}

export type RouteModel = {
  categories: ReadonlyMap<string, CategoryView>
  /** Producto → su etiqueta. */
  items: ReadonlyMap<string, SlotInfo>
  /** Producto → el camino de su categoría («Comida › Hamburguesas»). */
  itemPaths: ReadonlyMap<string, string>
  /** Categoría → el camino de las de arriba («Comida»); vacío en las de arriba de todo. */
  categoryPaths: ReadonlyMap<string, string>
}

function inOrder(stations: ReadonlyArray<KitchenStation>, ids: Iterable<string>): KitchenStation[] {
  const wanted = new Set(ids)
  return [...stations]
    .filter((station) => wanted.has(station.id))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'))
}

/** Arma la etiqueta de cada categoría y de cada producto, una sola vez por lectura. */
export function buildRouteModel(
  tree: CartaTree,
  stats: RoutingStats,
  stations: ReadonlyArray<KitchenStation>,
): RouteModel {
  const byId = new Map(stations.map((station) => [station.id, station]))
  const stationOf = (id: string | null) => (id === null ? null : (byId.get(id) ?? null))
  const nameOf = (id: string | null) => (id === null ? null : (tree.byId.get(id)?.name ?? null))
  const stationName = (id: string) => byId.get(id)?.name ?? 'otra estación'

  const categories = new Map<string, CategoryView>()
  const categoryPaths = new Map<string, string>()
  for (const id of tree.order) {
    const category = tree.byId.get(id)
    if (!category) continue
    const resolution = resolveCategory(tree, id)
    const station = stationOf(resolution.stationId)
    const inherited = inheritedByCategory(tree, id)
    const parent = tree.parent.get(id) ?? null
    const branch = stats.branches.get(id) ?? EMPTY_BRANCH
    const missing = station === null
    categories.set(id, {
      id,
      name: category.name,
      depth: ancestorsOf(tree, id).length,
      active: category.active,
      branch,
      rule: station ? ruleSentence(station.name, exceptionsOf(tree, id), stationName) : null,
      hasInside: (tree.items.get(id)?.length ?? 0) + (tree.children.get(id)?.length ?? 0) > 0,
      slot: {
        node: 'category',
        id,
        name: category.name,
        source: missing ? 'none' : resolution.source,
        ownId: category.stationId,
        station,
        fromName: nameOf(resolution.fromId),
        fallback: {
          station: stationOf(inherited.stationId),
          fromName: nameOf(inherited.fromId) ?? nameOf(parent),
        },
        warn: missing && branch.unrouted > 0,
        mixed:
          missing && branch.unrouted === 0 && branch.products > 0
            ? inOrder(stations, branch.stations.keys())
            : null,
      },
    })
    categoryPaths.set(id, parent === null ? '' : pathLabel(tree, parent))
  }

  const items = new Map<string, SlotInfo>()
  const itemPaths = new Map<string, string>()
  for (const [categoryId, list] of tree.items) {
    const path = categoryId === NO_CATEGORY_ID ? NO_CATEGORY_NAME : pathLabel(tree, categoryId)
    for (const item of list) {
      const resolution = stats.routes.get(item.id)?.resolution
      const station = stationOf(resolution?.stationId ?? null)
      const inherited = inheritedByItem(tree, item)
      items.set(item.id, {
        node: 'item',
        id: item.id,
        name: item.name,
        source: station === null ? 'none' : (resolution?.source ?? 'none'),
        ownId: item.stationId,
        station,
        fromName: nameOf(resolution?.fromId ?? null),
        fallback: {
          station: stationOf(inherited.stationId),
          fromName:
            nameOf(inherited.fromId) ?? (categoryId === NO_CATEGORY_ID ? null : nameOf(categoryId)),
        },
        warn: station === null,
        mixed: null,
      })
      itemPaths.set(item.id, path)
    }
  }
  return { categories, items, itemPaths, categoryPaths }
}

// ─── El titular ──────────────────────────────────────────────────────────────

export type RouteHeadline = {
  /** `ok` = todo tiene estación · `warn` = hay para revisar · `empty` = no hay productos. */
  tone: 'ok' | 'warn' | 'empty'
  /** El número grande. */
  figure: number
  /** Lo que sigue al número, en la misma oración. */
  lead: string
  /** Una oración más, que lo explica. */
  detail: string | null
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** «130 salen en Cocina, 27 en Fríos y 76 en Barra.» */
export function stationBreakdown(
  stats: RoutingStats,
  stations: ReadonlyArray<KitchenStation>,
): string | null {
  const parts = inOrder(stations, stats.byStation.keys()).map((station) => ({
    name: station.name,
    count: stats.byStation.get(station.id) ?? 0,
  }))
  const [first, ...rest] = parts
  if (!first) return null
  if (rest.length === 0) {
    return first.count === stats.total
      ? `${plural(first.count, 'Sale', 'Todos salen')} en ${first.name}.`
      : `${first.count} ${plural(first.count, 'sale', 'salen')} en ${first.name}.`
  }
  const head = `${first.count} ${plural(first.count, 'sale', 'salen')} en ${first.name}`
  const tail = rest.map((part) => `${part.count} en ${part.name}`)
  const last = tail.pop() ?? ''
  return `${[head, ...tail].join(', ')} y ${last}.`
}

/** El número de la pantalla y su oración: lo que hay que mirar primero. */
export function routeHeadline(
  stats: RoutingStats,
  stations: ReadonlyArray<KitchenStation>,
): RouteHeadline {
  if (stats.total === 0) {
    return {
      tone: 'empty',
      figure: 0,
      lead: 'productos en la carta.',
      detail: 'Cuando la cargues, acá vas a ver a qué estación va cada cosa.',
    }
  }
  const { unrouted, inactive, total } = stats
  const problems = unrouted + inactive
  if (problems === 0) {
    return {
      tone: 'ok',
      figure: total,
      lead: plural(total, 'producto, con su estación.', 'productos, cada uno con su estación.'),
      detail: stationBreakdown(stats, stations),
    }
  }
  const rest = total - problems
  const others =
    rest > 0
      ? ` ${plural(rest, 'El otro ya tiene la suya.', `Los otros ${rest} ya tienen la suya.`)}`
      : ''
  if (inactive === 0) {
    return {
      tone: 'warn',
      figure: unrouted,
      lead: plural(unrouted, 'producto sin estación.', 'productos sin estación.'),
      detail: `Hasta que ${plural(unrouted, 'le', 'les')} pongas una, ${plural(unrouted, 'sale', 'salen')} en todas las pantallas de la cocina.${others}`,
    }
  }
  const off = inOrder(
    stations.filter((station) => !station.active),
    stats.byStation.keys(),
  ).map((station) => station.name)
  const offNames = namesSummary(off, 2)
  if (unrouted === 0) {
    return {
      tone: 'warn',
      figure: inactive,
      lead: plural(
        inactive,
        'producto en una estación apagada.',
        'productos en una estación apagada.',
      ),
      detail: `${offNames} ${plural(off.length, 'está apagada', 'están apagadas')}: una pantalla que elige estaciones no ${plural(inactive, 'lo', 'los')} muestra. Prendela o pasalos a otra.`,
    }
  }
  return {
    tone: 'warn',
    figure: problems,
    lead: 'productos para revisar.',
    detail: `${unrouted} sin estación (${plural(unrouted, 'sale', 'salen')} en todas las pantallas) y ${inactive} en ${offNames}, que ${plural(off.length, 'está apagada', 'están apagadas')}.`,
  }
}

// ─── La barra de reparto ─────────────────────────────────────────────────────

export type BarPart = {
  key: string
  /** `station` = una estación prendida · `off` = una apagada · `problem` = sin estación. */
  kind: 'station' | 'off' | 'problem'
  name: string
  /** El color de la estación; vacío en «sin estación». */
  color: string | null
  count: number
  /** De 0 a 100, redondeado. */
  share: number
}

/** La carta, cortada por estación: una parte por cada una que recibe algo, y lo que no tiene. */
export function barParts(stats: RoutingStats, stations: ReadonlyArray<KitchenStation>): BarPart[] {
  if (stats.total === 0) return []
  const share = (count: number) => Math.round((count / stats.total) * 100)
  const parts: BarPart[] = inOrder(stations, stats.byStation.keys()).map((station) => {
    const count = stats.byStation.get(station.id) ?? 0
    return {
      key: station.id,
      kind: station.active ? 'station' : 'off',
      name: station.name,
      color: station.color,
      count,
      share: share(count),
    }
  })
  if (stats.unrouted > 0) {
    parts.push({
      key: 'sin-estacion',
      kind: 'problem',
      name: 'Sin estación',
      color: null,
      count: stats.unrouted,
      share: share(stats.unrouted),
    })
  }
  return parts
}

/**
 * Qué le manda productos a una estación: las categorías de arriba de todo, de la que más manda
 * a la que menos. Es lo que esa pantalla de la cocina va a ver salir.
 */
export function stationFeeds(tree: CartaTree, stats: RoutingStats, stationId: string): string[] {
  const feeds: Array<{ name: string; count: number; order: number }> = []
  const roots = [...(tree.children.get(null) ?? []), NO_CATEGORY_ID]
  for (const [order, id] of roots.entries()) {
    const count = stats.branches.get(id)?.stations.get(stationId) ?? 0
    if (count === 0) continue
    const name = id === NO_CATEGORY_ID ? NO_CATEGORY_NAME : (tree.byId.get(id)?.name ?? '')
    // Dos categorías de arriba con el mismo nombre se cuentan juntas.
    const same = feeds.find((feed) => feed.name === name)
    if (same) same.count += count
    else feeds.push({ name, count, order })
  }
  return feeds.sort((a, b) => b.count - a.count || a.order - b.order).map((feed) => feed.name)
}

/** «Comida › Hamburguesas» partido para mostrar lo de arriba en gris y lo último en negrita. */
export function splitPath(path: string): { above: string; last: string } {
  const at = path.lastIndexOf(PATH_SEPARATOR)
  return at === -1
    ? { above: '', last: path }
    : { above: path.slice(0, at), last: path.slice(at + PATH_SEPARATOR.length) }
}
