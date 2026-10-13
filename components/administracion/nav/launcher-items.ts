import {
  ArrowLeftRight,
  BanknoteArrowDown,
  CircleEllipsis,
  FileClock,
  HandCoins,
  type LucideIcon,
  ReceiptText,
  Scale,
  ShoppingBasket,
} from 'lucide-react'
import type { AccountingAction } from '@/components/administracion/acciones/types'

/**
 * Las tarjetas del lanzador «¿Qué querés cargar?». Se entra por la SITUACIÓN («pagué algo
 * recién»), no por el nombre contable («nuevo gasto»): la duda de todos los días es «¿esto dónde
 * lo cargo?», y los menús de texto no la contestaban.
 *
 * Solo es la puerta: cada tarjeta abre una hoja que ya existe (`?accion=`) o una pantalla que ya
 * existe. Puro (sin React), para poder fijar los textos y los destinos en un test.
 */

export type LauncherTarget =
  /** Una pantalla completa, después de `/administracion` (con barra inicial). */
  | { kind: 'route'; path: string }
  /** Una hoja de acción rápida sobre la pantalla donde estás. */
  | { kind: 'sheet'; action: AccountingAction }

export type LauncherItem = {
  key: string
  title: string
  /** El ejemplo en gris: con qué cosa concreta se reconoce la situación. */
  hint: string
  icon: LucideIcon
  target: LauncherTarget
}

export const LAUNCHER_TITLE = '¿Qué querés cargar?'
export const LAUNCHER_DESCRIPTION = 'Elegí lo que pasó y te llevamos a donde se anota.'

export const LAUNCHER_ITEMS: readonly LauncherItem[] = [
  {
    key: 'cierre',
    title: 'Cerrar el día',
    hint: 'Lo que se vendió y cómo te pagaron',
    icon: ReceiptText,
    target: { kind: 'route', path: '/ventas/cierre' },
  },
  {
    key: 'gasto',
    title: 'Pagué algo recién',
    hint: 'El hielo, la verdulería, un flete',
    icon: ShoppingBasket,
    target: { kind: 'sheet', action: 'gasto' },
  },
  {
    key: 'compra',
    title: 'Me llegó una factura o un remito y lo pago después',
    hint: 'Queda como deuda con el proveedor',
    icon: FileClock,
    target: { kind: 'route', path: '/compras/nueva' },
  },
  {
    key: 'pagar',
    title: 'Pago algo que debía',
    hint: 'A un proveedor o un gasto fijo',
    icon: HandCoins,
    target: { kind: 'sheet', action: 'pagar' },
  },
  {
    key: 'cobrar',
    title: 'Me entró plata',
    hint: 'Una tarjeta, una app de delivery o un cliente',
    icon: BanknoteArrowDown,
    target: { kind: 'sheet', action: 'cobrar' },
  },
  {
    key: 'mover',
    title: 'Pasé plata de un lado a otro',
    hint: 'De la caja al banco, pagar la tarjeta',
    icon: ArrowLeftRight,
    target: { kind: 'sheet', action: 'mover' },
  },
  {
    key: 'ajustar',
    title: 'Conté la caja',
    hint: 'Para ver si coincide con el sistema',
    icon: Scale,
    target: { kind: 'sheet', action: 'ajustar' },
  },
  {
    key: 'movimiento',
    title: 'Otra cosa',
    hint: 'Un socio puso o sacó plata',
    icon: CircleEllipsis,
    target: { kind: 'sheet', action: 'movimiento' },
  },
]

/** A dónde lleva una tarjeta que abre pantalla (`null` si abre una hoja). */
export function launcherHref(base: string, target: LauncherTarget): string | null {
  return target.kind === 'route' ? `${base}${target.path}` : null
}
