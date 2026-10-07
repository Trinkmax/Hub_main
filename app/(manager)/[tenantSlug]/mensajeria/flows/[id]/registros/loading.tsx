import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando los registros…" />
      <WaSkeletonPageHeader />
      {/* Barra de filtros: período, acción, estado, contacto y actualizar */}
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-(--control-sm) w-52 rounded-md" />
        <Skeleton className="h-(--control-sm) w-44 rounded-md" />
        <Skeleton className="h-(--control-sm) w-40 rounded-md" />
        <Skeleton className="h-(--control-sm) w-52 rounded-md" />
        <Skeleton className="ms-auto h-(--control-sm) w-28 rounded-md" />
      </div>
      <SkeletonTable rows={8} columns={5} />
    </PageShell>
  )
}
