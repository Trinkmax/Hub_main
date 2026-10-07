import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonText,
} from '@/components/ui/skeleton'

/** Copia Reseñas: los tres números y la distribución, el filtro por estrellas y la lista. */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={1} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <SkeletonKPIGroup count={3} columns={3} />
        <div
          aria-hidden="true"
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <Skeleton className="h-3 w-24" />
          {['w-full', 'w-3/4', 'w-1/2', 'w-1/3', 'w-1/4'].map((width) => (
            <Skeleton key={width} className={`h-2 ${width}`} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton aria-hidden="true" className="h-6 w-48" />
        <Skeleton aria-hidden="true" className="h-(--control-md) w-full max-w-md" />
        <div
          aria-hidden="true"
          className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
        >
          {['r1', 'r2', 'r3', 'r4'].map((key) => (
            <div key={key} className="flex flex-col gap-3 px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <SkeletonText lines={2} className="max-w-prose" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
