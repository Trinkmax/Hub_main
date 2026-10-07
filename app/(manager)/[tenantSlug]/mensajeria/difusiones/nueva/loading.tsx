import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonForm, SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../../_components/wa-skeletons'

export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Preparando la difusión…" />
      <WaSkeletonPageHeader />
      {/* Pasos del asistente (en el celular, solo el actual) */}
      <div aria-hidden="true" className="flex items-center gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={
              i === 0
                ? 'flex flex-1 items-center gap-3'
                : 'hidden flex-1 items-center gap-3 sm:flex'
            }
          >
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-full max-w-20" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <SkeletonForm fields={2} actions={false} />
      </div>
      <div aria-hidden="true" className="flex justify-between gap-2">
        <Skeleton className="h-(--control-md) w-24 rounded-md" />
        <Skeleton className="h-(--control-md) w-28 rounded-md" />
      </div>
    </PageShell>
  )
}
