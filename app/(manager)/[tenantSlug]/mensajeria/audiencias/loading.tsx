import { PageShell } from '@/components/ui/page-shell'
import { SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando las audiencias…" />
      <WaSkeletonPageHeader actions={1} />
      <SkeletonTable rows={6} columns={3} />
    </PageShell>
  )
}
