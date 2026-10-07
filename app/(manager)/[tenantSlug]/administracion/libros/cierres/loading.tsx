import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton } from '../_components/book-skeleton'

/** Cierres: el panel del próximo mes (checklist y botón) y la lista de meses por ejercicio. */
export default function CierresLoading() {
  return (
    <BookSkeleton picker="none" width="comfortable">
      <div className="card-hairline rounded-xl border bg-card">
        <div className="space-y-2 border-b border-border/60 px-5 py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="space-y-3 px-5 py-4">
          {['a', 'b', 'c'].map((k) => (
            <div key={k} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 w-80 max-w-[70%]" />
              <Skeleton className="ml-auto h-8 w-20" />
            </div>
          ))}
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
        <div className="flex justify-end border-t border-border/60 px-5 py-4">
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
      <div className="card-hairline rounded-xl border bg-card">
        <div className="space-y-2 border-b border-border/60 px-5 py-4">
          <Skeleton className="h-5 w-64 max-w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="divide-y divide-border/60">
          {['1', '2', '3', '4'].map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-5 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </BookSkeleton>
  )
}
