/**
 * Armar un cambio de ajustes desde la pantalla — PURO.
 *
 * Un cambio lleva siempre lo que la persona veía (`expected`): es lo que el servidor compara
 * con la base para no pisar a otro dueño.
 */

import type { PosSettings, SettingChange, SettingKey } from './types'

/** «Este ajuste, a este valor», partiendo de los ajustes que hay en pantalla. */
export function settingChange<K extends SettingKey>(
  settings: PosSettings,
  key: K,
  value: PosSettings[K],
): SettingChange {
  return { key, value, expected: settings[key] } as SettingChange
}

/** Sumar o sacar un elemento de una lista, sin repetirlo. */
export function toggleIn<T>(list: ReadonlyArray<T>, item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]
}
