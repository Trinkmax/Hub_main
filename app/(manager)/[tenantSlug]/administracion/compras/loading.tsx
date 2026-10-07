import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Compras mientras carga: encabezado, pestañas, números, filtros y la lista. */
export default function ComprasLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando Compras y proveedores…</span>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="hidden gap-2 lg:flex">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="flex gap-4 border-b border-border/60 pb-3">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-5 w-24" />
        ))}
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-28 rounded-xl" />
        ))}
      </section>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-full" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
      <ListSkeleton rows={6} />
    </div>
  )
}
