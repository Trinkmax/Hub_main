import { Skeleton } from '@/components/ui/skeleton'

/** La ficha del proveedor mientras carga: cabecera, números, pestañas y el estado de cuenta. */
export default function SupplierLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando el proveedor…</span>
      <Skeleton className="h-3 w-32" />
      <div className="card-hairline space-y-3 rounded-xl border bg-card p-5 sm:p-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-3 w-28" />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-28 rounded-xl" />
        ))}
      </section>
      <div className="flex gap-4 border-b border-border/60 pb-3">
        {['a', 'b', 'c'].map((k) => (
          <Skeleton key={k} className="h-5 w-28" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-xl rounded-full" />
      <div className="card-hairline rounded-xl border bg-card">
        <div className="divide-y divide-border/60">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <div key={k} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
