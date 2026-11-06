import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** La misma forma que la pantalla: encabezado, el resumen de lo que falta y las tarjetas. */
export default function ProveedoresLoading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Compras"
        title="Proveedores"
        description={<Skeleton className="h-4 w-[26rem] max-w-full" />}
        actions={<Skeleton className="h-11 flex-1 sm:w-44 sm:flex-none md:h-10" />}
      />
      <div className="card-hairline space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
        <Skeleton className="h-6 w-72 max-w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid gap-3 lg:grid-cols-2">
          {['a', 'b', 'c', 'd'].map((card) => (
            <div
              key={card}
              className="card-hairline space-y-3 rounded-xl border bg-card p-4 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-44" />
              <div className="flex gap-1">
                {['lu', 'ma', 'mi', 'ju', 'vi', 'sa', 'do'].map((day) => (
                  <Skeleton key={day} className="size-7 rounded-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
