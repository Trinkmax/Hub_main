import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonForm,
  SkeletonPageHeader,
  SkeletonStatus,
} from '@/components/ui/skeleton'

/** Las filas de botones: flechas, ícono, texto y link, interruptor y lápiz. */
const LINK_ROWS = ['a', 'b', 'c'] as const

/** Mismo armado que LinksManager: encabezado y botones a la izquierda, previa fija a la derecha. */
export default function Loading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={2} />
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-8">
          <div className="flex flex-col gap-4">
            <SectionHeaderSkeleton />
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
              <SkeletonForm fields={3} actions={false} />
              <Skeleton className="h-(--control-md) w-40 self-end" />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <SectionHeaderSkeleton />
            <div className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
              {LINK_ROWS.map((row) => (
                <div key={row} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="flex flex-col gap-2">
                    <Skeleton className="size-(--control-sm)" />
                    <Skeleton className="size-(--control-sm)" />
                  </div>
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-40 max-w-full" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full" />
                  <Skeleton className="size-(--control-md)" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3 lg:w-80 lg:shrink-0">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-[34rem] w-full rounded-[2rem]" />
        </div>
      </div>
    </PageShell>
  )
}

/** Título de sección (20/28) y su descripción (13/18). */
function SectionHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-7 items-center">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex h-[1.125rem] items-center">
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
    </div>
  )
}
