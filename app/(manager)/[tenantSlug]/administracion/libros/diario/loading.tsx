import { BookSkeleton } from '../_components/book-skeleton'

/** Libro diario: período y la tabla agrupada por asiento. */
export default function DiarioLoading() {
  return <BookSkeleton picker="range" rows={12} columns={6} />
}
