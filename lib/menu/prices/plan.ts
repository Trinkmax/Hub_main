/**
 * Qué se escribe y qué no cuando llega un pedido de cambio de precios, puro. El servidor lee
 * lo que hay AHORA en la base y con eso decide, precio por precio:
 *
 * - si el producto ya no está → no se cambia (`missing`);
 * - si ya vale lo que se pidió → no hay nada que escribir;
 * - si vale otra cosa que la que la persona estaba viendo → no se pisa (`changed`): dos socios
 *   cambiando precios a la vez no se borran el trabajo sin enterarse;
 * - si no, se escribe.
 *
 * Los precios de la carta se agrupan por «de cuánto a cuánto»: un aumento de 230 productos se
 * escribe en unas pocas decenas de idas a la base, no en 230.
 */

import { type PriceWriteFailure, pointKey } from './types'

export type RequestedChange = {
  itemId: string
  branchId: string | null
  /** Lo que tiene que quedar. En una sucursal, `null` = volver al precio de la carta. */
  priceCents: number | null
  /** Lo que la persona veía escrito ahí. En una sucursal, `null` = sin precio propio. */
  expectedCents: number | null
}

export type CurrentPrices = {
  /** Producto → precio de la carta. Lo que no está acá no existe (o es de otro bar). */
  menu: ReadonlyMap<string, number>
  /** `pointKey(sucursal, producto)` → precio propio. Sin fila = `null`. */
  own: ReadonlyMap<string, number | null>
}

export type MenuWrite = { expectedCents: number; priceCents: number; itemIds: string[] }
export type BranchWrite = {
  branchId: string
  itemId: string
  priceCents: number | null
  fromCents: number | null
}

export type WritePlan = {
  menuWrites: MenuWrite[]
  branchWrites: BranchWrite[]
  failed: PriceWriteFailure[]
}

export function planPriceWrites(
  requested: ReadonlyArray<RequestedChange>,
  current: CurrentPrices,
): WritePlan {
  const groups = new Map<string, MenuWrite>()
  const branchWrites: BranchWrite[] = []
  const failed: PriceWriteFailure[] = []

  for (const change of requested) {
    const { itemId, branchId } = change
    const menuCents = current.menu.get(itemId)
    if (menuCents === undefined) {
      failed.push({ itemId, branchId, reason: 'missing' })
      continue
    }

    if (branchId === null) {
      // El precio de la carta nunca queda vacío (el borde ya lo rechaza; acá no se escribe).
      if (change.priceCents === null) {
        failed.push({ itemId, branchId, reason: 'error' })
        continue
      }
      if (menuCents === change.priceCents) continue
      if (menuCents !== change.expectedCents) {
        failed.push({ itemId, branchId, reason: 'changed', currentCents: menuCents })
        continue
      }
      const key = `${menuCents}:${change.priceCents}`
      const group = groups.get(key)
      if (group) group.itemIds.push(itemId)
      else {
        groups.set(key, {
          expectedCents: menuCents,
          priceCents: change.priceCents,
          itemIds: [itemId],
        })
      }
      continue
    }

    const ownCents = current.own.get(pointKey(branchId, itemId)) ?? null
    if (ownCents === change.priceCents) continue
    if (ownCents !== change.expectedCents) {
      failed.push({ itemId, branchId, reason: 'changed', currentCents: ownCents })
      continue
    }
    branchWrites.push({ branchId, itemId, priceCents: change.priceCents, fromCents: ownCents })
  }

  return { menuWrites: [...groups.values()], branchWrites, failed }
}

/** Parte una lista en tandas de a lo sumo `size`. */
export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size))
  return out
}

/** Corre tareas de a `limit` por vez y devuelve los resultados en el orden de entrada. */
export async function runLimited<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
