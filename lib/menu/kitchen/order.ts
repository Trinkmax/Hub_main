/**
 * Ordenar una lista (estaciones, grupos, opciones), puro. El orden se guarda como la posición de
 * cada fila; acá se arma la lista nueva y se calcula qué filas hay que escribir.
 */

/** Mueve lo que está en `from` al lugar `to`. Fuera de rango, devuelve la lista como estaba. */
export function moveTo<T>(list: ReadonlyArray<T>, from: number, to: number): T[] {
  const out = [...list]
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out
  const [moved] = out.splice(from, 1)
  if (moved === undefined) return out
  out.splice(to, 0, moved)
  return out
}

/** Sube (`-1`) o baja (`+1`) un elemento un lugar. En el borde no hace nada. */
export function moveBy(list: ReadonlyArray<string>, id: string, delta: -1 | 1): string[] {
  const from = list.indexOf(id)
  return from === -1 ? [...list] : moveTo(list, from, from + delta)
}

/** ¿Dos listas tienen lo mismo en el mismo orden? */
export function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export type PositionWrite = { id: string; position: number }

/**
 * Las filas que hay que escribir para que queden en el orden pedido: cada una en el lugar que
 * ocupa en `ids`. Las que ya están en su lugar no se tocan; las que no están en `current` (se
 * borraron mientras tanto) se saltean sin dejar hueco.
 */
export function positionWrites(
  current: ReadonlyArray<{ id: string; position: number }>,
  ids: ReadonlyArray<string>,
): PositionWrite[] {
  const now = new Map(current.map((row) => [row.id, row.position]))
  const writes: PositionWrite[] = []
  let position = 0
  for (const id of ids) {
    const was = now.get(id)
    if (was === undefined) continue
    if (was !== position) writes.push({ id, position })
    position += 1
  }
  return writes
}

/**
 * ¿La persona estaba mirando la lista que hay ahora en la base? Tienen que ser las mismas filas
 * en el mismo orden: si otra persona sumó, sacó o reordenó, no se pisa.
 */
export function orderIsCurrent(
  current: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
): boolean {
  return sameOrder(current, expected)
}
