import { BookSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** Subdiarios: el título con su vuelta, el tipo, el período y la tabla ancha. */
export default function SubdiariosLoading() {
  return (
    <BookSkeleton picker="range" heading filters>
      <TableSkeleton rows={10} columns={9} />
    </BookSkeleton>
  )
}
