import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton, PickerSkeleton } from '../_components/book-skeleton'

/** Historia: período, las píldoras de «qué» y la bitácora agrupada por día. */
export default function HistoriaLoading() {
  return (
    <BookSkeleton picker="none">
      <div className="space-y-3 py-2">
        <PickerSkeleton range />
        <div className="flex gap-1.5 overflow-hidden py-1 sm:flex-wrap">
          {['w-16', 'w-32', 'w-32', 'w-36', 'w-40', 'w-20'].map((w, i) => (
            <Skeleton
              key={`que-${i.toString()}`}
              className={`h-11 shrink-0 rounded-full md:pointer-fine:h-9 ${w}`}
            />
          ))}
        </div>
      </div>
      <div className="space-y-5">
        {['hoy', 'ayer'].map((day) => (
          <div key={day} className="space-y-1.5">
            <Skeleton className="ml-1 h-3 w-40" />
            <div className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
              {['a', 'b', 'c', 'd'].map((k) => (
                <div key={k} className="flex items-start gap-3 px-4 py-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-80 max-w-full" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="hidden h-4 w-24 sm:block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BookSkeleton>
  )
}
