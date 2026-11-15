/**
 * La geometría de la barra de abajo, en coordenadas de la cápsula (0,0 = su esquina de arriba a la
 * izquierda, sin la escala con que se infla al tocarla). Pura: la usan el componente y los tests.
 *
 * Tres piezas se mueven juntas sobre el mismo `x` (el centro de la selección):
 * - la píldora, que marca la pestaña activa en reposo, detrás de los íconos;
 * - la lente, que es la píldora levantada: más grande que la barra, transparente y por encima;
 * - la lupa, una copia de la fila adentro de la lente, agrandada alrededor de su centro.
 */

/** Cuánto agranda la lupa con la lente bien levantada. */
export const LENS_ZOOM = 1.22
/** Cuánto más agranda el filo de la lente (la «doblez» del vidrio en el borde). */
export const EDGE_ZOOM = 1.36
/** El estiramiento máximo de la gota cuando la lente corre. */
export const MAX_STRETCH = 0.28
/** Velocidad (px/s) a la que la gota llega a su estiramiento máximo. */
const STRETCH_SPEED = 2600
/** Al estirarse a lo ancho, se afina a lo alto en esta proporción (conserva un poco el volumen). */
const THINNING = 0.45

export type DockGeometry = {
  rowLeft: number
  rowTop: number
  rowWidth: number
  rowHeight: number
  itemWidth: number
  /** El centro horizontal de cada pestaña. */
  centers: number[]
  /** El centro vertical de la fila. */
  centerY: number
  pill: { width: number; height: number }
  lens: { width: number; height: number }
}

/** Arma la geometría a partir de la caja de la fila (las pestañas miden todas lo mismo). */
export function dockGeometry({
  rowLeft,
  rowTop,
  rowWidth,
  rowHeight,
  count,
}: {
  rowLeft: number
  rowTop: number
  rowWidth: number
  rowHeight: number
  count: number
}): DockGeometry {
  const itemWidth = count > 0 ? rowWidth / count : 0
  return {
    rowLeft,
    rowTop,
    rowWidth,
    rowHeight,
    itemWidth,
    centers: Array.from({ length: count }, (_, index) => rowLeft + itemWidth * (index + 0.5)),
    centerY: rowTop + rowHeight / 2,
    pill: { width: Math.max(0, itemWidth - 4), height: rowHeight },
    // Más ancha que la pestaña y más alta que la barra: una cápsula que se sale por arriba y por abajo y
    // tapa un poco a las vecinas (por eso se ven las palabras partidas en el filo), como en iOS.
    lens: { width: itemWidth + 28, height: rowHeight + 18 },
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** 0 antes de `edge0`, 1 después de `edge1`, y una curva suave en el medio. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** La pestaña cuyo centro queda más cerca de `x`. */
export function nearestIndex(x: number, centers: readonly number[]): number {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  centers.forEach((center, index) => {
    const distance = Math.abs(center - x)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

/**
 * Más allá de los bordes el dedo sigue tirando, pero la lente cede cada vez menos (como una banda
 * elástica): se nota el borde sin que la lente se frene en seco.
 */
export function rubberBand(x: number, min: number, max: number, give = 0.28): number {
  if (x < min) return min - (min - x) * give
  if (x > max) return max + (x - max) * give
  return x
}

/** Cuánto se estira la gota según lo rápido que corre (0 = quieta). */
export function stretchFromVelocity(velocity: number): number {
  return Math.min(Math.abs(velocity) / STRETCH_SPEED, MAX_STRETCH)
}

/**
 * La escala de la lente: con `lift` 0 mide lo mismo que la píldora y con 1 es la lente entera. El
 * estiramiento la alarga y la afina. `lift` puede pasarse un poco de 0 y de 1 (el rebote del resorte):
 * eso es justamente el «aplastarse» al caer.
 */
export function lensScale(
  geo: DockGeometry,
  lift: number,
  stretch: number,
): { sx: number; sy: number } {
  const sx = lerp(geo.pill.width / geo.lens.width, 1, lift)
  const sy = lerp(geo.pill.height / geo.lens.height, 1, lift)
  return { sx: sx * (1 + stretch), sy: sy * (1 - THINNING * stretch) }
}

/**
 * La transformación de la copia de la fila que va adentro de la lente (con `transform-origin: 0 0`):
 * lleva el punto de la fila que está bajo el centro de la lente al centro de la lente, y agranda
 * `zoom` veces alrededor de ese punto. Divide por la escala de la lente para que lo de adentro no se
 * deforme con ella: la lente se estira, lo que se ve a través no.
 */
export function magnifierTransform(
  geo: DockGeometry,
  x: number,
  { sx, sy }: { sx: number; sy: number },
  zoom: number,
): string {
  const halfW = geo.lens.width / 2
  const halfH = geo.lens.height / 2
  const zx = zoom / Math.max(sx, 0.01)
  const zy = zoom / Math.max(sy, 0.01)
  const cx = x - geo.rowLeft
  const cy = geo.centerY - geo.rowTop
  return `translate(${round(halfW)}px, ${round(halfH)}px) scale(${round(zx, 4)}, ${round(zy, 4)}) translate(${round(-cx)}px, ${round(-cy)}px)`
}

/** Dónde empieza y termina la lente sobre la fila (para tapar los íconos originales que quedan debajo). */
export function holeEdges(
  geo: DockGeometry,
  x: number,
  sx: number,
): { left: number; right: number } {
  const half = (geo.lens.width * sx) / 2
  return { left: x - half - geo.rowLeft, right: x + half - geo.rowLeft }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
