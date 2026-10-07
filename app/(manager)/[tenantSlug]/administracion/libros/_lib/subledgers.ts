import type { SubledgerColumn, SubledgerKindKey } from '@/lib/accounting/queries/columns'
import type { ExportBook } from '@/lib/accounting/queries/labels'
import { formatIsoDay } from '@/lib/dates'
import { formatCents } from '@/lib/money'

/**
 * Los subdiarios en pantalla (H.12, F.8): la pestaña de la URL (`?tipo=`), su
 * subdiario en la base, su exporte y cómo se lee cada celda que no es plata.
 * Puro (lo prueban los tests).
 */

export type SubledgerTab = {
  /** Lo que va en `?tipo=`. */
  value: string
  kind: SubledgerKindKey
  label: string
  shortLabel?: string
  exportBook: ExportBook
  /** Qué hay, para el vacío. */
  empty: string
}

export const SUBLEDGER_TABS: readonly SubledgerTab[] = [
  {
    value: 'compras',
    kind: 'purchases',
    label: 'Compras',
    exportBook: 'subdiario-compras',
    empty: 'Facturas, notas de crédito y débito y gastos de contado.',
  },
  {
    value: 'pagos',
    kind: 'payments',
    label: 'Pagos',
    exportBook: 'subdiario-pagos',
    empty: 'Lo que se les pagó a proveedores, organismos y sueldos.',
  },
  {
    value: 'ventas',
    kind: 'sales',
    label: 'Ventas',
    exportBook: 'subdiario-ventas',
    empty: 'Los cierres del día y las facturas sueltas.',
  },
  {
    value: 'ventas-por-medio',
    kind: 'sales_by_method',
    label: 'Ventas por medio',
    shortLabel: 'Por medio',
    exportBook: 'subdiario-ventas-medios',
    empty: 'Lo vendido con cada medio de cobro, día por día.',
  },
  {
    value: 'cobranzas',
    kind: 'collections',
    label: 'Cobranzas',
    exportBook: 'subdiario-cobranzas',
    empty: 'Los cobros y las acreditaciones, con sus descuentos.',
  },
  {
    value: 'cajas',
    kind: 'treasury',
    label: 'Cajas y bancos',
    shortLabel: 'Cajas',
    exportBook: 'subdiario-disponibilidades',
    empty: 'Lo que entró y salió de cada caja o cuenta.',
  },
]

/** `?tipo=` → la pestaña; sin nada o algo raro, Compras. */
export function subledgerTab(raw: string | null): SubledgerTab {
  const found = SUBLEDGER_TABS.find((t) => t.value === raw)
  return found ?? (SUBLEDGER_TABS[0] as SubledgerTab)
}

type ListItem = { label: string; amountCents: number | null }
type Cell = string | number | boolean | null | readonly ListItem[]

/** «#125»: la referencia interna de un comprobante. */
export function isRefColumn(column: SubledgerColumn): boolean {
  return column.header === 'Ref. interna'
}

/** El saldo acumulado (no se suma en los totales: va el último). */
export function isRunningBalanceColumn(column: SubledgerColumn): boolean {
  return column.header === 'Saldo'
}

/**
 * Una celda que no es plata, como texto: fechas `dd/MM/yyyy`, la referencia
 * como `#125`, las listas («Caja: $ 1.000,00 · Banco: $ 500,00»), sí/no.
 * Vacío si no hay dato (la tabla muestra la celda en blanco).
 */
export function subledgerCellText(cell: Cell, column: SubledgerColumn): string {
  if (cell === null || cell === undefined) return ''
  if (Array.isArray(cell)) {
    return (cell as readonly ListItem[])
      .map((item) =>
        item.amountCents === null
          ? item.label
          : `${item.label ? `${item.label}: ` : ''}${formatCents(item.amountCents)}`,
      )
      .filter(Boolean)
      .join(' · ')
  }
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No'
  if (column.type === 'date' && typeof cell === 'string') return formatIsoDay(cell.slice(0, 10))
  if (isRefColumn(column) && (typeof cell === 'number' || typeof cell === 'string')) {
    const text = String(cell).trim()
    return text ? `#${text}` : ''
  }
  return String(cell)
}

/** El importe de una celda de plata (o `null` si no hay número). */
export function subledgerCellCents(cell: Cell): number | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell
  return null
}
