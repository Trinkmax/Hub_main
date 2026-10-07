import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Detalle de un comprobante: cabecera con el total, renglones, pagos, asiento e historia. */
export default function ComprobanteLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-36" />
      <div className="card-hairline rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="mt-5 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {['lines', 'side'].map((k) => (
          <div key={k} className="card-hairline rounded-xl border bg-card">
            <div className="border-b border-border/60 px-5 py-4">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="divide-y divide-border/60">
              {['1', '2', '3'].map((r) => (
                <div key={r} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </PageShell>
  )
}
