import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton } from '../_components/book-skeleton'

/** Asiento manual: el tipo, fecha y concepto, la grilla de líneas y el pie que cuadra. */
export default function AsientoManualLoading() {
  return (
    <BookSkeleton picker="none" width="comfortable">
      <div className="card-hairline grid gap-6 rounded-xl border bg-card p-4 sm:p-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <div className="flex flex-wrap gap-2">
            {['a', 'b', 'c'].map((k) => (
              <Skeleton key={k} className="h-11 w-24 rounded-full" />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-5 w-20" />
          {['1', '2'].map((k) => (
            <Skeleton key={k} className="h-11 w-full" />
          ))}
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
    </BookSkeleton>
  )
}
