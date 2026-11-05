import { BookSkeleton } from '../_components/book-skeleton'

/** Libro IVA mientras carga: el segmento y el mes, el totalizador y la planilla. */
export default function IvaBookLoading() {
  return <BookSkeleton picker="month" totals={4} rows={10} columns={8} />
}
