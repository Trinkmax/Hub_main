import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando las plantillas…" />
      <WaSkeletonPageHeader actions={2} />
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-2">
        {['t1', 't2', 't3', 't4'].map((k) => (
          <div key={k} className="overflow-clip rounded-xl border border-border bg-card">
            <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-20 rounded-sm" />
            </div>
            <div className="px-4 py-4 sm:px-5">
              <Skeleton className="h-20 w-[92%] rounded-lg" />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 sm:px-5">
              <Skeleton className="h-3 w-56" />
              <Skeleton className="size-(--control-sm) rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  )
}
