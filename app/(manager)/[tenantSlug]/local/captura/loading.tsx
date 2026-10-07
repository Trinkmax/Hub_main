import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

/** Copia la página de los QR: encabezado y las dos tarjetas (QR, título, link y botones). */
export default function Loading() {
  return (
    <PageShell width="compact" className="max-w-4xl" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader />
      <div aria-hidden="true" className="grid gap-6 sm:grid-cols-2">
        {['carta', 'club'].map((key) => (
          <div
            key={key}
            className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-4 sm:p-6"
          >
            <Skeleton className="size-44 rounded-lg" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-(--control-md) w-36" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}
