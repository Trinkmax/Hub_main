import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Puesta en marcha: encabezado, los pasos y la tarjeta del formulario. */
export default function ConfigurarLoading() {
  return (
    <PageShell width="compact">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="card-hairline space-y-5 rounded-xl border bg-card p-6">
        <Skeleton className="h-6 w-40" />
        {['a', 'b', 'c', 'd'].map((k) => (
          <div key={k} className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
    </PageShell>
  )
}
