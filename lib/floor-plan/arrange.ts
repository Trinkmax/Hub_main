/**
 * Acomodar el plano — PURO y testeado (`tests/lib/floor-plan-arrange.test.ts`).
 *
 * Lo que el editor decide solo, para que nadie tenga que corregirlo a mano:
 *
 * - **Dónde cae algo nuevo** (`findFreeSpot`): nunca encima de otra cosa. Antes, «Agregar mesa» y
 *   «Ubicar» la apoyaban siempre en el centro del sector, aunque ahí ya hubiera una.
 * - **Dónde conviene una mesa nueva** (`rowContinuation`): a continuación de la última, siguiendo su
 *   fila. Tocar «Mesa» varias veces arma una fila prolija en vez de meterlas en los huecos.
 * - **Sobre qué mesa se está por soltar otra** (`mergeTargetAt`): arrastrar una mesa encima de otra es
 *   el gesto de juntarlas.
 * - **Cómo queda la que absorbe a la otra** (`mergedTable`): con los lugares de las dos y más larga,
 *   sin moverse de donde estaba.
 */

import { clampToArea, GRID, snapToGrid } from './grid'

export type Box = { x: number; y: number; width: number; height: number }
export type Turned = Box & { rotation: number }

/** Lugares de una mesa que todavía no tiene el dato (lo mismo que dibuja el salón). */
const DEFAULT_SEATS = 4
/** Aire alrededor de una mesa para sus sillas: dos mesas más cerca que esto se pisan las sillas. */
export const SEAT_GAP = 24
/** Tope de lugares de una mesa: el mismo que aceptan la ficha y la base (`lib/floor-plan/schemas.ts`). */
const MAX_SEATS = 50

/** La caja recta que contiene a un elemento girado. */
export function turnedBounds(el: Turned): Box {
  const a = (el.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(a))
  const sin = Math.abs(Math.sin(a))
  const width = el.width * cos + el.height * sin
  const height = el.width * sin + el.height * cos
  return {
    x: el.x + el.width / 2 - width / 2,
    y: el.y + el.height / 2 - height / 2,
    width,
    height,
  }
}

/** ¿Se pisan dos cajas, pidiendo `gap` de aire entre ellas? Tocarse justo en el borde no es pisarse. */
export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  )
}

/**
 * Dónde apoyar algo de `width` × `height` sin pisar lo que ya está. Prueba primero `preferred` (donde
 * la persona está mirando) y, si está ocupado, va dando vueltas cada vez más lejos, de a un cuadro de la
 * cuadrícula, hasta encontrar un lugar libre adentro del piso. Si el piso está lleno devuelve
 * `preferred`: es mejor una mesa encimada que una mesa que no aparece.
 *
 * `preferred` y lo que devuelve son la esquina de arriba a la izquierda.
 */
export function findFreeSpot(input: {
  area: { width: number; height: number }
  others: readonly Box[]
  width: number
  height: number
  preferred: { x: number; y: number }
  /** Aire que se le pide alrededor (para las sillas). */
  gap?: number
  /** De a cuánto se corre en cada intento. */
  step?: number
}): { x: number; y: number } {
  const { area, others, width, height } = input
  const gap = input.gap ?? SEAT_GAP
  const step = Math.max(GRID, input.step ?? GRID * 2)
  const place = (x: number, y: number) =>
    clampToArea(snapToGrid(x), snapToGrid(y), width, height, area.width, area.height)
  const first = place(input.preferred.x, input.preferred.y)
  const isFree = (spot: { x: number; y: number }) =>
    !others.some((other) => overlaps({ x: spot.x, y: spot.y, width, height }, other, gap))
  if (isFree(first)) return first

  const rings = Math.ceil(Math.max(area.width, area.height) / step)
  const tried = new Set<string>([`${first.x}:${first.y}`])
  for (let ring = 1; ring <= rings; ring++) {
    // Los puntos del anillo, del más cercano al más lejano (y, a igual distancia, primero a la
    // derecha y abajo: es hacia donde se lee).
    const points: Array<{ dx: number; dy: number }> = []
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) points.push({ dx, dy })
      }
    }
    points.sort(
      (p, q) =>
        p.dx * p.dx + p.dy * p.dy - (q.dx * q.dx + q.dy * q.dy) || q.dx - p.dx || q.dy - p.dy,
    )
    for (const { dx, dy } of points) {
      const spot = place(first.x + dx * step, first.y + dy * step)
      const key = `${spot.x}:${spot.y}`
      if (tried.has(key)) continue
      tried.add(key)
      if (isFree(spot)) return spot
    }
  }
  return first
}

/** Separación entre dos mesas de una fila cuando no hay otra de dónde copiarla. */
const ROW_SPACING = GRID * 3
/** Lo más juntas y lo más separadas que se continúa una fila. */
const ROW_SPACING_MIN = GRID * 2
const ROW_SPACING_MAX = GRID * 8

/**
 * Dónde conviene apoyar una mesa nueva para que quede prolija: a continuación de la última (la de más
 * abajo y, en esa fila, la de más a la derecha), alineada con ella y con la misma separación que ya
 * traía la fila. Si no entra a lo ancho, empieza una fila nueva debajo de todo, alineada con la primera
 * columna. Así, tocar «Mesa» cinco veces deja cinco mesas en fila, no cinco mesas en los huecos.
 *
 * Devuelve la esquina de arriba a la izquierda, sin mirar si ahí hay algo: eso lo resuelve
 * `findFreeSpot` (esta es su `preferred`). `null` si no hay mesas de dónde seguir o si el piso ya no
 * tiene lugar hacia abajo: quien llama decide (el centro de lo que se está mirando).
 */
export function rowContinuation(input: {
  area: { width: number; height: number }
  /** Las mesas del sector (ya como cajas rectas), incluidas las que se están creando. */
  tables: readonly Box[]
  width: number
  height: number
}): { x: number; y: number } | null {
  const { area, tables, width, height } = input
  if (tables.length === 0) return null
  const centerY = (box: Box) => box.y + box.height / 2
  const lowest = Math.max(...tables.map(centerY))
  // La fila de más abajo: las que están a la altura de la más baja (media mesa de tolerancia).
  const row = tables.filter((box) => lowest - centerY(box) <= GRID * 2)
  const anchor = row.reduce((last, box) => (box.x + box.width > last.x + last.width ? box : last))
  // La separación de la fila: la que hay entre la última y la anterior.
  const before = row
    .filter((box) => box !== anchor && box.x + box.width <= anchor.x)
    .reduce<Box | null>(
      (near, box) => (near === null || box.x + box.width > near.x + near.width ? box : near),
      null,
    )
  const spacing = before
    ? Math.min(ROW_SPACING_MAX, Math.max(ROW_SPACING_MIN, anchor.x - (before.x + before.width)))
    : ROW_SPACING

  const x = snapToGrid(anchor.x + anchor.width + spacing)
  const y = snapToGrid(centerY(anchor) - height / 2)
  if (x + width <= area.width && y >= 0 && y + height <= area.height) return { x, y }

  // No entra en la fila: una fila nueva debajo de todo, desde la primera columna.
  const left = Math.min(...tables.map((box) => box.x))
  const bottom = Math.max(...tables.map((box) => box.y + box.height))
  const below = snapToGrid(bottom + Math.max(spacing, ROW_SPACING))
  if (below + height > area.height) return null
  return { x: snapToGrid(Math.max(0, Math.min(left, area.width - width))), y: below }
}

export type MergeCandidate = Turned & { id: string; shape: 'rect' | 'circle' | 'banquette' }

/**
 * La mesa sobre la que se soltaría la que se arrastra: la que tiene adentro su centro (mirándola
 * derecha, aunque esté girada; en una redonda, adentro del círculo). `null` si el centro está en el
 * piso. Acercar dos mesas no las junta: hay que apoyar una encima de la otra.
 */
export function mergeTargetAt(
  center: { x: number; y: number },
  tables: readonly MergeCandidate[],
  draggedId: string,
): string | null {
  // De adelante para atrás: si dos se pisan, gana la que se ve arriba.
  for (let i = tables.length - 1; i >= 0; i--) {
    const table = tables[i]
    if (!table || table.id === draggedId) continue
    const cx = table.x + table.width / 2
    const cy = table.y + table.height / 2
    const a = (-table.rotation * Math.PI) / 180
    const dx = center.x - cx
    const dy = center.y - cy
    const lx = dx * Math.cos(a) - dy * Math.sin(a)
    const ly = dx * Math.sin(a) + dy * Math.cos(a)
    const rx = table.width / 2
    const ry = table.height / 2
    const inside =
      table.shape === 'circle'
        ? rx > 0 && ry > 0 && (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1
        : Math.abs(lx) <= rx && Math.abs(ly) <= ry
    if (inside) return table.id
  }
  return null
}

export type TableBody = Box & {
  shape: 'rect' | 'circle' | 'banquette'
  /** `null` = sin el dato cargado (cuenta como una de cuatro). */
  capacity: number | null
}

/**
 * La mesa que queda después de juntar dos: suma los lugares y se alarga para que entren, sin moverse
 * de su centro (y sin salirse del piso). Una rectangular crece por su lado largo lo que mide el lado
 * largo de la otra (dos de 80 dan una de 160 × 80); una redonda crece en superficie.
 */
export function mergedTable(
  survivor: TableBody,
  absorbed: TableBody,
  area: { width: number; height: number },
): Box & { capacity: number } {
  const capacity = Math.min(
    MAX_SEATS,
    (survivor.capacity ?? DEFAULT_SEATS) + (absorbed.capacity ?? DEFAULT_SEATS),
  )
  let width = survivor.width
  let height = survivor.height
  if (survivor.shape === 'circle') {
    const side = snapToGrid(
      Math.sqrt(survivor.width * survivor.height + absorbed.width * absorbed.height),
    )
    width = Math.max(survivor.width, side)
    height = Math.max(survivor.height, side)
  } else {
    const extra = Math.max(absorbed.width, absorbed.height)
    const thick = Math.min(absorbed.width, absorbed.height)
    if (survivor.width >= survivor.height) {
      width = survivor.width + extra
      height = Math.max(survivor.height, thick)
    } else {
      height = survivor.height + extra
      width = Math.max(survivor.width, thick)
    }
  }
  width = Math.min(snapToGrid(width), Math.max(GRID, area.width))
  height = Math.min(snapToGrid(height), Math.max(GRID, area.height))
  const spot = clampToArea(
    snapToGrid(survivor.x + survivor.width / 2 - width / 2),
    snapToGrid(survivor.y + survivor.height / 2 - height / 2),
    width,
    height,
    area.width,
    area.height,
  )
  return { x: spot.x, y: spot.y, width, height, capacity }
}
