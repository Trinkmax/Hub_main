/**
 * Helpers puros de geometría del editor de plano.
 *
 * `GRID` / `RESIZE_MIN` / `ELEMENT_DEFAULTS` son las constantes deterministas
 * del spec §5. `snapToGrid`, `clampToArea` y `stagePointFromClient` son puras y
 * testeadas en `tests/lib/floor-plan-grid.test.ts`. El editor rediseñado usa
 * `react-zoom-pan-pinch` + pointer drag propio: NO hay modifiers de dnd-kit.
 */

/** Grilla lógica (px lógicos). El snap usa este valor. */
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

/**
 * Posición LIBRE de un elemento durante el drag, en coords lógicas: el delta de
 * pantalla (`dxScreen`/`dyScreen`) se pasa a lógico dividiendo por `scale` y se
 * suma al origen del gesto (`origX`/`origY`), sólo acotado al área (SIN snap).
 *
 * Es lo que se pinta con `translate3d` durante el arrastre → seguimiento 1:1 a
 * cualquier zoom (sin escalonado, sin "zona muerta" a zoom alto). Puro.
 */
export function freeDragPosition(
  origX: number,
  origY: number,
  dxScreen: number,
  dyScreen: number,
  scale: number,
  w: number,
  h: number,
  areaW: number,
  areaH: number,
): { x: number; y: number } {
  return clampToArea(origX + dxScreen / scale, origY + dyScreen / scale, w, h, areaW, areaH)
}

/**
 * Posición FINAL al soltar el drag, en coords lógicas: `origX + dxScreen/scale`,
 * con `snapToGrid` si `snap` (default del gesto) o libre si `snap === false`
 * (bypass con Alt), y siempre acotada al área. Puro.
 *
 * Devuelve SIEMPRE enteros: la geometría persistida es `z.number().int()`
 * (`elementGeometrySchema`); a `scale` fraccional el path libre se redondea (el
 * de snap ya es múltiplo de GRID). Un float haría fallar el `safeParse` y
 * dispararía el rollback del estado optimista.
 */
export function commitDragPosition(
  origX: number,
  origY: number,
  dxScreen: number,
  dyScreen: number,
  scale: number,
  w: number,
  h: number,
  areaW: number,
  areaH: number,
  snap: boolean,
): { x: number; y: number } {
  const rawX = origX + dxScreen / scale
  const rawY = origY + dyScreen / scale
  const x = snap ? snapToGrid(rawX) : Math.round(rawX)
  const y = snap ? snapToGrid(rawY) : Math.round(rawY)
  return clampToArea(x, y, w, h, areaW, areaH)
}
