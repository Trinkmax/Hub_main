import { BookSkeleton } from '../_components/book-skeleton'

/** Libro diario: período, la banda de totales y la tabla agrupada por asiento. */
export default function DiarioLoading() {
  return <BookSkeleton picker="range" stats={3} rows={12} columns={6} />
}
