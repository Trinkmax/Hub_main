/**
 * El orden de las sucursales y lo que se puede hacer con cada una — PURO y testeado
 * (`tests/lib/pos-branches-order.test.ts`).
 *
 * En toda la app (el salón, la tele, Precios) las sucursales salen con la principal primero y
 * después por `position` y nombre (`listBranches`). Acá se respeta esa misma regla: ordenar es
 * acomodar las que NO son la principal.
 */

import type { Branch, BranchFacts } from './types'

/** El mismo orden que `listBranches`: la principal, después posición y nombre. */
export function sortBranches<T extends Pick<Branch, 'isDefault' | 'position' | 'name'>>(
  branches: ReadonlyArray<T>,
): T[] {
  return [...branches].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      a.position - b.position ||
      a.name.localeCompare(b.name, 'es'),
  )
}

/** Las abiertas, en orden; y las desactivadas aparte, también en orden. */
export function splitBranches<T extends Pick<Branch, 'isDefault' | 'position' | 'name' | 'active'>>(
  branches: ReadonlyArray<T>,
): { active: T[]; inactive: T[] } {
  const sorted = sortBranches(branches)
  return {
    active: sorted.filter((branch) => branch.active),
    inactive: sorted.filter((branch) => !branch.active),
  }
}

/**
 * ¿Hacia dónde se puede correr una sucursal en la lista? La principal no se mueve (va siempre
 * primera) y nada le pasa por delante; las desactivadas no tienen lugar en la lista.
 */
export function moveOptions(
  branches: ReadonlyArray<Pick<Branch, 'id' | 'isDefault' | 'position' | 'name' | 'active'>>,
  id: string,
): { earlier: boolean; later: boolean; place: number; of: number } {
  const { active } = splitBranches(branches)
  const index = active.findIndex((branch) => branch.id === id)
  const target = active[index]
  const of = active.length
  if (!target || target.isDefault) return { earlier: false, later: false, place: index + 1, of }
  const first = active[0]?.isDefault ? 1 : 0
  return { earlier: index > first, later: index < of - 1, place: index + 1, of }
}

/**
 * Correr una sucursal un lugar. Devuelve el orden nuevo de TODAS (ids): las abiertas como
 * quedan y las desactivadas al final, sin cambiar entre ellas. `null` si no se puede mover.
 */
export function moveBranch(
  branches: ReadonlyArray<Pick<Branch, 'id' | 'isDefault' | 'position' | 'name' | 'active'>>,
  id: string,
  direction: -1 | 1,
): string[] | null {
  const options = moveOptions(branches, id)
  if (direction === -1 ? !options.earlier : !options.later) return null
  const { active, inactive } = splitBranches(branches)
  const ids = active.map((branch) => branch.id)
  const from = ids.indexOf(id)
  const to = from + direction
  const moved = ids[from]
  const swapped = ids[to]
  if (moved === undefined || swapped === undefined) return null
  ids[from] = swapped
  ids[to] = moved
  return [...ids, ...inactive.map((branch) => branch.id)]
}

/**
 * Las posiciones que hay que escribir para que las sucursales queden en ese orden: solo las
 * que cambian. Los ids que no son del bar se ignoran; las que no se nombran van al final.
 */
export function positionWrites(
  branches: ReadonlyArray<Pick<Branch, 'id' | 'position' | 'isDefault' | 'name'>>,
  order: ReadonlyArray<string>,
): Array<{ id: string; position: number }> {
  const known = new Map(branches.map((branch) => [branch.id, branch]))
  const named = [...new Set(order)].filter((id) => known.has(id))
  const rest = sortBranches(branches)
    .map((branch) => branch.id)
    .filter((id) => !named.includes(id))
  const writes: Array<{ id: string; position: number }> = []
  for (const [position, id] of [...named, ...rest].entries()) {
    if (known.get(id)?.position !== position) writes.push({ id, position })
  }
  return writes
}

export type Verdict = { ok: true } | { ok: false; why: string }

const YES: Verdict = { ok: true }

const tables = (n: number) => (n === 1 ? '1 mesa abierta' : `${n} mesas abiertas`)

/**
 * ¿Se puede desactivar? La principal no (es donde cae todo lo que no dice sucursal) y una con
 * mesas abiertas tampoco (quedarían colgadas: el salón deja de mostrarla).
 */
export function canDeactivate(
  branch: Pick<Branch, 'isDefault' | 'active' | 'name'>,
  facts: Pick<BranchFacts, 'openTables'>,
): Verdict {
  if (!branch.active) return { ok: false, why: 'Ya está desactivada.' }
  if (branch.isDefault) {
    return {
      ok: false,
      why: 'Es la principal. Elegí otra como principal y después desactivala.',
    }
  }
  if (facts.openTables > 0) {
    return {
      ok: false,
      why: `Tiene ${tables(facts.openTables)}. Cerralas y después desactivala.`,
    }
  }
  return YES
}

/** ¿Puede ser la principal? Tiene que estar abierta. */
export function canBeDefault(branch: Pick<Branch, 'isDefault' | 'active'>): Verdict {
  if (branch.isDefault) return { ok: false, why: 'Ya es la principal.' }
  if (!branch.active) return { ok: false, why: 'Está desactivada. Activala primero.' }
  return YES
}

/**
 * ¿Se puede borrar? Solo una sucursal vacía (recién creada, o creada por error). Con plano,
 * mesas o historia no se borra nada: se desactiva y queda guardada.
 */
export function canDelete(
  branch: Pick<Branch, 'isDefault'>,
  facts: Pick<BranchFacts, 'sectors' | 'tables' | 'looseTables' | 'hasHistory'>,
): Verdict {
  if (branch.isDefault) return { ok: false, why: 'La principal no se borra.' }
  const has: string[] = []
  if (facts.sectors > 0) has.push(facts.sectors === 1 ? '1 sector' : `${facts.sectors} sectores`)
  const allTables = facts.tables + facts.looseTables
  if (allTables > 0) has.push(allTables === 1 ? '1 mesa' : `${allTables} mesas`)
  if (has.length > 0) {
    return {
      ok: false,
      why: `Tiene ${has.join(' y ')}: no se borra, se desactiva y queda guardada.`,
    }
  }
  if (facts.hasHistory) {
    return {
      ok: false,
      why: 'Ya tuvo mesas abiertas: no se borra, se desactiva y su historia queda guardada.',
    }
  }
  return YES
}
