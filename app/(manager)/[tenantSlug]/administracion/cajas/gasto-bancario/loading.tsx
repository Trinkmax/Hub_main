import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Gasto bancario: volver, encabezado, el formulario en tarjetas y el asiento a la derecha. */
export default function GastoBancarioLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-36" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6 sm:grid-cols-2">
            {['a', 'b'].map((k) => (
              <div key={k} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6 sm:grid-cols-2">
            {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
              <div key={k} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </PageShell>
  )
}
