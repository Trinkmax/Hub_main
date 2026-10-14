import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** Sumas y saldos: período, las píldoras de nivel de detalle, la banda de control y el balance. */
export default function SumasYSaldosLoading() {
  return (
    <BookSkeleton picker="range" stats={1}>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-3 w-24" />
        {['a', 'b', 'c', 'd', 'e'].map((k) => (
          <Skeleton key={k} className="h-11 w-11 rounded-full md:pointer-fine:size-9" />
        ))}
        <Skeleton className="h-11 w-48 rounded-full md:pointer-fine:h-9" />
      </div>
      <TableSkeleton rows={12} columns={5} />
    </BookSkeleton>
  )
}
