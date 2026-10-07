import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando las etiquetas…" />
      <WaSkeletonPageHeader />
      {/* «Nueva etiqueta»: nombre, colores y el botón */}
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-(--control-md) w-full rounded-md" />
        <div className="flex flex-wrap gap-2.5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <Skeleton key={i} className="size-8 rounded-full" />
          ))}
        </div>
        <Skeleton className="ms-auto h-(--control-md) w-40 rounded-md" />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4 border-t border-border pt-6">
        <Skeleton className="h-5 w-32" />
        <SkeletonTable rows={4} columns={2} />
      </div>
    </PageShell>
  )
}
