import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Importar plan: volver, encabezado y la tarjeta donde se pega el plan. */
export default function ImportarPlanLoading() {
  return (
    <PageShell>
      <Skeleton className="h-3 w-40" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <div className="card-hairline space-y-4 rounded-xl border bg-card p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-48 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-11 w-40 md:h-9" />
        </div>
      </div>
    </PageShell>
  )
}
