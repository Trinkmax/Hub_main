/**
 * Proyección de la maqueta del salón — PURA y testeada.
 *
 * El plano se guarda en coordenadas de piso (x a la derecha, y hacia el frente,
 * z hacia arriba). La maqueta lo muestra con una cámara ortográfica que mira
 * desde el frente y desde arriba:
 *
 *   xr =  x·cos(yaw) − y·sin(yaw)        (giro del salón)
 *   yr =  x·sin(yaw) + y·cos(yaw)
 *   sx =  xr
 *   sy =  yr·cos(tilt) − z·sin(tilt)     (inclinación)
 *
 * Al ser ortográfica no hay fuga: una mesa del fondo mide lo mismo que una del
 * frente, así que el tamaño de toque no depende de dónde esté. Con `tilt = 0` y
 * `yaw = 0` la proyección es el plano de siempre, lo que deja animar de plano a
 * maqueta interpolando la cámara.
 *
 * Todo lo que es chato (piso, sombras, tapas) es una transformación afín y se
 * puede dibujar con `floorMatrix`. Solo las caras laterales necesitan geometría,
 * y eso hace `extrude`.
 */

export type Vec2 = { x: number; y: number }

export type Camera = {
  /** Inclinación en radianes: 0 = cenital (plano), π/2 = de costado. */
  tilt: number
  /** Giro del salón sobre el eje vertical, en radianes (positivo = horario en pantalla). */
  yaw: number
}

const DEG = Math.PI / 180

/** El plano de siempre: cenital, sin giro. */
export const PLAN_CAMERA: Camera = { tilt: 0, yaw: 0 }

/** La maqueta: vista de tres cuartos, desde el frente y un poco de costado. */
export const MODEL_CAMERA: Camera = { tilt: 54 * DEG, yaw: -14 * DEG }

/** Gira una cámara un cuarto de vuelta (o los que hagan falta) para acomodar el sector a la pantalla. */
export function turned(camera: Camera, quarterTurns: number): Camera {
  return { tilt: camera.tilt, yaw: camera.yaw + (quarterTurns * Math.PI) / 2 }
}

/** Interpola dos cámaras (t = 0 → a, t = 1 → b). */
export function mixCamera(a: Camera, b: Camera, t: number): Camera {
  const k = Math.min(1, Math.max(0, t))
  return { tilt: a.tilt + (b.tilt - a.tilt) * k, yaw: a.yaw + (b.yaw - a.yaw) * k }
}

type Basis = { cosYaw: number; sinYaw: number; cosTilt: number; sinTilt: number }

function basis(camera: Camera): Basis {
  return {
    cosYaw: Math.cos(camera.yaw),
    sinYaw: Math.sin(camera.yaw),
    cosTilt: Math.cos(camera.tilt),
    sinTilt: Math.sin(camera.tilt),
  }
}

/** Proyecta un punto del piso (con altura `z`) a pantalla. */
export function project(camera: Camera, x: number, y: number, z = 0): Vec2 {
  const b = basis(camera)
  const xr = x * b.cosYaw - y * b.sinYaw
  const yr = x * b.sinYaw + y * b.cosYaw
  return { x: xr, y: yr * b.cosTilt - z * b.sinTilt }
}

/**
 * Profundidad de un punto del piso: cuanto mayor, más cerca de quien mira.
 * Sirve para ordenar qué se dibuja primero (algoritmo del pintor).
 */
export function depthOf(camera: Camera, x: number, y: number): number {
  return x * Math.sin(camera.yaw) + y * Math.cos(camera.yaw)
}

/**
 * Una huella llevada al piso ya girado por la cámara: `x` es la columna de pantalla donde cae cada punto
 * (la altura no la mueve) e `y` su profundidad (mayor = más cerca de quien mira). Con esto se decide
 * quién tapa a quién (`paintOrder` en `scene.ts`).
 */
export function floorView(camera: Camera, footprint: readonly Vec2[]): Vec2[] {
  const cos = Math.cos(camera.yaw)
  const sin = Math.sin(camera.yaw)
  return footprint.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
}

/**
 * Cuánto sube en pantalla una altura `z` (en las mismas unidades del piso).
 * Con la cámara cenital es 0: los volúmenes no se ven.
 */
export function lift(camera: Camera, z: number): number {
  return z * Math.sin(camera.tilt)
}

/**
 * Matriz afín piso → pantalla para `z = 0`, en el orden de `matrix(a b c d e f)`
 * de SVG y CSS. Lo que se dibuja adentro queda apoyado en el piso.
 */
export function floorMatrix(camera: Camera): [number, number, number, number, number, number] {
  const b = basis(camera)
  return [b.cosYaw, b.sinYaw * b.cosTilt, -b.sinYaw, b.cosYaw * b.cosTilt, 0, 0]
}

/**
 * Inversa de la proyección sobre el piso: de un punto de pantalla al punto del
 * piso (z = 0) que se ve ahí. Lo usa el arrastre para mover mesas en la maqueta.
 * Devuelve `null` si la cámara está de costado (el piso se ve como una línea).
 */
export function unproject(camera: Camera, sx: number, sy: number): Vec2 | null {
  const b = basis(camera)
  if (Math.abs(b.cosTilt) < 1e-6) return null
  const xr = sx
  const yr = sy / b.cosTilt
  return { x: xr * b.cosYaw + yr * b.sinYaw, y: -xr * b.sinYaw + yr * b.cosYaw }
}

// ─── Huellas ────────────────────────────────────────────────────────────────

/** Punto local (relativo al centro, sin rotar) llevado al piso. */
function place(cx: number, cy: number, cos: number, sin: number, lx: number, ly: number): Vec2 {
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }
}

/**
 * Huella de un rectángulo (con esquinas redondeadas opcionales) centrado en
 * `(cx, cy)` y rotado `rotation` grados. Devuelve un polígono convexo.
 */
export function rectFootprint(
  cx: number,
  cy: number,
  width: number,
  height: number,
  rotation = 0,
  cornerRadius = 0,
  cornerSegments = 4,
): Vec2[] {
  const hw = Math.max(0, width) / 2
  const hh = Math.max(0, height) / 2
  const r = Math.max(0, Math.min(cornerRadius, hw, hh))
  const cos = Math.cos(rotation * DEG)
  const sin = Math.sin(rotation * DEG)

  if (r < 0.5 || cornerSegments < 1) {
    return [
      place(cx, cy, cos, sin, -hw, -hh),
      place(cx, cy, cos, sin, hw, -hh),
      place(cx, cy, cos, sin, hw, hh),
      place(cx, cy, cos, sin, -hw, hh),
    ]
  }

  // Centros de las cuatro esquinas y el ángulo en que arranca cada arco,
  // recorriendo en sentido horario de pantalla (y hacia abajo).
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -90],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, 90],
    [-hw + r, -hh + r, 180],
  ]
  const points: Vec2[] = []
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = (start + (90 * i) / cornerSegments) * DEG
      points.push(place(cx, cy, cos, sin, ox + r * Math.cos(a), oy + r * Math.sin(a)))
    }
  }
  return points
}

/** Huella de una elipse (mesa redonda, columna) como polígono de `segments` lados. */
export function ellipseFootprint(
  cx: number,
  cy: number,
  width: number,
  height: number,
  rotation = 0,
  segments = 28,
): Vec2[] {
  const rx = Math.max(0, width) / 2
  const ry = Math.max(0, height) / 2
  const cos = Math.cos(rotation * DEG)
  const sin = Math.sin(rotation * DEG)
  const n = Math.max(6, segments)
  const points: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n
    points.push(place(cx, cy, cos, sin, rx * Math.cos(a), ry * Math.sin(a)))
  }
  return points
}

// ─── Volúmenes ──────────────────────────────────────────────────────────────

export type Face = {
  /** Vértices ya proyectados, en orden. */
  points: Vec2[]
  /**
   * Cuánta luz recibe la cara, de 0 (a contraluz) a 1 (de lleno). La luz viene
   * de la izquierda y de adelante, así que las caras que miran a la derecha
   * quedan más oscuras.
   */
  light: number
}

export type Prism = {
  /** Tapa superior, proyectada. */
  top: Vec2[]
  /** Caras laterales que se ven desde la cámara. */
  sides: Face[]
  /** Clave de orden: el punto de la huella más cercano a quien mira. */
  depth: number
  /** Caja que contiene todo lo dibujado, en pantalla. */
  bounds: Bounds
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

export function boundsOf(points: readonly Vec2[]): Bounds {
  const first = points[0]
  if (!first) return EMPTY_BOUNDS
  let minX = first.x
  let maxX = first.x
  let minY = first.y
  let maxY = first.y
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/** Centro de un polígono (promedio de vértices; alcanza para huellas convexas). */
export function centroid(points: readonly Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (const p of points) {
    x += p.x
    y += p.y
  }
  return { x: x / points.length, y: y / points.length }
}

/** Dirección de la luz sobre el piso (ya girado): de la izquierda y de adelante. */
const LIGHT = { x: -0.78, y: 0.62 }

/**
 * Levanta una huella convexa entre las alturas `z0` y `z1` y devuelve la tapa y
 * las caras laterales visibles. Con la cámara cenital no hay caras: la altura no
 * se ve y el resultado es la huella sola.
 */
export function extrude(camera: Camera, footprint: readonly Vec2[], z0: number, z1: number): Prism {
  const b = basis(camera)
  const n = footprint.length
  const lo = Math.min(z0, z1)
  const hi = Math.max(z0, z1)

  const top: Vec2[] = []
  const bottom: Vec2[] = []
  let depth = Number.NEGATIVE_INFINITY
  for (const p of footprint) {
    const xr = p.x * b.cosYaw - p.y * b.sinYaw
    const yr = p.x * b.sinYaw + p.y * b.cosYaw
    top.push({ x: xr, y: yr * b.cosTilt - hi * b.sinTilt })
    bottom.push({ x: xr, y: yr * b.cosTilt - lo * b.sinTilt })
    if (yr > depth) depth = yr
  }

  const sides: Face[] = []
  if (n >= 3 && hi - lo > 1e-6 && b.sinTilt > 1e-6) {
    const c = centroid(footprint)
    for (let i = 0; i < n; i++) {
      const p = footprint[i]
      const q = footprint[(i + 1) % n]
      const tp = top[i]
      const tq = top[(i + 1) % n]
      const bp = bottom[i]
      const bq = bottom[(i + 1) % n]
      if (!p || !q || !tp || !tq || !bp || !bq) continue

      // Normal del lado, apuntando hacia afuera de la huella.
      const ex = q.x - p.x
      const ey = q.y - p.y
      const len = Math.hypot(ex, ey)
      if (len < 1e-6) continue
      let nx = ey / len
      let ny = -ex / len
      const mx = (p.x + q.x) / 2 - c.x
      const my = (p.y + q.y) / 2 - c.y
      if (nx * mx + ny * my < 0) {
        nx = -nx
        ny = -ny
      }

      // Llevada al piso girado: se ve si mira hacia quien observa (+y).
      const nrx = nx * b.cosYaw - ny * b.sinYaw
      const nry = nx * b.sinYaw + ny * b.cosYaw
      if (nry <= 1e-6) continue

      const facing = Math.max(0, nrx * LIGHT.x + nry * LIGHT.y)
      sides.push({ points: [tp, tq, bq, bp], light: Math.min(1, facing) })
    }
  }

  let bounds = boundsOf(top)
  if (sides.length > 0) bounds = mergeBounds(bounds, boundsOf(bottom))

  return { top, sides, depth: Number.isFinite(depth) ? depth : 0, bounds }
}

/** Envolvente convexa (cadena monótona). La usan las sombras: la huella más su corrimiento. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Vec2[] = []
  for (const p of sorted) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2]
      const b = lower[lower.length - 1]
      if (!a || !b || cross(a, b, p) > 0) break
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    if (!p) continue
    while (upper.length >= 2) {
      const a = upper[upper.length - 2]
      const b = upper[upper.length - 1]
      if (!a || !b || cross(a, b, p) > 0) break
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/** Cadena `d` de SVG para un polígono cerrado. Redondea a décimas para acortarla. */
export function polygonPath(points: readonly Vec2[]): string {
  const first = points[0]
  if (!first) return ''
  let d = `M${round(first.x)} ${round(first.y)}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (p) d += `L${round(p.x)} ${round(p.y)}`
  }
  return `${d}Z`
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Parte un rectángulo largo y fino (una pared) en tramos cortos a lo largo de
 * su eje mayor. Ordenados por separado, los tramos se intercalan bien con las
 * mesas que tienen adelante y atrás; una pared entera no.
 */
export function splitLongRect(
  cx: number,
  cy: number,
  width: number,
  height: number,
  rotation: number,
  maxSegment = 90,
): { cx: number; cy: number; width: number; height: number }[] {
  const alongWidth = width >= height
  const long = alongWidth ? width : height
  const count = Math.max(1, Math.ceil(long / Math.max(1, maxSegment)))
  if (count === 1) return [{ cx, cy, width, height }]
  const step = long / count
  const cos = Math.cos(rotation * DEG)
  const sin = Math.sin(rotation * DEG)
  const segments: { cx: number; cy: number; width: number; height: number }[] = []
  for (let i = 0; i < count; i++) {
    const offset = -long / 2 + step * (i + 0.5)
    const lx = alongWidth ? offset : 0
    const ly = alongWidth ? 0 : offset
    const p = place(cx, cy, cos, sin, lx, ly)
    segments.push({
      cx: p.x,
      cy: p.y,
      width: alongWidth ? step : width,
      height: alongWidth ? height : step,
    })
  }
  return segments
}

/**
 * Escala y desplazamiento para que una caja de contenido entre centrada en un
 * visor, con margen. Nunca agranda más allá de `maxScale`.
 */
export function fitBounds(
  content: Bounds,
  viewport: { width: number; height: number },
  padding = 0,
  maxScale = Number.POSITIVE_INFINITY,
): { scale: number; offsetX: number; offsetY: number } {
  const cw = Math.max(1, content.maxX - content.minX)
  const ch = Math.max(1, content.maxY - content.minY)
  const vw = Math.max(1, viewport.width - padding * 2)
  const vh = Math.max(1, viewport.height - padding * 2)
  const scale = Math.min(vw / cw, vh / ch, maxScale)
  return {
    scale,
    offsetX: (viewport.width - cw * scale) / 2 - content.minX * scale,
    offsetY: (viewport.height - ch * scale) / 2 - content.minY * scale,
  }
}
