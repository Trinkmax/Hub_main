import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Ventas y clientes: encabezado, pestañas, el mes, la fila de números y el calendario. */
export default function VentasLoading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden border-b border-border/60 pb-3">
        {['a', 'b', 'c', 'd', 'e'].map((k) => (
          <Skeleton key={k} className="h-5 w-24 shrink-0" />
        ))}
      </div>
      <Skeleton className="h-11 w-60 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((k) => (
          <div key={k} className="card-hairline space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="card-hairline rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="hidden grid-cols-7 gap-1.5 p-3 sm:grid">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={`d-${i.toString()}`} className="h-[4.5rem] rounded-lg" />
          ))}
        </div>
        <div className="divide-y divide-border/60 sm:hidden">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <div key={k} className="flex items-center justify-between px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
