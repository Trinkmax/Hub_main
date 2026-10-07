import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Libros: encabezado, el mes, la grilla de libros y el paquete del mes. */
export default function LibrosLoading() {
  return (
    <PageShell>
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-11 w-64 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
          <div key={k} className="card-hairline space-y-3 rounded-xl border bg-card p-6">
            <Skeleton className="size-10 rounded-lg" />
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-full" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
      <ListSkeleton rows={5} />
    </PageShell>
  )
}
