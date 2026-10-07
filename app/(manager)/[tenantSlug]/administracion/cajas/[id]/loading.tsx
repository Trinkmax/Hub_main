import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Movimientos de una caja: volver, la cabecera, tres números, el período y la lista. */
export default function CajaLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Skeleton className="h-3 w-36" />
      <div className="card-hairline flex items-start gap-4 rounded-xl border bg-card p-5 sm:p-6">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="hidden space-y-2 sm:block">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="card-hairline space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-56 rounded-xl" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
      </div>
      <ListSkeleton rows={8} />
    </div>
  )
}
