import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Ajustes: volver, encabezado, las pestañas y una tarjeta de formulario. */
export default function AjustesLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-2 overflow-hidden border-b border-border/60 pb-2">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
          <Skeleton key={k} className="h-7 w-28 shrink-0" />
        ))}
      </div>
      <div className="card-hairline max-w-4xl space-y-5 rounded-xl border bg-card p-6">
        {['a', 'b', 'c', 'd'].map((k) => (
          <div key={k} className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
    </PageShell>
  )
}
