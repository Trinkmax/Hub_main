import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton } from '../_components/book-skeleton'

/** Posición de IVA: el mes, la cascada hasta «A pagar», la liquidación y la conciliación. */
export default function PosicionIvaLoading() {
  return (
    <BookSkeleton picker="month" width="comfortable">
      <div className="card-hairline rounded-xl border bg-card">
        <div className="space-y-2 border-b border-border/60 px-5 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="space-y-3 px-5 py-4">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-7 w-40" />
          </div>
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </BookSkeleton>
  )
}
