import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

// Copia la liquidación: volver + título, el selector de período, los tres
// totales y la tabla por gestor. Mismo `PageShell` que la página.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div className="flex flex-col gap-8">
        <div aria-hidden="true" className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-(--control-md) w-64" />
          <Skeleton className="h-3 w-56" />
        </div>
        <SkeletonKPIGroup count={3} columns={3} />
        <div aria-hidden="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid items-start gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
            <Skeleton className="h-72 w-full rounded-xl" />
            <SkeletonTable rows={5} columns={6} mobile="scroll" />
          </div>
        </div>
      </div>
    </PageShell>
  )
}
