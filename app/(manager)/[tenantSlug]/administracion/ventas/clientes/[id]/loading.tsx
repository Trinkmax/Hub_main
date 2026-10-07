import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Ficha de un cliente o plataforma: volver, cabecera, números, antigüedad, pestañas y estado de cuenta. */
export default function ClienteLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <Skeleton className="h-3 w-48" />
      <div className="card-hairline flex items-start gap-4 rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="hidden h-8 w-40 sm:block" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((k) => (
          <div key={k} className="card-hairline space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-9 w-80 max-w-full rounded-lg" />
      <ListSkeleton rows={6} />
    </div>
  )
}
