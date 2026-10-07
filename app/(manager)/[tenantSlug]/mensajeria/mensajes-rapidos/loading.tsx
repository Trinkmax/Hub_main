import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando los mensajes rápidos…" />
      <WaSkeletonPageHeader />
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-(--control-md) w-32 rounded-md" />
        </div>
        <SkeletonTable rows={3} columns={3} />
      </div>
    </PageShell>
  )
}
