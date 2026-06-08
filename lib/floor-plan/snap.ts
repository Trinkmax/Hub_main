/**
 * Guías de alineación + snap-a-objeto (estilo Figma) — PURO y testeado.
 *
 * Durante el drag, alinea el elemento que se mueve con los bordes/centros de sus
 * vecinos. Si un borde (izq/centro/der) o (arriba/medio/abajo) del elemento cae
 * dentro de `threshold` px lógicos de un borde/centro de algún vecino, lo "imana"
 * y devuelve la línea guía a dibujar.
 */

export type Box = { x: number; y: number; width: number; height: number }

/** Línea guía: vertical ('v', x fijo) u horizontal ('h', y fijo), con extensión. */
export type Guide = { axis: 'v' | 'h'; pos: number; from: number; to: number }

export type SnapResult = { x: number; y: number; guides: Guide[] }

/** Umbral de imán (px lógicos). */
export const SNAP_THRESHOLD = 6

type AxisSnap = { offset: number; line: number; aMin: number; aMax: number } | null

/** Bordes candidatos en un eje: inicio, centro, fin. */
function edges(start: number, size: number): number[] {
  return [start, start + size / 2, start + size]
}

/**
 * Calcula el mejor snap de `box` contra `siblings` y las guías a dibujar.
 * Eje X e Y independientes: cada uno imana al borde/centro más cercano dentro
 * de `threshold`. Devuelve la posición ya imantada + las líneas guía.
 */
export function computeSnap(
  box: Box,
  siblings: Box[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const dX = edges(box.x, box.width)
  const dY = edges(box.y, box.height)

  let bestX: AxisSnap = null
  let bestY: AxisSnap = null

  for (const s of siblings) {
    const sX = edges(s.x, s.width)
    const sY = edges(s.y, s.height)

    for (const d of dX) {
      for (const t of sX) {
        const diff = t - d
        if (
          Math.abs(diff) <= threshold &&
          (bestX === null || Math.abs(diff) < Math.abs(bestX.offset))
        ) {
          bestX = {
            offset: diff,
            line: t,
            aMin: Math.min(box.y, s.y),
            aMax: Math.max(box.y + box.height, s.y + s.height),
          }
        }
      }
    }
    for (const d of dY) {
      for (const t of sY) {
        const diff = t - d
        if (
          Math.abs(diff) <= threshold &&
          (bestY === null || Math.abs(diff) < Math.abs(bestY.offset))
        ) {
          bestY = {
            offset: diff,
            line: t,
            aMin: Math.min(box.x, s.x),
            aMax: Math.max(box.x + box.width, s.x + s.width),
          }
        }
      }
    }
  }

  const guides: Guide[] = []
  const x = box.x + (bestX?.offset ?? 0)
  const y = box.y + (bestY?.offset ?? 0)
  if (bestX) guides.push({ axis: 'v', pos: bestX.line, from: bestX.aMin, to: bestX.aMax })
  if (bestY) guides.push({ axis: 'h', pos: bestY.line, from: bestY.aMin, to: bestY.aMax })

  return { x, y, guides }
}

// ─── Alinear / distribuir una selección ──────────────────────────────────────

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Item con id + caja para alinear/distribuir. */
export type AlignItem = { id: string; box: Box }

/** Devuelve `{id → {x,y}}` con las posiciones alineadas (solo cambia el eje pedido). */
export function alignBoxes(
  items: AlignItem[],
  kind: AlignKind,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  if (items.length < 2) return out
  const xs = items.map((i) => i.box.x)
  const ys = items.map((i) => i.box.y)
  const rights = items.map((i) => i.box.x + i.box.width)
  const bottoms = items.map((i) => i.box.y + i.box.height)
  const minX = Math.min(...xs)
  const maxR = Math.max(...rights)
  const minY = Math.min(...ys)
  const maxB = Math.max(...bottoms)
  const cx = (minX + maxR) / 2
  const cy = (minY + maxB) / 2

  for (const it of items) {
    const b = it.box
    let { x, y } = b
    switch (kind) {
      case 'left':
        x = minX
        break
      case 'right':
        x = maxR - b.width
        break
      case 'hcenter':
        x = Math.round(cx - b.width / 2)
        break
      case 'top':
        y = minY
        break
      case 'bottom':
        y = maxB - b.height
        break
      case 'vcenter':
        y = Math.round(cy - b.height / 2)
        break
    }
    out.set(it.id, { x: Math.round(x), y: Math.round(y) })
  }
  return out
}
