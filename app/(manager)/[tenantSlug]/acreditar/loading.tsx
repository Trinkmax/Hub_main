import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Copia la pantalla de inicio del escáner: la explicación y los dos botones grandes. */
export default function Loading() {
  return (
    <PageShell width="compact" className="max-w-xl" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader />
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
      >
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-(--control-lg) w-full" />
          <Skeleton className="h-(--control-lg) w-full" />
        </div>
      </div>
    </PageShell>
  )
}
