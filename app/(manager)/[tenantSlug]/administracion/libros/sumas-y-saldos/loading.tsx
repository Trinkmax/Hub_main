import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** Sumas y saldos: período, los chips de nivel y el balance. */
export default function SumasYSaldosLoading() {
  return (
    <BookSkeleton picker="range">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-3 w-10" />
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-11 w-11 rounded-full" />
        ))}
        <Skeleton className="h-11 w-48 rounded-full" />
      </div>
      <TableSkeleton rows={12} columns={5} />
    </BookSkeleton>
  )
}
