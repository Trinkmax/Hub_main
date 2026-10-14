/**
 * Ventas dejó de ser siete pestañas y pasó a ser cuatro vistas: «El mes»,
 * «Plata por cobrar», «Lo que llegó» y «Facturas». Los siete valores de
 * `?tab=` siguen valiendo tal cual (los citan el Resumen, la guía, Libros, los
 * comprobantes y ⌘K): acá está a qué vista lleva cada uno y qué bloque trae a
 * la vista. Puro: lo prueba `administracion-ventas-vista.test.ts`.
 */

import { hrefWith } from '@/components/administracion/cajas-ventas/periods'

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

export type VentasViewKey = 'mes' | 'cobrar' | 'llego' | 'facturas'
/** El bloque que se trae a la vista al entrar (su ancla es `#proyeccion`, `#caja`, `#cobros`). */
export type VentasFocus = 'proyeccion' | 'caja' | 'cobros'

/** `?tab=` de la URL; lo que no es una pestaña conocida cae en «El mes». */
export function parseTab(value: string | null | undefined): VentasTab {
  return (VENTAS_TABS as readonly string[]).includes(value ?? '') ? (value as VentasTab) : 'cierres'
}

const TAB_VIEW: Readonly<Record<VentasTab, { view: VentasViewKey; focus: VentasFocus | null }>> = {
  cierres: { view: 'mes', focus: null },
  proyeccion: { view: 'mes', focus: 'proyeccion' },
  caja: { view: 'mes', focus: 'caja' },
  clientes: { view: 'cobrar', focus: null },
  'neto-por-medio': { view: 'llego', focus: null },
  cobros: { view: 'llego', focus: 'cobros' },
  facturas: { view: 'facturas', focus: null },
}

/** A qué vista lleva una pestaña de las de siempre, y qué bloque trae a la vista. */
export function ventasView(tab: VentasTab): { view: VentasViewKey; focus: VentasFocus | null } {
  return TAB_VIEW[tab]
}

/** La pestaña «de arriba» de cada vista: la que usan las píldoras. */
export const VIEW_TAB: Readonly<Record<VentasViewKey, VentasTab>> = {
  mes: 'cierres',
  cobrar: 'clientes',
  llego: 'neto-por-medio',
  facturas: 'facturas',
}

export const VIEW_ORDER: readonly VentasViewKey[] = ['mes', 'cobrar', 'llego', 'facturas']

export const VIEW_COPY: Readonly<
  Record<VentasViewKey, { label: string; shortLabel?: string; description: string }>
> = {
  mes: {
    label: 'El mes',
    description: 'Cada noche con su cierre, cómo viene el mes y lo que falta cargar.',
  },
  cobrar: {
    label: 'Plata por cobrar',
    shortLabel: 'Por cobrar',
    description: 'Lo que te deben las tarjetas, las apps y los clientes, y qué día llega.',
  },
  llego: {
    label: 'Lo que llegó',
    description: 'Lo que ya te depositaron y cuánto se quedó cada medio en el camino.',
  },
  facturas: {
    label: 'Facturas',
    description:
      'Cuánto de lo vendido fue con factura, cuánto sin, y las facturas que se hicieron aparte.',
  },
}

/** Qué vistas miran un mes: entre ellas el `?mes=` elegido se conserva. */
const USES_MONTH: Readonly<Record<VentasViewKey, boolean>> = {
  mes: true,
  cobrar: false,
  llego: true,
  facturas: true,
}

/** El link de una pestaña de Ventas (`cierres` va sin `?tab=`, como siempre). */
export function tabHref(
  base: string,
  tab: VentasTab,
  params: Readonly<Record<string, string | number | null | undefined>> = {},
): string {
  return hrefWith(`${base}/ventas`, { tab: tab === 'cierres' ? null : tab, ...params })
}

/**
 * El link de una vista. `month` es el `?mes=` que está en la URL (si hay): se
 * conserva entre las vistas que miran un mes, y no se inventa si no estaba.
 */
export function viewHref(base: string, view: VentasViewKey, month: string | null = null): string {
  return tabHref(base, VIEW_TAB[view], { mes: USES_MONTH[view] ? month : null })
}
