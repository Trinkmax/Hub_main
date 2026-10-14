import { ViewPills } from '@/components/administracion/kit/view-pills'
import { type BookKey, type BookPeriod, bookSwitcherItems } from '../_lib/book-nav'

/**
 * La fila «entre libros»: Diario · Mayor · Sumas y saldos · Subdiarios · IVA
 * compras · IVA ventas · Posición de IVA · Historia, con el libro que se está
 * mirando relleno en tinta. Lleva el período puesto: pasar del diario al mayor
 * del mismo mes es un toque (antes eran cuatro, volviendo al índice).
 *
 * Es la herramienta de la contadora: no depende de datos, así que también la
 * dibuja el esqueleto. Server-safe.
 */
export function BookSwitcher({
  booksPath,
  active,
  period,
  className,
}: {
  /** `/<bar>/administracion/libros`. */
  booksPath: string
  /** El libro abierto; `null` en una pantalla que no es un libro de la fila. */
  active: BookKey | null
  period: BookPeriod
  className?: string
}) {
  return (
    <ViewPills
      label="Libros"
      items={bookSwitcherItems(booksPath, active, period)}
      className={className}
    />
  )
}
