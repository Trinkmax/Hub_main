import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonKPIGroup, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando la difusión…" />
      <div className="flex flex-col gap-2">
        <WaSkeletonPageHeader description={false} actions={2} />
        {/* La fila de datos (estado, canal, mensaje, lista) */}
        <div aria-hidden="true" className="flex h-[1.125rem] items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-sm" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <SkeletonKPIGroup count={6} columns={3} />
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-64" />
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </PageShell>
  )
}
