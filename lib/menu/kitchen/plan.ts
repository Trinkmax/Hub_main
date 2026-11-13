/**
 * Qué se escribe y qué no cuando llega un pedido de cambio, puro. El servidor lee lo que hay
 * AHORA en la base y con eso decide, cosa por cosa:
 *
 * - si ya no está → no se cambia (`missing`);
 * - si ya vale lo que se pidió → no hay nada que escribir;
 * - si vale otra cosa que la que la persona estaba viendo → no se pisa (`changed`): dos socios
 *   acomodando la carta a la vez no se borran el trabajo sin enterarse;
 * - si no, se escribe.
 *
 * Las estaciones se agrupan por «de cuál a cuál»: marcar una carta entera se escribe en unas
 * pocas idas a la base, no en una por producto.
 */

import type { RouteChange, RouteFailure } from './types'

export type RequestedRoute = RouteChange & {
  /** La estación propia que la persona veía ahí. `null` = no tenía. */
  expected: string | null
}

export type CurrentRoutes = {
  /** Categoría → su estación propia. Lo que no está acá no existe (o es de otro bar). */
  categories: ReadonlyMap<string, string | null>
  items: ReadonlyMap<string, string | null>
  /** Las estaciones que existen en el bar. */
  stations: ReadonlySet<string>
}

export type RouteWrite = {
  node: RouteChange['node']
  expected: string | null
  to: string | null
  ids: string[]
}

export type RoutePlan = {
  writes: RouteWrite[]
  failed: RouteFailure[]
}

export function planRouteWrites(
  requested: ReadonlyArray<RequestedRoute>,
  current: CurrentRoutes,
): RoutePlan {
  const groups = new Map<string, RouteWrite>()
  const failed: RouteFailure[] = []

  for (const change of requested) {
    const { node, id, to, expected } = change
    const now = (node === 'category' ? current.categories : current.items).get(id)
    if (now === undefined) {
      failed.push({ node, id, reason: 'missing' })
      continue
    }
    if (now === to) continue
    if (to !== null && !current.stations.has(to)) {
      failed.push({ node, id, reason: 'station_gone' })
      continue
    }
    if (now !== expected) {
      failed.push({ node, id, reason: 'changed', current: now })
      continue
    }
    const key = `${node}|${expected ?? ''}|${to ?? ''}`
    const group = groups.get(key)
    if (group) group.ids.push(id)
    else groups.set(key, { node, expected, to, ids: [id] })
  }

  return { writes: [...groups.values()], failed }
}

/** Un campo que cambia: lo que la persona veía y lo que tiene que quedar. */
export type FieldChange<Value> = { from: Value; to: Value }

export type PatchPlan<Row> =
  /** Ya estaba todo así. */
  | { kind: 'noop' }
  /** Algún campo no vale lo que la persona veía: no se escribe ninguno. */
  | { kind: 'changed'; fields: Array<keyof Row> }
  /** Lo que hay que escribir, y con qué valores tiene que seguir la fila para que entre. */
  | { kind: 'write'; set: Partial<Row>; expect: Partial<Row> }

/**
 * Decide un cambio de varios campos de una fila. Es todo o nada: si un campo lo cambió otra
 * persona, no se escribe ninguno y se avisa.
 */
export function planPatch<Row extends object>(
  current: Row,
  patch: { [Key in keyof Row]?: FieldChange<Row[Key]> },
): PatchPlan<Row> {
  const set: Partial<Row> = {}
  const expect: Partial<Row> = {}
  const conflicts: Array<keyof Row> = []
  let writes = 0
  for (const key of Object.keys(patch) as Array<keyof Row>) {
    const change = patch[key]
    if (!change) continue
    const now = current[key]
    if (now === change.to) continue
    if (now !== change.from) {
      conflicts.push(key)
      continue
    }
    set[key] = change.to
    expect[key] = change.from
    writes += 1
  }
  if (conflicts.length > 0) return { kind: 'changed', fields: conflicts }
  if (writes === 0) return { kind: 'noop' }
  return { kind: 'write', set, expect }
}

/** Parte una lista en tandas de a lo sumo `size`. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size))
  }
  return out
}

/** Corre tareas de a `limit` por vez y devuelve los resultados en el orden de entrada. */
export async function runLimited<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
