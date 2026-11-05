/**
 * Ventas son tres solapas (las dibuja `AdmNav`: Proyección, Por cobrar y Lo que llegó) y dos
 * pantallas a las que se llega desde el «⋯» de la planilla (Facturas y Cobros). Los siete valores de
 * `?tab=` siguen valiendo tal cual (los citan el Resumen, la guía, Libros, los comprobantes y ⌘K):
 * acá está a qué vista lleva cada uno y qué viene abierto. Puro: lo prueba
 * `administracion-ventas-vista.test.ts`.
 */

import {
  hrefWith,
  type PageSearchParams,
  type RangeValue,
  resolveRange,
} from '@/components/administracion/cajas-ventas/periods'
import { monthName, monthOf } from '@/lib/dates'

export const VENTAS_TABS = [
  'cierres',
  'proyeccion',
  'caja',
  'clientes',
  'cobros',
  'neto-por-medio',
  'facturas',
] as const
export type VentasTab = (typeof VENTAS_TABS)[number]

export type VentasViewKey = 'mes' | 'cobrar' | 'llego' | 'cobros' | 'facturas'
/** Lo que pide la URL de la planilla: las dos pestañas viejas que hoy son su detalle. */
export type VentasFocus = 'proyeccion' | 'caja'

/** `?tab=` de la URL; lo que no es una pestaña conocida cae en la planilla. */
export function parseTab(value: string | null | undefined): VentasTab {
  return (VENTAS_TABS as readonly string[]).includes(value ?? '') ? (value as VentasTab) : 'cierres'
}

const TAB_VIEW: Readonly<Record<VentasTab, { view: VentasViewKey; focus: VentasFocus | null }>> = {
  cierres: { view: 'mes', focus: null },
  proyeccion: { view: 'mes', focus: 'proyeccion' },
  caja: { view: 'mes', focus: 'caja' },
  clientes: { view: 'cobrar', focus: null },
  'neto-por-medio': { view: 'llego', focus: null },
  cobros: { view: 'cobros', focus: null },
  facturas: { view: 'facturas', focus: null },
}

/** A qué vista lleva una pestaña de las de siempre, y qué trae abierto. */
export function ventasView(tab: VentasTab): { view: VentasViewKey; focus: VentasFocus | null } {
  return TAB_VIEW[tab]
}

/** El nombre de cada vista: el `<h1>` para lectores (lo que se ve es la solapa). */
export const VIEW_TITLES: Readonly<Record<VentasViewKey, string>> = {
  mes: 'Proyección',
  cobrar: 'Por cobrar',
  llego: 'Lo que llegó',
  cobros: 'Cobros',
  facturas: 'Facturas',
}

/** El link de una pestaña de Ventas (`cierres` va sin `?tab=`, como siempre). */
export function tabHref(
  base: string,
  tab: VentasTab,
  params: Readonly<Record<string, string | number | null | undefined>> = {},
): string {
  return hrefWith(`${base}/ventas`, { tab: tab === 'cierres' ? null : tab, ...params })
}

// ─── El detalle de la planilla ───────────────────────────────────────────────

/**
 * ¿La planilla abre con el detalle a la vista? Por defecto no; `?tab=proyeccion` y `?tab=caja` (los
 * links de siempre) sí, porque esas columnas eran lo que abrían. `?detalle=` manda sobre las dos.
 */
export function parseDetail(value: string | null, focus: VentasFocus | null): boolean {
  if (value === '1') return true
  if (value === '0') return false
  return focus !== null
}

/** El `?detalle=` de un estado del interruptor: sin parámetro si es lo que ya abre esa URL. */
export function detailParam(detail: boolean, focus: VentasFocus | null): string | null {
  if (detail) return focus === null ? '1' : null
  return focus === null ? null : '0'
}

// ─── El período de las vistas con rango ──────────────────────────────────────

/** El período de una vista con rango: el de la URL o, si está roto, el mes en curso para elegir de nuevo. */
export function rangeOrError(sp: PageSearchParams, today: string) {
  const range = resolveRange(sp, today)
  const picker: RangeValue = range.ok
    ? range
    : { kind: 'month', month: monthOf(today), from: today, to: today, label: '' }
  return { range, picker }
}

/** El período dicho de corrido: «en octubre» / «en ese período». */
export function periodWords(range: RangeValue): string {
  if (range.kind === 'month' && range.month) {
    return `en ${monthName(Number(range.month.slice(5, 7)))}`
  }
  return 'en ese período'
}
