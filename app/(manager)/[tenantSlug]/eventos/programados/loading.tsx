import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/**
 * La forma del calendario: encabezado con acciones, las pestañas, la tira de
 * formatos y el mes (grilla de 7 columnas en la compu, agenda en el celu).
 */
export default function Loading() {
  return (
    <PageShell width="wide" aria-busy="true">
      <SkeletonStatus label="Cargando el calendario…" />
      {/* Cómo funciona, buscar y programar evento. */}
      <SkeletonPageHeader actions={3} />
      <div aria-hidden className="flex flex-col gap-5">
        <div className="flex gap-6 border-b border-border pb-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 lg:p-5">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="size-(--control-md) rounded-md" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="size-(--control-md) rounded-md" />
          </div>
          <Skeleton className="mx-auto mb-3 h-(--control-sm) w-72 max-w-full" />
          <div className="flex flex-col gap-2 sm:hidden">
            {['a', 'b', 'c', 'd', 'e'].map((k) => (
              <Skeleton key={k} className="h-14 w-full rounded-lg" />
            ))}
          </div>
          <div className="hidden grid-cols-7 gap-1 sm:grid lg:gap-1.5">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={`dia-${i.toString()}`} className="min-h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  )
}
