import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Cierre del día: volver, encabezado, el día con sus flechas, medios, facturado y el asiento. */
export default function CierreDelDiaLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-11 w-72 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <Skeleton className="h-5 w-28" />
            {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
              <div key={k} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
            <Skeleton className="h-8 w-40 justify-self-end" />
          </div>
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-36 w-full rounded-lg" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </PageShell>
  )
}
