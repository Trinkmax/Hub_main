import { PageShell } from '@/components/ui/page-shell'
import { SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../_components/wa-skeletons'
import { FlowEditorSkeleton } from '../_components/flow-editor-skeleton'

// Se dibuja debajo de las pestañas del layout: ocupa lo que queda (flex-1),
// igual que el editor real.
export default function Loading() {
  return (
    <PageShell width="full" className="min-h-0 flex-1 gap-4 py-4 sm:py-4" aria-busy="true">
      <SkeletonStatus label="Cargando la automatización…" />
      <WaSkeletonPageHeader />
      <FlowEditorSkeleton />
    </PageShell>
  )
}
