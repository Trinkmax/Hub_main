/**
 * La maqueta de un sector — PURA y testeada.
 *
 * Convierte los elementos del plano (mesas, paredes, barra…) en volúmenes ya
 * proyectados y ordenados de atrás para adelante, listos para dibujar. No sabe
 * de colores ni de estados: eso lo decide quien dibuja. Con la cámara cenital
 * devuelve el plano de siempre (los volúmenes no tienen caras laterales).
 *
 * EL ORDEN. Cada cosa suelta apoyada en el piso (una mesa, cada silla, cada
 * banqueta, la barra, un tramo de pared) es una «pieza». Dos piezas solo se
 * pueden tapar si caen en la misma columna de pantalla, y ahí va adelante la que
 * está más cerca de quien mira: eso se pregunta de a pares (`comparePieces`) y
 * con las respuestas se arma el orden (`paintOrder`). Ordenar por un solo punto
 * de cada pieza, que es lo que se hacía, falla con todo lo largo: en una barra,
 * las banquetas pasaban atrás a partir de la cuarta.
 */
import { computeBarStools, computeChairs } from '@/lib/floor-plan/chairs'
import type { FloorElement } from '@/lib/pos/types'
import {
  type Bounds,
  boundsOf,
  type Camera,
  convexHull,
  depthOf,
  ellipseFootprint,
  extrude,
  fitBounds,
  floorView,
  lift,
  mergeBounds,
  polygonPath,
  project,
  rectFootprint,
  splitLongRect,
  turned,
  type Vec2,
} from './projection'

/** Alturas, en las mismas unidades del plano (una mesa de 4 mide ~80 de lado). */
export const HEIGHTS = {
  tableTop: 30,
  tableSlab: 5,
  chairSeat: 13,
  chairBack: 27,
  stool: 18,
  wall: 44,
  pillar: 58,
  bar: 36,
  island: 32,
  stage: 9,
  booth: 22,
  pawnBody: 30,
  pawnHead: 39,
} as const

export type SolidRole =
  | 'floor'
  | 'pedestal'
  | 'tabletop'
  | 'chair'
  | 'chairback'
  | 'stool'
  | 'wall'
  | 'pillar'
  | 'bar'
  | 'island'
  | 'stage'
  | 'booth'
  | 'pawn'

export type Solid = {
  key: string
  role: SolidRole
  /** La mesa a la que pertenece (tapa, pata, sillas y comensales). */
  tableId: string | null
  /** Tapa: cadena `d` de SVG. */
  top: string
  /** Caras laterales agrupadas por cuánta luz reciben: 0 = sombra, 1 = media, 2 = luz. */
  sides: [string, string, string]
  /** Su lugar en el orden de pintado: 0 es lo primero que se dibuja (lo del fondo). */
  depth: number
  /** Solo comensales: centro y radio de la cabeza, en pantalla. */
  head?: { x: number; y: number; r: number }
  /** Sombra que proyecta sobre el piso (los volúmenes grandes). */
  shadow?: string
}

export type TableAnchor = {
  tableId: string
  elementId: string
  label: string
  capacity: number | null
  /** Centro de la tapa en pantalla. */
  x: number
  y: number
  /** El punto más alto de la mesa en pantalla: de ahí sale la bandera. */
  topY: number
  /** Ancho de la tapa en pantalla (sin escala): cuánto lugar tiene el número. */
  topWidth: number
  /** Caja de la mesa con sus sillas, para la zona de toque. */
  bounds: Bounds
  /** El lugar de su tapa en el orden de pintado: cuanto mayor, más adelante (para apilar lo que flota). */
  depth: number
  /** Sillas dibujadas (para saber cuántos comensales entran sentados). */
  seats: number
}

export type FloorDecal = {
  key: string
  kind: 'door' | 'text'
  /** Centro sobre el piso, ya proyectado. */
  x: number
  y: number
  label: string | null
  /** Ancho y alto sobre el piso (sin proyectar), y rotación en grados. */
  w: number
  h: number
  rotation: number
}

export type Scene = {
  solids: Solid[]
  anchors: TableAnchor[]
  decals: FloorDecal[]
  /** Contorno del piso del sector (la losa sobre la que va todo). */
  floor: { top: string; sides: [string, string, string] }
  bounds: Bounds
}

export type SceneOptions = {
  /** Sillas y comensales: se apagan cuando la maqueta se ve muy chica. */
  chairs?: boolean
  /** Comensales sentados por mesa (id de mesa → cuántos). */
  occupancy?: Readonly<Record<string, number>>
}

const NO_SIDES: [string, string, string] = ['', '', '']

function bucketSides(
  faces: readonly { points: Vec2[]; light: number }[],
): [string, string, string] {
  const out: [string, string, string] = ['', '', '']
  for (const face of faces) {
    const bucket = face.light > 0.62 ? 2 : face.light > 0.28 ? 1 : 0
    out[bucket] += polygonPath(face.points)
  }
  return out
}

function solidFrom(
  camera: Camera,
  key: string,
  role: SolidRole,
  tableId: string | null,
  footprint: readonly Vec2[],
  z0: number,
  z1: number,
): { solid: Solid; bounds: Bounds } {
  const prism = extrude(camera, footprint, z0, z1)
  return {
    solid: {
      key,
      role,
      tableId,
      top: polygonPath(prism.top),
      sides: bucketSides(prism.sides),
      // El orden de pintado lo pone `layoutScene` al final.
      depth: 0,
    },
    bounds: prism.bounds,
  }
}

/** Sombra sobre el piso: la huella y su corrimiento hacia donde no da la luz. */
function shadowOf(camera: Camera, footprint: readonly Vec2[], height: number): string {
  const dx = height * 0.42
  const dy = height * 0.3
  const cast = footprint.flatMap((p) => [
    project(camera, p.x, p.y, 0),
    project(camera, p.x + dx, p.y + dy, 0),
  ])
  return polygonPath(convexHull(cast))
}

/** Elige qué sillas ocupar para que la gente quede repartida y no toda de un lado. */
export function occupiedSeats(seats: number, people: number): Set<number> {
  const taken = new Set<number>()
  if (seats <= 0 || people <= 0) return taken
  const n = Math.min(seats, people)
  for (let i = 0; i < n; i++) {
    let index = Math.floor((i * seats) / n)
    while (taken.has(index)) index = (index + 1) % seats
    taken.add(index)
  }
  return taken
}

function rotateAround(cx: number, cy: number, x: number, y: number, deg: number): Vec2 {
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

// ─── El orden de pintado ────────────────────────────────────────────────────

/** Una cosa suelta apoyada en el piso: lo que se ordena contra las demás. */
type Piece = {
  key: string
  /** Su huella en el piso ya girado (`floorView`): columna de pantalla y profundidad. */
  poly: Vec2[]
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Hasta dónde sube. Solo cuenta cuando dos huellas se pisan: decide cuál hace de piso de la otra. */
  height: number
  /** Sus volúmenes, ya en el orden en que se dibujan entre ellos (la pata antes que la tapa). */
  parts: Solid[]
}

type PieceShape = Pick<Piece, 'poly' | 'minX' | 'maxX' | 'minY' | 'maxY' | 'height'>

/** Lo que dos piezas tienen que compartir (en unidades del piso) para que valga la pena compararlas. */
const TOUCH = 0.01

/** De dónde a dónde llega una huella sobre la columna `x`, hacia quien mira. `null` si no la cruza. */
function spanAt(poly: readonly Vec2[], x: number): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    if (!p || !q) continue
    if ((p.x - x) * (q.x - x) > 0) continue
    if (Math.abs(q.x - p.x) < 1e-9) {
      lo = Math.min(lo, p.y, q.y)
      hi = Math.max(hi, p.y, q.y)
      continue
    }
    const y = p.y + ((x - p.x) / (q.x - p.x)) * (q.y - p.y)
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  return hi >= lo ? [lo, hi] : null
}

/**
 * ¿Quién va primero? −1: `a` se dibuja antes que `b` (queda detrás); 1: al revés; 0: no se tapan.
 *
 * La pantalla no mueve nada de costado al subirlo, así que dos piezas que no comparten columna no se
 * pueden tapar. Si la comparten, alcanza con mirar una sola (la del medio de lo que comparten): dos
 * huellas convexas que no se pisan guardan el mismo orden en todas.
 */
export function comparePieces(a: PieceShape, b: PieceShape): -1 | 0 | 1 {
  const lo = Math.max(a.minX, b.minX)
  const hi = Math.min(a.maxX, b.maxX)
  if (hi - lo <= TOUCH) return 0
  if (a.maxY <= b.minY + TOUCH) return -1
  if (b.maxY <= a.minY + TOUCH) return 1
  const x = (lo + hi) / 2
  const sa = spanAt(a.poly, x)
  const sb = spanAt(b.poly, x)
  if (!sa || !sb) return 0
  if (sa[1] <= sb[0] + TOUCH) return -1
  if (sb[1] <= sa[0] + TOUCH) return 1
  // Las huellas se pisan: ya no hay una respuesta exacta, hay que elegir la que mejor se ve.
  const aInside = sa[0] >= sb[0] - TOUCH && sa[1] <= sb[1] + TOUCH
  const bInside = sb[0] >= sa[0] - TOUCH && sb[1] <= sa[1] + TOUCH
  if (aInside !== bInside) {
    // Una queda adentro de la otra. Si es más alta, está apoyada encima o la atraviesa (una mesa sobre
    // el escenario, una columna en medio de una pared) y se dibuja después; si es más baja, quedó
    // tapada adentro y va antes.
    const inner = aInside ? a : b
    const outer = aInside ? b : a
    if (Math.abs(inner.height - outer.height) > TOUCH) {
      const innerLast = inner.height > outer.height
      return aInside === innerLast ? 1 : -1
    }
    // Igual de altas (dos paredes que se encuentran en una esquina): adelante la que llega más cerca.
    return a.maxY < b.maxY ? -1 : a.maxY > b.maxY ? 1 : 0
  }
  // Se pisan a medias (una silla contra la pared): adelante la que está más cerca.
  const ca = sa[0] + sa[1]
  const cb = sb[0] + sb[1]
  return ca < cb ? -1 : ca > cb ? 1 : 0
}

/**
 * Las piezas, de atrás para adelante. Arranca del orden de siempre (por el punto más cercano de cada
 * una, que entre piezas que no se tapan da lo mismo) y lo corrige con lo que dice `comparePieces`: nadie
 * se dibuja antes que algo que tiene detrás. Si dos huellas pisadas arman un círculo vicioso, se corta
 * por la del fondo.
 */
function paintOrder(pieces: readonly Piece[]): Piece[] {
  const sorted = [...pieces].sort((a, b) => a.maxY - b.maxY || a.key.localeCompare(b.key))
  const n = sorted.length
  if (n < 2) return sorted
  const inFront: number[][] = sorted.map(() => [])
  const behind = new Array<number>(n).fill(0)
  // Recorridas de izquierda a derecha, cada una se compara solo con las que arrancan antes de que ella
  // termine: el resto no comparte columna y no hay nada que preguntar.
  const byColumn = sorted
    .map((_, index) => index)
    .sort((i, j) => (sorted[i]?.minX ?? 0) - (sorted[j]?.minX ?? 0))
  for (let u = 0; u < n; u++) {
    const i = byColumn[u] ?? -1
    const a = sorted[i]
    if (!a) continue
    for (let v = u + 1; v < n; v++) {
      const j = byColumn[v] ?? -1
      const b = sorted[j]
      if (!b) continue
      if (b.minX >= a.maxX - TOUCH) break
      const order = comparePieces(a, b)
      if (order < 0) {
        inFront[i]?.push(j)
        behind[j] = (behind[j] ?? 0) + 1
      } else if (order > 0) {
        inFront[j]?.push(i)
        behind[i] = (behind[i] ?? 0) + 1
      }
    }
  }
  const out: Piece[] = []
  const done = new Array<boolean>(n).fill(false)
  for (let step = 0; step < n; step++) {
    let pick = -1
    for (let i = 0; i < n; i++) {
      if (!done[i] && behind[i] === 0) {
        pick = i
        break
      }
    }
    if (pick < 0) pick = done.indexOf(false)
    const piece = sorted[pick]
    if (!piece) break
    done[pick] = true
    out.push(piece)
    for (const j of inFront[pick] ?? []) behind[j] = (behind[j] ?? 1) - 1
  }
  return out
}

/** Arma la maqueta de los elementos de UN sector. */
export function buildScene(
  camera: Camera,
  elements: readonly FloorElement[],
  options: SceneOptions = {},
): Scene {
  return layoutScene(camera, elements, options, true)
}

/** `ordered = false` saltea el orden de pintado: para quien solo quiere saber cuánto ocupa. */
function layoutScene(
  camera: Camera,
  elements: readonly FloorElement[],
  options: SceneOptions,
  ordered: boolean,
): Scene {
  const withChairs = options.chairs ?? true
  const occupancy = options.occupancy ?? {}
  const pieces: Piece[] = []
  const anchors: TableAnchor[] = []
  const decals: FloorDecal[] = []
  let bounds: Bounds | null = null
  let plan: Bounds | null = null

  /** Anota lo que ocupa un volumen en pantalla y lo devuelve para armar su pieza. */
  const track = (entry: { solid: Solid; bounds: Bounds }): Solid => {
    bounds = bounds ? mergeBounds(bounds, entry.bounds) : entry.bounds
    return entry.solid
  }
  const piece = (key: string, footprint: readonly Vec2[], height: number, parts: Solid[]) => {
    const poly = floorView(camera, footprint)
    const box = boundsOf(poly)
    pieces.push({ key, poly, ...box, height, parts })
  }

  for (const el of elements) {
    const cx = el.x + el.w / 2
    const cy = el.y + el.h / 2
    // Lo que ocupa sobre el piso (girado), con aire para las sillas si es una mesa.
    const air = el.kind === 'table' ? 24 : el.kind === 'bar' ? 20 : 0
    const reach = boundsOf(rectFootprint(cx, cy, el.w + air * 2, el.h + air * 2, el.rotation))
    plan = plan ? mergeBounds(plan, reach) : reach

    if (el.kind === 'table') {
      if (!el.table_id) continue
      const round = el.shape === 'circle'
      const radius = el.shape === 'banquette' ? 6 : el.corner_radius
      const footprint = round
        ? ellipseFootprint(cx, cy, el.w, el.h, el.rotation)
        : rectFootprint(cx, cy, el.w, el.h, el.rotation, radius)
      const pedestal = round
        ? ellipseFootprint(cx, cy, el.w * 0.42, el.h * 0.42, el.rotation, 16)
        : rectFootprint(cx, cy, Math.max(10, el.w - 26), Math.max(10, el.h - 26), el.rotation, 4, 2)
      const slabBottom = HEIGHTS.tableTop - HEIGHTS.tableSlab

      let tableBounds: Bounds | null = null
      const add = (entry: { solid: Solid; bounds: Bounds }): Solid => {
        tableBounds = tableBounds ? mergeBounds(tableBounds, entry.bounds) : entry.bounds
        return track(entry)
      }

      const seats = withChairs ? computeChairs(el.shape, 'table', el.w, el.h, el.capacity ?? 4) : []
      const taken = occupiedSeats(seats.length, occupancy[el.table_id] ?? 0)
      seats.forEach((chair, index) => {
        // Las sillas vienen en coordenadas del cuerpo sin rotar: se llevan al piso girando con la mesa.
        const at = rotateAround(cx, cy, el.x + chair.cx, el.y + chair.cy, el.rotation)
        const turn = el.rotation + chair.angle
        // Cada silla es una pieza: se ordena contra su mesa y contra todo lo demás por su huella. Adentro,
        // el asiento, quien está sentado y el respaldo van a mano: el asiento siempre debajo de la persona,
        // y el respaldo la tapa solo si queda del lado de quien mira.
        const here = depthOf(camera, at.x, at.y)
        const seatFootprint = rectFootprint(at.x, at.y, 17, 15, turn, 4, 2)
        const seat = add(
          solidFrom(
            camera,
            `${el.id}:c${index}`,
            'chair',
            el.table_id,
            seatFootprint,
            0,
            HEIGHTS.chairSeat,
          ),
        )
        // El respaldo va del lado de afuera: alejándose del centro de la mesa.
        const away = Math.hypot(at.x - cx, at.y - cy) || 1
        const bx = at.x + ((at.x - cx) / away) * 6.5
        const by = at.y + ((at.y - cy) / away) * 6.5
        const backFootprint = rectFootprint(bx, by, 17, 3.5, turn, 1.5, 1)
        const back = add(
          solidFrom(
            camera,
            `${el.id}:b${index}`,
            'chairback',
            el.table_id,
            backFootprint,
            0,
            HEIGHTS.chairBack,
          ),
        )
        const backInFront = depthOf(camera, bx, by) > here
        let pawn: Solid | null = null
        if (taken.has(index)) {
          const entry = solidFrom(
            camera,
            `${el.id}:p${index}`,
            'pawn',
            el.table_id,
            ellipseFootprint(at.x, at.y, 12, 12, 0, 12),
            HEIGHTS.chairSeat,
            HEIGHTS.pawnBody,
          )
          const head = project(camera, at.x, at.y, HEIGHTS.pawnHead)
          entry.solid.head = { x: head.x, y: head.y, r: 5.2 }
          entry.bounds = mergeBounds(entry.bounds, {
            minX: head.x - 6,
            minY: head.y - 6,
            maxX: head.x + 6,
            maxY: head.y + 6,
          })
          pawn = add(entry)
        }
        const sitting = pawn ? [pawn] : []
        piece(
          `${el.id}:c${index}`,
          convexHull([...seatFootprint, ...backFootprint]),
          pawn ? HEIGHTS.pawnHead : HEIGHTS.chairBack,
          backInFront ? [seat, ...sitting, back] : [back, seat, ...sitting],
        )
      })

      // La mesa es una pieza sola: la tapa se dibuja sobre su pata.
      const leg = add(
        solidFrom(camera, `${el.id}:leg`, 'pedestal', el.table_id, pedestal, 0, slabBottom),
      )
      const top = solidFrom(
        camera,
        `${el.id}:top`,
        'tabletop',
        el.table_id,
        footprint,
        slabBottom,
        HEIGHTS.tableTop,
      )
      top.solid.shadow = shadowOf(camera, footprint, HEIGHTS.tableTop)
      piece(el.id, footprint, HEIGHTS.tableTop, [leg, add(top)])

      const center = project(camera, cx, cy, HEIGHTS.tableTop)
      const safeBounds: Bounds = tableBounds ?? top.bounds
      anchors.push({
        tableId: el.table_id,
        elementId: el.id,
        label: el.table_label ?? '',
        capacity: el.capacity,
        x: center.x,
        y: center.y,
        topY: top.bounds.minY,
        topWidth: top.bounds.maxX - top.bounds.minX,
        bounds: safeBounds,
        // Se completa al final, con el orden de pintado ya resuelto.
        depth: 0,
        seats: seats.length,
      })
      continue
    }

    if (el.kind === 'door' || el.kind === 'text') {
      const at = project(camera, cx, cy, 0)
      decals.push({
        key: el.id,
        kind: el.kind,
        x: at.x,
        y: at.y,
        label: el.label,
        w: el.w,
        h: el.h,
        rotation: el.rotation,
      })
      continue
    }

    if (el.kind === 'wall') {
      splitLongRect(cx, cy, el.w, el.h, el.rotation).forEach((part, index) => {
        const footprint = rectFootprint(part.cx, part.cy, part.width, part.height, el.rotation)
        const part3d = solidFrom(
          camera,
          `${el.id}:w${index}`,
          'wall',
          null,
          footprint,
          0,
          HEIGHTS.wall,
        )
        part3d.solid.shadow = shadowOf(camera, footprint, HEIGHTS.wall * 0.6)
        piece(`${el.id}:w${index}`, footprint, HEIGHTS.wall, [track(part3d)])
      })
      continue
    }

    if (el.kind === 'pillar') {
      const footprint =
        el.shape === 'circle'
          ? ellipseFootprint(cx, cy, el.w, el.h, el.rotation, 20)
          : rectFootprint(cx, cy, el.w, el.h, el.rotation, el.corner_radius)
      const pillar = solidFrom(camera, el.id, 'pillar', null, footprint, 0, HEIGHTS.pillar)
      pillar.solid.shadow = shadowOf(camera, footprint, HEIGHTS.pillar * 0.6)
      piece(el.id, footprint, HEIGHTS.pillar, [track(pillar)])
      continue
    }

    const role: SolidRole =
      el.kind === 'bar'
        ? 'bar'
        : el.kind === 'stage'
          ? 'stage'
          : el.kind === 'booth'
            ? 'booth'
            : 'island'
    const height =
      role === 'bar'
        ? HEIGHTS.bar
        : role === 'stage'
          ? HEIGHTS.stage
          : role === 'booth'
            ? HEIGHTS.booth
            : HEIGHTS.island
    const footprint =
      el.shape === 'circle'
        ? ellipseFootprint(cx, cy, el.w, el.h, el.rotation)
        : rectFootprint(
            cx,
            cy,
            el.w,
            el.h,
            el.rotation,
            Math.max(el.corner_radius, role === 'bar' ? 5 : 3),
          )
    const block = solidFrom(camera, el.id, role, null, footprint, 0, height)
    block.solid.shadow = shadowOf(camera, footprint, height)
    piece(el.id, footprint, height, [track(block)])

    if (role === 'bar' && withChairs) {
      // Cada banqueta es una pieza: todas quedan del mismo lado de su barra, por larga que sea.
      computeBarStools(el.w, el.h).forEach((stool, index) => {
        const at = rotateAround(cx, cy, el.x + stool.cx, el.y + stool.cy, el.rotation)
        const seat = ellipseFootprint(at.x, at.y, 15, 15, 0, 12)
        const key = `${el.id}:s${index}`
        piece(key, seat, HEIGHTS.stool, [
          track(solidFrom(camera, key, 'stool', null, seat, 0, HEIGHTS.stool)),
        ])
      })
    }
  }

  const solids = (ordered ? paintOrder(pieces) : pieces).flatMap((p) => p.parts)
  const tops = new Map<string, number>()
  solids.forEach((solid, index) => {
    solid.depth = index
    if (solid.role === 'tabletop' && solid.tableId) tops.set(solid.tableId, index)
  })
  for (const anchor of anchors) anchor.depth = tops.get(anchor.tableId) ?? 0

  // La losa: el rectángulo del piso que contiene todo, con un borde de aire.
  const planBounds: Bounds = plan ?? { minX: 0, minY: 0, maxX: 400, maxY: 300 }
  const pad = 22
  const slabFootprint = rectFootprint(
    (planBounds.minX + planBounds.maxX) / 2,
    (planBounds.minY + planBounds.maxY) / 2,
    planBounds.maxX - planBounds.minX + pad * 2,
    planBounds.maxY - planBounds.minY + pad * 2,
    0,
    26,
    6,
  )
  const slab = extrude(camera, slabFootprint, -14, 0)
  const all: Bounds = bounds ? mergeBounds(bounds, slab.bounds) : slab.bounds

  return {
    solids,
    anchors,
    decals,
    floor: {
      top: polygonPath(slab.top),
      sides: slab.sides.length > 0 ? bucketSides(slab.sides) : NO_SIDES,
    },
    bounds: all,
  }
}

const DEG = Math.PI / 180

/**
 * Las poses de cámara de la maqueta, de la más «de tres cuartos» a la más de frente. Con mucho ancho se
 * usa la primera; en un celular, girar e inclinar tanto achica todo, así que se va aflojando.
 */
export const MODEL_POSES: readonly Camera[] = [
  { tilt: 54 * DEG, yaw: -14 * DEG },
  { tilt: 50 * DEG, yaw: -10 * DEG },
  { tilt: 46 * DEG, yaw: -6 * DEG },
  { tilt: 42 * DEG, yaw: 0 },
]

export type CameraChoice = {
  /** Cuartos de vuelta para acomodar el sector a la pantalla (0 o 1). */
  turns: number
  /** La pose elegida, ya girada. */
  camera: Camera
  scale: number
}

/**
 * Elige cómo mirar un sector para que entre lo más grande posible en el visor: primero si conviene girarlo
 * un cuarto de vuelta (un sector apaisado en un celular parado), después la pose más vistosa que no achique
 * las mesas más de un 10 % respecto de la mejor.
 */
export function chooseCamera(
  elements: readonly FloorElement[],
  viewport: { width: number; height: number },
  padding = 14,
  maxScale = 1.7,
  /** `false` cuando la maqueta va al lado del plano (el editor): tiene que quedar orientada igual que él. */
  allowTurn = true,
): CameraChoice {
  const fallback: CameraChoice = { turns: 0, camera: MODEL_POSES[0] as Camera, scale: 1 }
  if (viewport.width <= 0 || viewport.height <= 0) return fallback
  const scaleFor = (camera: Camera) =>
    fitBounds(
      layoutScene(camera, elements, { chairs: false }, false).bounds,
      viewport,
      padding,
      maxScale,
    ).scale

  let best: { turns: number; scales: number[]; top: number } | null = null
  for (const turns of allowTurn ? [0, 1] : [0]) {
    const scales = MODEL_POSES.map((pose) => scaleFor(turned(pose, turns)))
    const top = Math.max(...scales)
    // Sin girar gana salvo que girar agrande de verdad: la orientación de siempre es la que la gente conoce.
    if (!best || top > best.top * 1.15) best = { turns, scales, top }
  }
  if (!best) return fallback
  const index = best.scales.findIndex((s) => s >= best.top * 0.9)
  const pose = MODEL_POSES[index < 0 ? MODEL_POSES.length - 1 : index] as Camera
  return {
    turns: best.turns,
    camera: turned(pose, best.turns),
    scale: best.scales[index < 0 ? 0 : index] ?? best.top,
  }
}

/**
 * El tamaño del número de una mesa. Casi todas se llaman «7» o «12» y usan el tamaño de siempre; un nombre
 * largo («52 TERRAZA VIP») se achica hasta entrar en su tapa en vez de salirse y pisar a la de al lado.
 * `advance` es lo que ocupa cada carácter respecto del cuerpo (Archivo angosta y pesada ≈ 0,52).
 */
export function labelSize(
  label: string,
  topWidthPx: number,
  base: number,
  { min = 8, advance = 0.52, fill = 0.86 }: { min?: number; advance?: number; fill?: number } = {},
): number {
  const chars = label.trim().length
  if (chars <= 2 || !(topWidthPx > 0)) return base
  const fits = (topWidthPx * fill) / (chars * advance)
  return Math.max(min, Math.min(base, fits))
}

/** Dónde queda en pantalla la punta de la bandera de una mesa. */
export function flagTip(camera: Camera, anchor: TableAnchor, poleHeight: number): Vec2 {
  return { x: anchor.x, y: anchor.y - lift(camera, poleHeight) }
}

/** ¿Qué mesa está más cerca de un punto de pantalla? Para soltar una mesa sobre otra al arrastrar. */
export function nearestAnchor(
  anchors: readonly TableAnchor[],
  x: number,
  y: number,
  maxDistance: number,
): TableAnchor | null {
  let best: TableAnchor | null = null
  let bestDistance = maxDistance
  for (const anchor of anchors) {
    const d = Math.hypot(anchor.x - x, anchor.y - y)
    if (d < bestDistance) {
      best = anchor
      bestDistance = d
    }
  }
  return best
}
