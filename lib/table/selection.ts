/**
 * Selección de filas de `DataTable` (kit HUB §3.6), sin React: la usan las
 * islas cliente de la tabla y se prueba sola.
 *
 * Reglas:
 * - Lo elegido siempre sale en el orden de las filas (así los
 *   `<input type="hidden">` de una acción masiva llegan ordenados) y sin
 *   repetidos.
 * - Solo cuenta lo que está en pantalla: si cambian las filas (otra página,
 *   otro filtro), lo que ya no se ve se suelta. Una acción masiva nunca toca
 *   filas que el dueño no está viendo.
 */

import { formatNumber } from '@/lib/format/number-kind'

/** Estado de la casilla «elegir todo» (el de Radix: `'indeterminate'` es el guion). */
export type HeaderCheckedState = boolean | 'indeterminate'

function inRowOrder(rowIds: readonly string[], chosen: ReadonlySet<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of rowIds) {
    if (chosen.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** Lo elegido que sigue en pantalla, en el orden de las filas. */
export function pruneSelection(rowIds: readonly string[], selected: readonly string[]): string[] {
  if (selected.length === 0) return []
  return inRowOrder(rowIds, new Set(selected))
}

/** Marca o desmarca una fila. */
export function setRowSelected(
  rowIds: readonly string[],
  selected: readonly string[],
  id: string,
  checked: boolean,
): string[] {
  const chosen = new Set(selected)
  if (checked) chosen.add(id)
  else chosen.delete(id)
  return inRowOrder(rowIds, chosen)
}

/**
 * Mayús + click: todas las filas entre la última tocada (`anchor`) y esta
 * quedan como quedó esta. Si el ancla ya no está en pantalla, es un click
 * común.
 */
export function selectRange(
  rowIds: readonly string[],
  selected: readonly string[],
  anchor: string | null,
  target: string,
  checked: boolean,
): string[] {
  const from = anchor === null ? -1 : rowIds.indexOf(anchor)
  const to = rowIds.indexOf(target)
  if (from === -1 || to === -1) return setRowSelected(rowIds, selected, target, checked)
  const chosen = new Set(selected)
  const [low, high] = from < to ? [from, to] : [to, from]
  for (const id of rowIds.slice(low, high + 1)) {
    if (checked) chosen.add(id)
    else chosen.delete(id)
  }
  return inRowOrder(rowIds, chosen)
}

/** Todas las filas en pantalla. */
export function selectAllRows(rowIds: readonly string[]): string[] {
  return inRowOrder(rowIds, new Set(rowIds))
}

/** «Elegir todo»: vacía, con guion (algunas) o marcada (todas). */
export function headerCheckedState(
  rowIds: readonly string[],
  selected: readonly string[],
): HeaderCheckedState {
  const visible = new Set(rowIds)
  if (visible.size === 0 || selected.length === 0) return false
  let count = 0
  for (const id of new Set(selected)) if (visible.has(id)) count++
  if (count === 0) return false
  return count === visible.size ? true : 'indeterminate'
}

/** «1 elegido» · «3 elegidos» · «1.200 elegidos». */
export function selectionLabel(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'elegido' : 'elegidos'}`
}
