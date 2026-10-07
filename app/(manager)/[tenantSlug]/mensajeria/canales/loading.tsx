import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonStatus } from '@/components/ui/skeleton'
import { WaSkeletonPageHeader } from '../_components/wa-skeletons'

function ChannelCardSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-clip rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-col gap-2 pt-0.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-5 w-20 rounded-sm" />
      </div>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-(--control-md) w-32 rounded-md" />
          <Skeleton className="h-(--control-md) w-44 rounded-md" />
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <PageShell width="compact" aria-busy="true">
      <SkeletonStatus label="Cargando los canales…" />
      <WaSkeletonPageHeader />
      {/* Dos tarjetas de canal + la guía de pasos, como la página real */}
      <div className="flex flex-col gap-4">
        <ChannelCardSkeleton />
        <ChannelCardSkeleton />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-4 border-t border-border pt-6">
        <Skeleton className="h-5 w-56" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}
