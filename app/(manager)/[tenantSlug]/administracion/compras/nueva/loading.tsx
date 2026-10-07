import { Skeleton } from '@/components/ui/skeleton'

/** La factura de proveedor mientras carga: el formulario a la izquierda y el asiento a la derecha. */
export default function NuevaCompraLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando el formulario…</span>
      <Skeleton className="h-3 w-16" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="card-hairline space-y-5 rounded-xl border bg-card p-5 sm:p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
          <div className="flex gap-2">
            {['a', 'b', 'c'].map((k) => (
              <Skeleton key={k} className="h-9 w-32 rounded-full" />
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
        <div className="card-hairline hidden space-y-3 rounded-xl border bg-card p-5 lg:block">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}
