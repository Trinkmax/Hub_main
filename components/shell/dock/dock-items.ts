import type { TenantRole } from '@/lib/tenant/types'
import type { ResolvedNavGroup, ResolvedNavItem } from '../nav-config'

/**
 * Qué va en la barra de abajo del celular (panel de gestión) y qué queda en «Más». Puro: lo usan el shell
 * (en el servidor, con la cookie) y los tests.
 *
 * - Si la persona tiene una sola sección (la contadora, quien edita la carta), no hay barra: no hay a dónde
 *   cambiar.
 * - Si le entran todas (hasta cinco, como la anfitriona), van todas y no hay «Más».
 * - Si no, cuatro y «Más». Cada socio elige sus cuatro (la cookie); si no eligió, van las del rol.
 *
 * Lo que abre en otra pestaña del navegador («Salón en vivo», «Cocina») nunca va en la barra: una pestaña
 * que te saca de la app no es una pestaña. Queda en «Más».
 */

/** Cuántas pestañas entran en la cápsula en un celular de 360 px sin cortar los nombres. */
export const DOCK_SLOTS = 5
/** Con «Más», las pestañas propias son una menos. */
export const DOCK_PINNED = DOCK_SLOTS - 1

/**
 * Las cuatro de cada rol si no eligió otras. Para el dueño salen de lo que de verdad se usa en HUB
 * (audit_log, 15/10–14/11/2026): 673 reservas cargadas por 9 socios, 480 «Llegó» marcados desde el
 * Operativo por 7, y la ficha de clientes tocada por 9.
 */
export const DEFAULT_DOCK: Partial<Record<TenantRole, readonly string[]>> = {
  owner: ['resumen', 'operativo', 'reservas', 'clientes'],
}

/** La cookie de la barra elegida, una por bar (alguien puede estar en dos con roles distintos). */
export function dockCookieName(slug: string): string {
  return `hub_dock_${slug}`
}

const KEY = /^[a-z0-9-]{1,40}$/

/** Lee la cookie (`resumen.reservas.calendario.clientes`). Basura → null. */
export function parseDockCookie(value: string | null | undefined): string[] | null {
  if (!value) return null
  const keys = [
    ...new Set(
      value
        .split('.')
        .map((key) => key.trim())
        .filter((key) => KEY.test(key)),
    ),
  ]
  return keys.length > 0 ? keys.slice(0, DOCK_PINNED) : null
}

export function serializeDockCookie(keys: readonly string[]): string {
  return keys.filter((key) => KEY.test(key)).join('.')
}

export type DockPlan = {
  /** Las pestañas de la barra, en orden. */
  bar: ResolvedNavItem[]
  /** Lo que se abre desde «Más» (vacío: no hay «Más»). */
  more: ResolvedNavItem[]
}

export function planDock(
  groups: readonly ResolvedNavGroup[],
  role: TenantRole,
  chosen: readonly string[] | null,
): DockPlan | null {
  const all = groups.flatMap((group) => group.items)
  const tabs = all.filter((item) => !item.newTab)
  if (tabs.length <= 1) return null

  if (all.length <= DOCK_SLOTS && tabs.length === all.length) return { bar: tabs, more: [] }

  const byKey = new Map(tabs.map((item) => [item.key, item]))
  const bar: ResolvedNavItem[] = []
  for (const key of chosen ?? DEFAULT_DOCK[role] ?? []) {
    const item = byKey.get(key)
    if (item && !bar.includes(item) && bar.length < DOCK_PINNED) bar.push(item)
  }
  // Si faltan (eligió menos, o alguna ya no la ve), se completa con las primeras del menú.
  for (const item of tabs) {
    if (bar.length >= DOCK_PINNED) break
    if (!bar.includes(item)) bar.push(item)
  }
  const inBar = new Set(bar.map((item) => item.key))
  return { bar, more: all.filter((item) => !inBar.has(item.key)) }
}

/**
 * Qué pestaña de la barra se marca: la de la página abierta si está en la barra; «Más» si la página es de
 * una sección que vive ahí; ninguna si no es de ninguna sección.
 */
export function dockActiveKey(plan: DockPlan, activeHref: string | null): string | null {
  if (!activeHref) return null
  const inBar = plan.bar.find((item) => item.href === activeHref)
  if (inBar) return inBar.key
  if (plan.more.some((item) => item.href === activeHref)) return MORE_KEY
  return null
}

/** La clave de «Más» en la barra. */
export const MORE_KEY = 'more'
