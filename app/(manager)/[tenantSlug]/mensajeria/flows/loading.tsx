import { PageShell } from '@/components/ui/page-shell'
import { SkeletonStatus, SkeletonTable } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus label="Cargando las automatizaciones…" />
      <WaSkeletonPageHeader actions={1} />
      <SkeletonTable rows={8} columns={5} />
    </PageShell>
  )
}
