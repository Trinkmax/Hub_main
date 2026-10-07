import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Detalle de un asiento: cabecera, las líneas Debe/Haber y las partidas. */
export default function AsientoLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-36" />
      <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
      </div>
      <div className="card-hairline rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="space-y-3 px-4 py-4">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-56 max-w-[60%]" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
    </PageShell>
  )
}
