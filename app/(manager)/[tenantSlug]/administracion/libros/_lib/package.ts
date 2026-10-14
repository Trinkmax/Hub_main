import { plural } from '@/components/administracion/format'
import {
  EXPORT_BOOK_INFO,
  type ExportBook,
  type ExportParams,
  exportHref,
  MONTH_PACKAGE_BOOKS,
} from '@/lib/accounting/queries/labels'
import { formatDate, formatMonthLabel, minIsoDay } from '@/lib/dates'

/**
 * El «Paquete del mes» (F.15), puro: los 15 archivos que se le mandan a la
 * contadora, con el período que pide cada uno y su link de descarga. Lo usan
 * `/libros` (el índice y «Descargar el paquete del mes») y «Fin de mes» (el
 * paso 3), para que los dos bajen EXACTAMENTE lo mismo.
 *
 * Antes vivía suelto en `libros/page.tsx`; se movió sin cambiar un parámetro.
 */

export type PackageMonth = { month: string; from: string; to: string }

/** Los parámetros de período que pide cada libro del paquete. */
export function exportParamsFor(
  libro: ExportBook,
  month: PackageMonth,
  today: string,
): ExportParams {
  switch (EXPORT_BOOK_INFO[libro].period) {
    case 'mes':
      return { mes: month.month }
    case 'rango':
      return { desde: month.from, hasta: month.to }
    case 'fecha':
      // Un saldo «al cierre» de un mes en curso es el de hoy: no existe el saldo de mañana.
      return { hasta: minIsoDay(month.to, today) }
    default:
      return {}
  }
}

/** El nombre del archivo si el servidor no manda uno. */
export function exportFileName(tenantSlug: string, libro: ExportBook, month: string): string {
  return `administracion-${tenantSlug}-${libro}-${month}.csv`
}

export type PackageFile = {
  libro: ExportBook
  title: string
  description: string
  href: string
  fileName: string
  /** Sin la CUIT del bar este archivo no se puede descargar (409). */
  needsCuit: boolean
}

/** El link y el nombre de UN libro para un mes (del paquete o no: «Ventas por medio», Historia). */
export function bookExport(
  tenantSlug: string,
  libro: ExportBook,
  month: PackageMonth,
  today: string,
): PackageFile {
  const info = EXPORT_BOOK_INFO[libro]
  return {
    libro,
    title: info.title,
    description: info.description,
    href: exportHref(tenantSlug, libro, exportParamsFor(libro, month, today)),
    fileName: exportFileName(tenantSlug, libro, month.month),
    needsCuit: Boolean(info.needsSasCuit),
  }
}

/** Los 15 archivos del paquete, en el orden de `MONTH_PACKAGE_BOOKS`. */
export function packageFiles(
  tenantSlug: string,
  month: PackageMonth,
  today: string,
): PackageFile[] {
  return MONTH_PACKAGE_BOOKS.map((libro) => bookExport(tenantSlug, libro, month, today))
}

/** Los que se pueden descargar hoy: sin la CUIT, los de IVA quedan afuera. */
export function downloadablePackage(
  files: readonly PackageFile[],
  hasCuit: boolean,
): PackageFile[] {
  return hasCuit ? [...files] : files.filter((f) => !f.needsCuit)
}

/** «15 archivos» · «10 de 15»: lo que dice la pastilla del botón. */
export function packageCountText(total: number, downloadable: number): string {
  if (downloadable >= total) return plural(total, 'archivo', 'archivos')
  return `${downloadable} de ${total}`
}

/** «Septiembre 2026 · cerrado el 05/10/2026 por Franco» · «Octubre 2026 · mes abierto…». */
export function packageStatusLine(
  month: string,
  pkg: {
    status: 'open' | 'closed' | 'missing'
    closedAt: string | null
    closedByName: string | null
  },
): string {
  const label = formatMonthLabel(month)
  if (pkg.status === 'open') {
    return `${label} · mes abierto: los números pueden cambiar hasta que se cierre`
  }
  if (pkg.status !== 'closed') return label
  const when = pkg.closedAt ? ` el ${formatDate(pkg.closedAt)}` : ''
  const who = pkg.closedByName ? ` por ${pkg.closedByName}` : ''
  return `${label} · cerrado${when}${who}`
}

type CountUnit = 'asientos' | 'cuentas' | 'comprobantes' | 'filas' | 'proveedores' | 'clientes'

const UNIT_SINGULAR: Readonly<Record<CountUnit, string>> = {
  asientos: 'asiento',
  cuentas: 'cuenta',
  comprobantes: 'comprobante',
  filas: 'fila',
  proveedores: 'proveedor',
  clientes: 'cliente',
}

/** «35 asientos» · «Sin movimientos» · «Sin contar todavía»; `null` si el libro no se cuenta. */
export function countText(file: { rows: number | null; unit: CountUnit | null }): string | null {
  if (file.unit === null) return null
  if (file.rows === null) return 'Sin contar todavía'
  if (file.rows === 0) return 'Sin movimientos'
  return plural(file.rows, UNIT_SINGULAR[file.unit], file.unit)
}
