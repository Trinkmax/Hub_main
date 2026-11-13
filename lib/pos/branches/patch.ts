/**
 * Cambiar un dato de una sucursal sin pisar a nadie — PURO y testeado
 * (`tests/lib/pos-branches-patch.test.ts`).
 *
 * En la ficha de una sucursal cada dato se guarda solo. Cada cambio viaja con lo que la
 * persona veía (`expected`), y el servidor decide mirando la fila de AHORA:
 *
 *   · sigue como lo veía → se escribe;
 *   · ya está como lo quería → no hay nada que escribir;
 *   · cambió a otra cosa → no se escribe nada, y se le muestra cómo quedó.
 */

import { colorName } from './palette'
import type { Branch, BranchChange, BranchField, BranchValues } from './types'

/** La columna de `branches` de cada dato. */
export const BRANCH_COLUMN: Readonly<Record<BranchField, string>> = {
  name: 'name',
  shortName: 'short_name',
  color: 'color',
  address: 'address',
  active: 'active',
}

type AnyValue = BranchValues[BranchField]

/** Los textos comparan tal cual; el color, sin distinguir mayúsculas. */
function sameValue(field: BranchField, a: AnyValue, b: AnyValue): boolean {
  if (field === 'color' && typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase()
  }
  return a === b
}

export function branchValues(branch: Branch): BranchValues {
  return {
    name: branch.name,
    shortName: branch.shortName,
    color: branch.color,
    address: branch.address,
    active: branch.active,
  }
}

export type BranchPatchPlan =
  | {
      kind: 'write'
      /** Solo los datos que de verdad cambian. */
      fields: BranchField[]
      /** Los datos como quedan. */
      next: BranchValues
    }
  | { kind: 'noop' }
  | { kind: 'conflict'; fields: BranchField[] }

/** Qué hacer con un cambio, mirando la sucursal de ahora. */
export function planBranchPatch(
  current: Branch,
  changes: ReadonlyArray<BranchChange>,
): BranchPatchPlan {
  const now = branchValues(current)
  const next: Record<BranchField, AnyValue> = { ...now }
  const fields: BranchField[] = []
  const conflicts: BranchField[] = []

  for (const change of changes) {
    if (sameValue(change.field, now[change.field], change.value)) continue
    if (!sameValue(change.field, now[change.field], change.expected)) {
      conflicts.push(change.field)
      continue
    }
    next[change.field] = change.value
    fields.push(change.field)
  }

  if (conflicts.length > 0) return { kind: 'conflict', fields: conflicts }
  if (fields.length === 0) return { kind: 'noop' }
  return { kind: 'write', fields, next: next as BranchValues }
}

/** Lo que se escribe en la base: solo las columnas que cambian. */
export function branchColumns(
  fields: ReadonlyArray<BranchField>,
  next: BranchValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of fields) patch[BRANCH_COLUMN[field]] = next[field]
  return patch
}

/** El cambio contrario: es lo que hace «Deshacer». */
export function invertBranchChanges(changes: ReadonlyArray<BranchChange>): BranchChange[] {
  return changes.map(
    (change) =>
      ({ field: change.field, value: change.expected, expected: change.value }) as BranchChange,
  )
}

/**
 * Un cambio en una línea, para el aviso que aparece cuando se guarda solo. `name` es como se
 * llama la sucursal DESPUÉS del cambio.
 */
export function describeBranchChange(change: BranchChange, name: string): string {
  switch (change.field) {
    case 'name':
      return `${change.expected} ahora se llama ${change.value}`
    case 'shortName':
      return change.value
        ? `${name}: en el salón se lee «${change.value}»`
        : `${name}: en el salón se lee el nombre entero`
    case 'color':
      return `${name}: ahora es ${colorName(change.value).toLocaleLowerCase('es')}`
    case 'address':
      return change.value ? `${name}: dirección guardada` : `${name}: dirección borrada`
    case 'active':
      return change.value ? `${name} volvió a estar activa` : `${name} quedó desactivada`
  }
}
