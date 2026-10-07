import { PageShell } from '@/components/ui/page-shell'
import { SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../_components/wa-skeletons'
import { FlowEditorSkeleton } from '../_components/flow-editor-skeleton'

export default function Loading() {
  return (
    <PageShell width="full" className="h-full min-h-0 gap-4 py-4 sm:py-4" aria-busy="true">
      <SkeletonStatus label="Preparando el editor…" />
      <WaSkeletonPageHeader />
      <FlowEditorSkeleton />
    </PageShell>
  )
}
