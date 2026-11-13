/**
 * Guardar un ajuste sin pisar a nadie — PURO y testeado (`tests/lib/pos-settings-patch.test.ts`).
 *
 * Cada cambio viaja con lo que la persona veía en la pantalla (`expected`). El servidor lee
 * los ajustes de AHORA y decide con esta cuenta:
 *
 *   · sigue como lo veía → se escribe;
 *   · ya está como lo quería (otro dueño hizo lo mismo) → no hay nada que escribir;
 *   · cambió a otra cosa → no se escribe NADA de ese gesto, y se le muestra cómo quedó.
 *
 * Un gesto puede mover más de un ajuste a la vez (los dos tiempos de «esperando la comida»):
 * van juntos o no va ninguno.
 */

import { PAY_METHODS } from '@/lib/pos/cash/types'
import { billsAllowed, normalizeBills } from './bills'
import {
  APPROVER_ROLES,
  type ApproverRole,
  type PosSettings,
  type SettingChange,
  type SettingKey,
  sameSetting,
} from './types'

/** Cuántas propinas sugeridas entran en la pantalla de cobro. */
export const MAX_TIP_PRESETS = 4

/** La forma en que se guarda cada ajuste: listas ordenadas, sin repetidos, el dueño siempre. */
export function normalizeSetting<K extends SettingKey>(
  key: K,
  value: PosSettings[K],
): PosSettings[K] {
  switch (key) {
    case 'invoiceByMethod': {
      const map = value as PosSettings['invoiceByMethod']
      const full = Object.fromEntries(PAY_METHODS.map((method) => [method, Boolean(map[method])]))
      return full as PosSettings[K]
    }
    case 'tipPresetsPct': {
      const list = value as PosSettings['tipPresetsPct']
      return [...new Set(list)].sort((a, b) => a - b) as PosSettings[K]
    }
    case 'approverRoles': {
      // El dueño puede dar el OK siempre (lo decide la base), así que siempre está en la lista.
      const chosen = new Set<ApproverRole>(['owner', ...(value as PosSettings['approverRoles'])])
      return APPROVER_ROLES.filter((role) => chosen.has(role)) as PosSettings[K]
    }
    case 'billDenominations':
      return normalizeBills(value as PosSettings['billDenominations']) as PosSettings[K]
    default:
      return value
  }
}

/** Los ajustes con esos cambios puestos encima (para verlos antes de que el servidor conteste). */
export function applyChanges(
  settings: PosSettings,
  changes: ReadonlyArray<SettingChange>,
): PosSettings {
  const next: PosSettings = { ...settings }
  for (const change of changes) put(next, change.key, normalizeSetting(change.key, change.value))
  return next
}

/** Escribe un ajuste cuando la clave llega como unión (el valor ya viene emparejado con ella). */
function put(target: PosSettings, key: SettingKey, value: PosSettings[SettingKey]): void {
  ;(target as Record<SettingKey, PosSettings[SettingKey]>)[key] = value
}

/** El gesto contrario: es lo que hace «Deshacer». */
export function invertChanges(changes: ReadonlyArray<SettingChange>): SettingChange[] {
  return changes.map(
    (change) =>
      ({ key: change.key, value: change.expected, expected: change.value }) as SettingChange,
  )
}

export type PatchPlan =
  | {
      kind: 'write'
      /** Solo los ajustes que de verdad cambian. */
      keys: SettingKey[]
      /** Los ajustes como quedan. */
      next: PosSettings
    }
  /** Ya estaba todo como se pidió. */
  | { kind: 'noop' }
  /** Alguien cambió alguno de estos después de que la pantalla los leyera. */
  | { kind: 'conflict'; keys: SettingKey[] }
  /** Los valores, juntos, no pasan una regla. */
  | { kind: 'invalid'; message: string }

/** Qué hacer con un gesto, mirando los ajustes de ahora. */
export function planSettingsPatch(
  current: PosSettings,
  changes: ReadonlyArray<SettingChange>,
): PatchPlan {
  const conflicts: SettingKey[] = []
  const keys: SettingKey[] = []
  const next: PosSettings = { ...current }

  for (const change of changes) {
    const now = current[change.key]
    const wanted = normalizeSetting(change.key, change.value)
    if (sameSetting(change.key, now, wanted)) continue
    if (!sameSetting(change.key, now, change.expected)) {
      conflicts.push(change.key)
      continue
    }
    put(next, change.key, wanted)
    keys.push(change.key)
  }

  if (conflicts.length > 0) return { kind: 'conflict', keys: conflicts }
  if (keys.length === 0) return { kind: 'noop' }

  if (next.kitchenLateMinutes < next.kitchenWarnMinutes) {
    return {
      kind: 'invalid',
      message:
        'En «esperando la comida» la mesa no puede ponerse roja antes de avisar. Subí primero el segundo tiempo.',
    }
  }
  if (
    keys.includes('billDenominations') &&
    !billsAllowed(next.billDenominations, current.billDenominations)
  ) {
    return {
      kind: 'invalid',
      message:
        next.billDenominations.length === 0
          ? 'Dejá al menos un billete: sin billetes no se puede contar la caja.'
          : 'Ese billete no está en la lista. Recargá la página y probá de nuevo.',
    }
  }
  return { kind: 'write', keys, next }
}
