import { BookSkeleton } from '../_components/book-skeleton'

/** Libro diario mientras carga: la barra y la planilla de asientos. */
export default function DiarioLoading() {
  return <BookSkeleton picker="range" rows={12} columns={5} />
}
