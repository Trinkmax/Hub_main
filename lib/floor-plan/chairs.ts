/**
 * Geometría de sillas del plano (estilo SevenRooms) — PURA y testeada.
 *
 * Dado el tamaño/forma/capacidad de una mesa, devuelve la posición de cada silla
 * alrededor del cuerpo. Las coordenadas son LOCALES al cuerpo de la mesa: el
 * cuerpo ocupa el rectángulo `(0,0)`–`(w,h)`; las sillas caen por fuera de ese
 * rectángulo (valores negativos o > w/h). El componente de render dibuja el SVG
 * con un margen (`CHAIR_MARGIN`) y `overflow: visible`, así las sillas se ven sin
 * recortar.
 *
 * Es pura (sin depender de la sesión) → memoizable por geometría: el refetch en
 * vivo (que solo cambia la sesión) no recomputa sillas.
 */

/** Margen del SVG alrededor del cuerpo (px lógicos) para que las sillas no se recorten. */
export const CHAIR_MARGIN = 22
/** Largo de la silla (paralelo al borde de la mesa). */
export const CHAIR_W = 16
/** Profundidad de la silla (perpendicular al borde). */
export const CHAIR_H = 13
/** Radio de las esquinas de la silla. */
export const CHAIR_RADIUS = 4
/** Separación entre el borde de la mesa y la silla. */
export const CHAIR_GAP = 5
/** Máximo de sillas dibujadas (más allá se muestra el número en el cuerpo). */
export const MAX_CHAIRS = 12
/** Radio de la banqueta de barra (kind='bar'). */
export const STOOL_RADIUS = 7

export type Chair = {
  /** Centro de la silla en coords locales al cuerpo (0..w, 0..h ± margen). */
  cx: number
  cy: number
  /** Rotación de la silla en grados (0 = chip ancho horizontal). */
  angle: number
}

type Shape = 'rect' | 'circle' | 'banquette'
type Kind = 'table' | 'wall' | 'pillar' | 'island' | 'bar' | 'door' | 'text' | 'stage' | 'booth'

/** Distancia del centro del chip al borde de la mesa (perpendicular). */
const CHAIR_OFFSET = CHAIR_GAP + CHAIR_H / 2

/**
 * Reparte `n` sillas en los 4 lados de un rectángulo `w×h`, proporcional al
 * largo de cada lado (los lados largos reciben más). Determinista.
 *
 * Asigna silla por silla al lado con menor "densidad" (sillas / largo), con
 * desempate en orden [top, bottom, left, right]. Esto da los repartos clásicos:
 * 4-top → 1/1/1/1, 6-top (240×80) → 2/2/1/1, 8-top → 3/3/1/1.
 */
export function distributeSides(
  n: number,
  w: number,
  h: number,
): { top: number; bottom: number; left: number; right: number } {
  const counts = { top: 0, bottom: 0, left: 0, right: 0 }
  const len = { top: w, bottom: w, left: h, right: h }
  const order: (keyof typeof counts)[] = ['top', 'bottom', 'left', 'right']
  for (let i = 0; i < n; i++) {
    let best: keyof typeof counts = 'top'
    let bestDensity = Number.POSITIVE_INFINITY
    for (const side of order) {
      const density = (counts[side] + 1) / Math.max(1, len[side])
      if (density < bestDensity - 1e-9) {
        bestDensity = density
        best = side
      }
    }
    counts[best]++
  }
  return counts
}

/** Posiciones equiespaciadas a lo largo de `[start, end]`, con `count` puntos. */
function linspace(count: number, start: number, end: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [(start + end) / 2]
  const step = (end - start) / (count - 1)
  return Array.from({ length: count }, (_, i) => start + i * step)
}

/**
 * Devuelve las sillas de una mesa. `kind` solo afecta a `booth` (sillas de un
 * solo lado). La decoración (no-table) no lleva sillas → `[]`.
 */
export function computeChairs(
  shape: Shape,
  kind: Kind,
  w: number,
  h: number,
  capacity: number | null | undefined,
): Chair[] {
  if (kind !== 'table' && kind !== 'booth') return []
  const n = Math.min(Math.max(0, capacity ?? 0), MAX_CHAIRS)
  if (n <= 0) return []

  // Sillas en un solo lado largo (banquette / booth).
  if (shape === 'banquette' || kind === 'booth') {
    const horizontal = w >= h
    const inset = CHAIR_W / 2 + 4
    if (horizontal) {
      // Lado de abajo (el "abierto"); el respaldo va arriba.
      const xs = linspace(n, inset, w - inset)
      return xs.map((x) => ({ cx: x, cy: h + CHAIR_OFFSET, angle: 0 }))
    }
    const ys = linspace(n, inset, h - inset)
    return ys.map((y) => ({ cx: w + CHAIR_OFFSET, cy: y, angle: 90 }))
  }

  // Redonda / óvalo: equiespaciadas en la elipse, arrancando arriba.
  if (shape === 'circle') {
    const rx = w / 2 + CHAIR_OFFSET
    const ry = h / 2 + CHAIR_OFFSET
    const cx0 = w / 2
    const cy0 = h / 2
    return Array.from({ length: n }, (_, i) => {
      const theta = -Math.PI / 2 + (i * 2 * Math.PI) / n
      return {
        cx: cx0 + rx * Math.cos(theta),
        cy: cy0 + ry * Math.sin(theta),
        // El chip mira a la mesa: su eje largo es tangente a la elipse.
        angle: (theta * 180) / Math.PI + 90,
      }
    })
  }

  // Rectangular / cuadrada: repartir en los 4 lados.
  const sides = distributeSides(n, w, h)
  const inset = CHAIR_W / 2 + 4
  const chairs: Chair[] = []
  for (const x of linspace(sides.top, inset, w - inset)) {
    chairs.push({ cx: x, cy: -CHAIR_OFFSET, angle: 0 })
  }
  for (const x of linspace(sides.bottom, inset, w - inset)) {
    chairs.push({ cx: x, cy: h + CHAIR_OFFSET, angle: 0 })
  }
  for (const y of linspace(sides.left, inset, h - inset)) {
    chairs.push({ cx: -CHAIR_OFFSET, cy: y, angle: 90 })
  }
  for (const y of linspace(sides.right, inset, h - inset)) {
    chairs.push({ cx: w + CHAIR_OFFSET, cy: y, angle: 90 })
  }
  return chairs
}

/** Banquetas de barra (kind='bar'): fila de círculos a lo largo del lado largo externo. */
export function computeBarStools(w: number, h: number): { cx: number; cy: number }[] {
  const horizontal = w >= h
  const spacing = 22
  if (horizontal) {
    const count = Math.max(0, Math.floor((w - 16) / spacing))
    const xs = linspace(count, spacing / 2 + 6, w - spacing / 2 - 6)
    return xs.map((x) => ({ cx: x, cy: h + CHAIR_GAP + STOOL_RADIUS }))
  }
  const count = Math.max(0, Math.floor((h - 16) / spacing))
  const ys = linspace(count, spacing / 2 + 6, h - spacing / 2 - 6)
  return ys.map((y) => ({ cx: w + CHAIR_GAP + STOOL_RADIUS, cy: y }))
}
