import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Las pantallas de subida mientras cargan: volver, encabezado, pasos y la zona del archivo. */
export function UploadPageSkeleton({
  label,
  extraCard = false,
}: {
  label: string
  extraCard?: boolean
}) {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando {label}…</span>
      <Skeleton className="h-3 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {extraCard ? <Skeleton className="h-20 w-full rounded-xl" /> : null}
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}

/** La revisión de un lote mientras carga: encabezado, números, filtros y la lista. */
export function ReviewPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando la revisión…</span>
      <Skeleton className="h-3 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-28 rounded-xl" />
        ))}
      </section>
      <div className="flex gap-4 border-b border-border/60 pb-3">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-5 w-24" />
        ))}
      </div>
      <ListSkeleton rows={6} />
    </div>
  )
}
