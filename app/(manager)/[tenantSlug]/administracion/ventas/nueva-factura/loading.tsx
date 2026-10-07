import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Factura de venta: volver, encabezado, el formulario en tarjetas y el asiento a la derecha. */
export default function NuevaFacturaLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Skeleton className="h-14 w-full rounded-xl" />
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-36 rounded-full" />
              <Skeleton className="h-9 w-32 rounded-full" />
            </div>
            <Skeleton className="h-11 w-full" />
            <div className="grid gap-5 sm:grid-cols-3">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
          <div className="card-hairline grid gap-5 rounded-xl border bg-card p-6">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-8 w-40 justify-self-end" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </PageShell>
  )
}
