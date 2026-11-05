import { bookHref } from '../_lib/periods'
import { SegLinks } from './seg'

const ITEMS = [
  { key: 'posicion-iva', label: 'Posición' },
  { key: 'iva-compras', label: 'Compras' },
  { key: 'iva-ventas', label: 'Ventas' },
] as const

/** Adentro de la solapa IVA: Posición · Compras · Ventas, con el mismo mes. Las rutas siguen. */
export function IvaTabs({
  booksPath,
  month,
  active,
}: {
  /** `/<bar>/administracion/libros`. */
  booksPath: string
  /** `yyyy-MM`. */
  month: string
  active: (typeof ITEMS)[number]['key']
}) {
  return (
    <SegLinks
      label="IVA"
      items={ITEMS.map((item) => ({
        key: item.key,
        label: item.label,
        href: bookHref(`${booksPath}/${item.key}`, { mes: month }),
        active: item.key === active,
      }))}
    />
  )
}
