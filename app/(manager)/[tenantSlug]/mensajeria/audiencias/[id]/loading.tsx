import { PageShell } from '@/components/ui/page-shell'
import { SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../_components/wa-skeletons'
import { AudienceFormSkeleton } from '../_components/audience-form-skeleton'

export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando la audiencia…" />
      <WaSkeletonPageHeader />
      <AudienceFormSkeleton conditions={2} />
    </PageShell>
  )
}
