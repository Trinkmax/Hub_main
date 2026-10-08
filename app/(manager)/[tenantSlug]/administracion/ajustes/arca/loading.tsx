import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * «Conectar ARCA» mientras carga: volver, el encabezado, las dos tarjetas de arriba, el riel de
 * pasos (en la compu) o la barra (en el celular) y dos pasos. La forma real, sin spinner.
 */
export default function ConectarArcaLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-11 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <div className="card-hairline hidden space-y-3 rounded-xl border bg-card p-4 lg:block">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-2 w-full" />
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => (
            <div key={k} className="flex items-center gap-2.5 py-1.5">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-4">
          <Skeleton className="h-16 rounded-xl lg:hidden" />
          {['a', 'b'].map((k) => (
            <div key={k} className="card-hairline space-y-4 rounded-xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              {k === 'a' ? (
                <>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="aspect-[720/330] w-full rounded-lg" />
                  <Skeleton className="h-4 w-2/3" />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
