/**
 * Helpers puros de geometría del editor de plano.
 *
 * `GRID` / `RESIZE_MIN` / `ELEMENT_DEFAULTS` son las constantes deterministas
 * del spec §5. `snapToGrid` y `clampToArea` son puras y testeadas en
 * `tests/lib/floor-plan-grid.test.ts`. Los modifiers de dnd-kit
 * (`createSnapModifier`, `restrictToParent`) se agregan al final de este
 * archivo (Task 3.3) y solo importan el TIPO `Modifier`.
 */

import type { Modifier } from '@dnd-kit/core'

/** Grilla lógica (px lógicos). El snap y el paso de teclado usan este valor. */
export const GRID = 20

/** Mínimo de redimensionado (px lógicos) para cualquier elemento. */
export const RESIZE_MIN = 24

/** Defaults de shape/tamaño por kind al agregar un elemento nuevo. */
export const ELEMENT_DEFAULTS: Record<
  'table' | 'wall' | 'pillar' | 'island' | 'bar',
  { shape: 'rect' | 'circle'; width: number; height: number }
> = {
  table: { shape: 'rect', width: 80, height: 80 },
  wall: { shape: 'rect', width: 200, height: 16 },
  pillar: { shape: 'circle', width: 40, height: 40 },
  island: { shape: 'rect', width: 120, height: 80 },
  bar: { shape: 'rect', width: 240, height: 40 },
}

/**
 * Redondea `value` al múltiplo más cercano de `grid` (default `GRID`).
 * Puro. Math.round rompe empates hacia +∞ (p. ej. -0.5 → -0).
 */
export function snapToGrid(value: number, grid?: number): number {
  const g = grid ?? GRID
  return Math.round(value / g) * g
}

/**
 * Acota la posición `(x, y)` de un elemento de tamaño `w × h` para que quede
 * dentro del área `areaW × areaH`: `x ∈ [0, areaW - w]`, `y ∈ [0, areaH - h]`.
 * Si el elemento es más grande que el área (`areaW - w < 0`), el `max` interno
 * queda < 0 y el `Math.max(0, …)` lo fija en 0. Puro.
 */
export function clampToArea(
  x: number,
  y: number,
  w: number,
  h: number,
  areaW: number,
  areaH: number,
): { x: number; y: number } {
  const maxX = areaW - w
  const maxY = areaH - h
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  }
}

/**
 * Modifier v6 de snap-a-grilla en espacio lógico.
 *
 * Bajo `transform: scale(s)` en el stage, dnd-kit reporta `transform` en px de
 * PANTALLA. Snapeamos en px LÓGICOS (`/ scale`) y devolvemos px de pantalla
 * (`* scale`) para que el preview coincida con el commit en `onDragEnd`.
 * `getScale` cierra sobre el scale vigente (re-`useMemo` keyed en `scale` en
 * el editor). Devuelve `{ ...transform, x, y }` para preservar `scaleX/scaleY`.
 */
export function createSnapModifier(grid: number, getScale: () => number): Modifier {
  return ({ transform }) => {
    const scale = getScale()
    const x = Math.round(transform.x / scale / grid) * grid * scale
    const y = Math.round(transform.y / scale / grid) * grid * scale
    return { ...transform, x, y }
  }
}

/**
 * Modifier v6 que restringe el arrastre al contenedor (viewport) en espacio
 * lógico. Bajo `scale`, los rects que reporta dnd-kit están en px de PANTALLA;
 * dividimos por `scale` para acotar en lógico y multiplicamos de vuelta para
 * devolver px de pantalla. Sin rects (no medible) devuelve el transform tal cual.
 * Devuelve `{ ...transform, x, y }` para preservar `scaleX/scaleY`.
 *
 * Acotación: el elemento puede moverse `transform.x` de modo que su borde
 * izquierdo no pase el `left` del contenedor ni su borde derecho pase el
 * `right`. En lógico:
 *   minX = container.left - dragging.left
 *   maxX = container.right - dragging.right
 * (idem Y). Se clampea `transform.x/scale` a `[minX, maxX]` y se reescala.
 */
export function restrictToParent(getScale: () => number): Modifier {
  return ({ transform, draggingNodeRect, containerNodeRect }) => {
    if (!draggingNodeRect || !containerNodeRect) {
      return transform
    }
    const scale = getScale()
    // Rects a espacio lógico.
    const cLeft = containerNodeRect.left / scale
    const cTop = containerNodeRect.top / scale
    const cRight = containerNodeRect.right / scale
    const cBottom = containerNodeRect.bottom / scale
    const dLeft = draggingNodeRect.left / scale
    const dTop = draggingNodeRect.top / scale
    const dRight = draggingNodeRect.right / scale
    const dBottom = draggingNodeRect.bottom / scale

    const minX = cLeft - dLeft
    const maxX = cRight - dRight
    const minY = cTop - dTop
    const maxY = cBottom - dBottom

    const logicalX = transform.x / scale
    const logicalY = transform.y / scale

    const clampedX = Math.max(minX, Math.min(logicalX, maxX))
    const clampedY = Math.max(minY, Math.min(logicalY, maxY))

    return { ...transform, x: clampedX * scale, y: clampedY * scale }
  }
}

/**
 * Convierte un punto de pantalla (clientX/Y) a coordenadas lógicas del stage.
 *
 * Fórmula: `(clientX - rect.left - posX) / scale` (ídem Y).
 *
 * @param clientX  - evento.clientX del pointer
 * @param clientY  - evento.clientY del pointer
 * @param rect     - `wrapperRef.current.getBoundingClientRect()` (solo left/top)
 * @param scale    - `transformRef.current.state.scale`
 * @param posX     - `transformRef.current.state.positionX`
 * @param posY     - `transformRef.current.state.positionY`
 */
export function stagePointFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  scale: number,
  posX: number,
  posY: number,
): { x: number; y: number } {
  return {
    x: (clientX - rect.left - posX) / scale,
    y: (clientY - rect.top - posY) / scale,
  }
}
