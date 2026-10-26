import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Mismas tarjetas que la pestaña: cartelera, Mercado Pago, películas, ventas y configuración. */
export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Marketing"
        title="Entradas online"
        description={<Skeleton className="h-4 w-[30rem] max-w-full" />}
      />
      <Skeleton className="h-36 w-full rounded-xl lg:h-28" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="card-hairline space-y-3 rounded-xl border bg-card p-4 sm:p-5">
        <Skeleton className="h-6 w-40" />
        {[0, 1].map((n) => (
          <div key={n} className="flex gap-4 rounded-xl border border-border/60 p-3 sm:p-4">
            <Skeleton className="aspect-[2/3] w-16 shrink-0 rounded-lg sm:w-20" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
              <div className="flex flex-wrap gap-2 pt-1">
                {[0, 1, 2].map((m) => (
                  <Skeleton key={m} className="h-16 w-[8.75rem] rounded-lg" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </PageShell>
  )
}
