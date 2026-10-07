import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

// Espejo del simulador: «volver» al club, título y descripción; a la izquierda
// la tarjeta de controles y a la derecha el marco del teléfono con la wallet.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader context />
      <div aria-hidden="true" className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="w-full rounded-xl border border-border bg-card p-4 sm:p-6 lg:w-[380px] lg:shrink-0">
          <SkeletonForm fields={4} actions={false} />
        </div>
        <div className="flex flex-1 justify-center">
          <Skeleton className="h-[760px] max-h-[80vh] w-full max-w-[400px] rounded-[2.25rem]" />
        </div>
      </div>
    </PageShell>
  )
}
