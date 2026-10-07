import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** Subdiarios: las pestañas, el período y la tabla ancha. */
export default function SubdiariosLoading() {
  return (
    <BookSkeleton picker="none">
      <div className="flex gap-2 border-b border-border/60 pb-2">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
          <Skeleton key={k} className="h-8 w-24" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-60 rounded-xl" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-44 rounded-full" />
      </div>
      <TableSkeleton rows={10} columns={9} />
    </BookSkeleton>
  )
}
