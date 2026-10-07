import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

// Mismo `PageShell width="comfortable"` que la page: si el contenedor no
// coincide, el layout salta cuando entran los datos. Copia la barra de control,
// los cuatro KPIs, el gráfico y la tabla por día.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div className="flex flex-col gap-8">
        <div aria-hidden="true" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-(--control-sm) w-52" />
            <Skeleton className="h-(--control-sm) w-56" />
            <Skeleton className="h-(--control-sm) w-64" />
            <Skeleton className="ms-auto h-(--control-sm) w-28" />
          </div>
          <Skeleton className="h-3 w-96 max-w-full" />
        </div>
        <SkeletonKPIGroup count={4} columns={4} />
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <SkeletonTable rows={6} columns={6} mobile="scroll" />
        </div>
      </div>
    </PageShell>
  )
}
