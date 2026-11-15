import type { TenantRole } from '@/lib/tenant/types'
import type { ResolvedNavGroup, ResolvedNavItem } from '../nav-config'
import { activeSectionTab, type ResolvedSection, type SectionKey } from '../section-tabs-config'

/**
 * Qué va en la barra de abajo del celular (panel de gestión) y qué queda en «Más». Puro: lo usan el shell
 * (en el servidor, con la cookie) y los tests.
 *
 * - Si la persona tiene una sola sección sin pestañas (la contadora, quien edita la carta), no hay barra:
 *   no hay a dónde cambiar.
 * - Si tiene una o dos secciones y alguna tiene pestañas (la anfitriona: Reservas y Mis números), esas
 *   pestañas van sueltas en la barra. Es lo que necesita: Reservas · Operativo · Calendario · Ventas ·
 *   Números, cada una a un toque.
 * - Si le entran todas (hasta cinco), van todas y no hay «Más».
 * - Si no, cuatro y «Más». Cada socio elige sus cuatro (la cookie); si no eligió, van las del rol.
 *
 * Lo que abre en otra pestaña del navegador («Salón en vivo», «Cocina») nunca va en la barra: una pestaña
 * que te saca de la app no es una pestaña. Queda en «Más».
 */

/** Cuántas pestañas entran en la cápsula en un celular de 360 px sin cortar los nombres. */
export const DOCK_SLOTS = 5
/** Con «Más», las pestañas propias son una menos. */
export const DOCK_PINNED = DOCK_SLOTS - 1
/** Con hasta tantas secciones, las pestañas de adentro van sueltas en la barra. */
const FLATTEN_UP_TO = 2

/**
 * Las cuatro de cada rol si no eligió otras. Para el dueño salen de lo que de verdad se usa en HUB
 * (audit_log, 15/10–14/11/2026): 673 reservas cargadas por 9 socios y 480 «Llegó» marcados desde el
 * Operativo por 7 (las dos cosas viven en Reservas desde el 15/11), y la ficha de clientes tocada por 9.
 */
export const DEFAULT_DOCK: Partial<Record<TenantRole, readonly string[]>> = {
  owner: ['resumen', 'reservas', 'clientes', 'estadisticas'],
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

/**
 * Una pestaña de la barra: una sección del menú, o una pestaña de adentro de una sección que va suelta
 * (`tab`, con cómo se reconoce la página: exacta, por prefijo, rutas extra).
 */
export type DockEntry = ResolvedNavItem & {
  tab?: { exact?: boolean; alsoHrefs?: string[] }
}

/** Las secciones cuyas pestañas van sueltas en la barra (sus píldoras de arriba sobran en el celular). */
export function flattenedSections(plan: DockPlan | null): SectionKey[] {
  if (!plan) return []
  return [
    ...new Set(plan.bar.flatMap((entry) => (entry.tab && entry.section ? [entry.section] : []))),
  ]
}

export type DockPlan = {
  /** Las pestañas de la barra, en orden. */
  bar: DockEntry[]
  /** Lo que se abre desde «Más» (vacío: no hay «Más»). */
  more: ResolvedNavItem[]
}

/** Las secciones con pestañas de quien mira, ya resueltas (`resolveSection`). */
export type DockSections = Partial<Record<SectionKey, ResolvedSection>>

/** Las pestañas de adentro de una sección, como pestañas de la barra. */
function flatten(item: ResolvedNavItem, sections: DockSections): DockEntry[] {
  const section = item.section ? sections[item.section] : undefined
  if (!section || section.tabs.length < 2) return [item]
  return section.tabs.map((tab) => ({
    key: `${item.key}-${tab.value}`,
    label: tab.label,
    short: tab.shortLabel,
    href: tab.href,
    iconKey: tab.iconKey ?? item.iconKey,
    section: item.section,
    tab: { exact: tab.exact, alsoHrefs: tab.alsoHrefs },
  }))
}

export function planDock(
  groups: readonly ResolvedNavGroup[],
  role: TenantRole,
  chosen: readonly string[] | null,
  sections: DockSections = {},
): DockPlan | null {
  const all = groups.flatMap((group) => group.items)
  const tabs = all.filter((item) => !item.newTab)

  // Una o dos secciones: lo que hay adentro va suelto (si entra).
  if (tabs.length <= FLATTEN_UP_TO && all.length === tabs.length) {
    const flat = tabs.flatMap((item) => flatten(item, sections))
    if (flat.length >= 2 && flat.length <= DOCK_SLOTS) return { bar: flat, more: [] }
  }
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
 * Qué pestaña de la barra se marca: la pestaña suelta que reconoce la URL; si no, la de la sección de la
 * página abierta si está en la barra; «Más» si la sección vive ahí; ninguna si no es de ninguna sección.
 */
export function dockActiveKey(
  plan: DockPlan,
  activeHref: string | null,
  pathname = '',
): string | null {
  const loose = plan.bar.filter((entry) => entry.tab)
  if (loose.length > 0) {
    const hit = activeSectionTab(
      loose.map((entry) => ({
        value: entry.key,
        href: entry.href,
        exact: entry.tab?.exact,
        alsoHrefs: entry.tab?.alsoHrefs,
      })),
      pathname,
    )
    if (hit) return hit
  }
  if (!activeHref) return null
  const inBar = plan.bar.find((item) => !item.tab && item.href === activeHref)
  if (inBar) return inBar.key
  if (plan.more.some((item) => item.href === activeHref)) return MORE_KEY
  return null
}

/** La clave de «Más» en la barra. */
export const MORE_KEY = 'more'
