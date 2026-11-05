import { BookSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** El IVA mientras carga: el segmento y el mes, el totalizador y los dos libros. */
export default function PosicionIvaLoading() {
  return (
    <BookSkeleton picker="month" totals={4}>
      <TableSkeleton rows={2} columns={5} />
    </BookSkeleton>
  )
}
