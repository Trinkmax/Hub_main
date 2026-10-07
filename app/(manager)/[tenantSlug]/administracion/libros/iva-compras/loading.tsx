import { BookSkeleton } from '../_components/book-skeleton'

/** Libro IVA compras: el mes, la franja de totales y el libro. */
export default function IvaComprasLoading() {
  return <BookSkeleton picker="month" stats={4} rows={10} columns={8} />
}
