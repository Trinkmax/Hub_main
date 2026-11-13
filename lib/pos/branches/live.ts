/**
 * Lo que se ve en «Sucursales» mientras algo se guarda — PURO y testeado
 * (`tests/lib/pos-branches-live.test.ts`).
 *
 * La pantalla muestra la última lectura de la base con, encima, lo que la persona acaba de
 * cambiar (`lib/pos/settings/overlay.ts`). Acá están las llaves de cada dato y cómo se arman
 * las sucursales y los ajustes «de ahora» a partir de las dos cosas.
 */

import { type Overlay, overlayRead } from '@/lib/pos/settings/overlay'
import { type PosSettings, SETTING_KEYS, type SettingKey } from '@/lib/pos/settings/types'
import { sortBranches } from './order'
import type { Branch, BranchFacts, BranchField, BranchValues } from './types'

/** La fila entera de una sucursal: recién creada, o `null` si se acaba de borrar. */
export const rowKey = (branchId: string) => `sucursal:${branchId}`
/** Un dato de la ficha. */
export const fieldKey = (branchId: string, field: BranchField) => `sucursal:${branchId}:${field}`
/** Un ajuste del punto de venta. */
export const settingKey = (key: SettingKey) => `ajuste:${key}`

const FIELDS: ReadonlyArray<BranchField> = ['name', 'shortName', 'color', 'address', 'active']
const ROW = /^sucursal:([^:]+)$/

/**
 * Las sucursales como se ven ahora: las leídas, más las recién creadas, menos las recién
 * borradas, y con los datos que se están guardando puestos encima.
 */
export function liveBranches(base: ReadonlyArray<Branch>, overlay: Overlay): Branch[] {
  const rows = new Map(base.map((branch) => [branch.id, branch]))
  for (const [key, entry] of Object.entries(overlay)) {
    const id = ROW.exec(key)?.[1]
    if (!id) continue
    if (entry.value === null) rows.delete(id)
    else rows.set(id, entry.value as Branch)
  }
  const merged = [...rows.values()].map((branch) => {
    let next = branch
    for (const field of FIELDS) {
      const key = fieldKey(branch.id, field)
      if (!(key in overlay)) continue
      next = {
        ...next,
        [field]: overlayRead<BranchValues[typeof field]>(overlay, key, next[field]),
      }
    }
    return next
  })
  return sortBranches(merged)
}

/** Los ajustes como se ven ahora. */
export function liveSettings(base: PosSettings, overlay: Overlay): PosSettings {
  let next = base
  for (const key of SETTING_KEYS) {
    const at = settingKey(key)
    if (!(at in overlay)) continue
    next = { ...next, [key]: overlayRead(overlay, at, base[key]) }
  }
  return next
}

/** Una sucursal recién creada todavía no tiene nada cargado. */
export function emptyFacts(cashReady: boolean): BranchFacts {
  return {
    sectors: 0,
    tables: 0,
    looseTables: 0,
    openTables: 0,
    hasHistory: false,
    unavailable: 0,
    ownPrices: 0,
    kitchenSeenAt: null,
    registers: cashReady ? 0 : null,
  }
}
