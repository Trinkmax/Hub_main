import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Anchos de las cuatro pestañas (Por día · Por evento · Pauta · Cumpleaños). */
const TAB_WIDTHS = [
  ['dia', 'w-14'],
  ['evento', 'w-20'],
  ['pauta', 'w-12'],
  ['cumples', 'w-20'],
] as const

// Mismo `PageShell width="comfortable"` que la page: si el contenedor no
// coincide, el layout salta cuando entran los datos. Copia «Por día» (la vista
// por defecto): volver + título, las pestañas con «Exportar», el día con su
// selector y la ficha de la noche.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div aria-hidden="true" className="space-y-5">
        <div className="flex items-end justify-between gap-3">
          <div className="flex h-10 flex-1 items-center gap-4 border-b border-border">
            {TAB_WIDTHS.map(([key, w]) => (
              <Skeleton key={key} className={`h-3 ${w}`} />
            ))}
          </div>
          <Skeleton className="mb-1 h-(--control-sm) w-28" />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pt-3">
          <div className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-56" />
          </div>
          <Skeleton className="h-(--control-md) w-64" />
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </PageShell>
  )
}
