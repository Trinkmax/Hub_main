import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

// Copia «Mis números»: título, el selector de período, los cuatro KPIs y la
// lista reserva por reserva. Mismo `PageShell` que la página.
export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader />
      <div aria-hidden="true" className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-(--control-md) w-64" />
        <Skeleton className="h-3 w-48" />
      </div>
      <SkeletonKPIGroup count={4} columns={4} />
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-11 w-full rounded-xl" />
        <SkeletonTable rows={5} columns={6} />
      </div>
    </PageShell>
  )
}
