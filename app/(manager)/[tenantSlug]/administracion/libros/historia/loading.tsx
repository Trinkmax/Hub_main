import { ListSkeleton } from '@/components/ui/skeleton-list'
import { BookSkeleton } from '../_components/book-skeleton'

/** Historia: período, quién y qué, y la lista de movimientos. */
export default function HistoriaLoading() {
  return (
    <BookSkeleton picker="range" filters>
      <ListSkeleton rows={8} />
    </BookSkeleton>
  )
}
