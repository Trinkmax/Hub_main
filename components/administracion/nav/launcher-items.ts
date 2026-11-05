import type { AccountingAction } from '@/components/administracion/acciones/types'

/**
 * Lo que se puede cargar, con las palabras que ya usan en el bar (reunión del 29/10/2026): Compra,
 * Compra y pago, Pago. La Compra va primera porque «es lo que más usamos». Puro (sin React), para
 * poder fijar los textos y los destinos en un test.
 */

export type LauncherTarget =
  /** Una pantalla completa, después de `/administracion` (con barra inicial). */
  | { kind: 'route'; path: string }
  /** Una hoja de acción rápida sobre la pantalla donde estás. */
  | { kind: 'sheet'; action: AccountingAction }

export type LauncherItem = {
  key: string
  title: string
  /** Solo en las principales: cuándo se usa. */
  hint?: string
  target: LauncherTarget
  /** Las cuatro de todos los días. El resto va en una fila chica. */
  featured?: boolean
  /** La tecla del número, en la compu. */
  shortcut?: string
}

export const LAUNCHER_TITLE = '¿Qué cargás?'
export const LAUNCHER_DESCRIPTION = 'Elegí qué tenés en la mano.'
export const LAUNCHER_DROP_HINT = 'También podés arrastrar un archivo a cualquier pantalla.'

export const LAUNCHER_ITEMS: readonly LauncherItem[] = [
  {
    key: 'compra',
    title: 'Compra',
    hint: 'Me llegó una factura o remito y la pago después',
    target: { kind: 'route', path: '/compras/nueva' },
    featured: true,
    shortcut: '1',
  },
  {
    key: 'compra-y-pago',
    title: 'Compra y pago',
    hint: 'La pagué en el momento',
    target: { kind: 'route', path: '/compras/nueva?modo=pago' },
    featured: true,
    shortcut: '2',
  },
  {
    key: 'pago',
    title: 'Pago',
    hint: 'A un proveedor o un gasto fijo',
    target: { kind: 'sheet', action: 'pagar' },
    featured: true,
    shortcut: '3',
  },
  {
    key: 'cierre',
    title: 'Cierre del día',
    hint: 'Lo que se vendió y cómo te pagaron',
    target: { kind: 'route', path: '/ventas/cierre' },
    featured: true,
    shortcut: '4',
  },
  { key: 'sueldo', title: 'Adelanto o sueldo', target: { kind: 'route', path: '/sueldos' } },
  { key: 'cobrar', title: 'Entró plata', target: { kind: 'sheet', action: 'cobrar' } },
  {
    key: 'movimiento',
    title: 'Socio puso o sacó',
    target: { kind: 'sheet', action: 'movimiento' },
  },
  {
    key: 'banco',
    title: 'Gasto del banco',
    target: { kind: 'route', path: '/cajas/gasto-bancario' },
  },
  { key: 'ajustar', title: 'Contar la caja', target: { kind: 'sheet', action: 'ajustar' } },
]

/** Las principales y las demás, cada grupo en el orden de `LAUNCHER_ITEMS`. */
export function launcherGroups(items: readonly LauncherItem[] = LAUNCHER_ITEMS): {
  daily: LauncherItem[]
  sometimes: LauncherItem[]
} {
  return {
    daily: items.filter((item) => item.featured),
    sometimes: items.filter((item) => !item.featured),
  }
}

/** A dónde lleva una opción que abre pantalla (`null` si abre una hoja). */
export function launcherHref(base: string, target: LauncherTarget): string | null {
  return target.kind === 'route' ? `${base}${target.path}` : null
}
