import { PageShell } from '@/components/ui/page-shell'
import { Skeleton, SkeletonPageHeader, SkeletonStatus } from '@/components/ui/skeleton'

const ROWS = ['r1', 'r2', 'r3', 'r4'] as const

// Espejo de la carta: encabezado con sus acciones, el buscador, la ruta
// («Carta») y la lista de categorías con su asa, su foto y su menú.
export default function Loading() {
  return (
    <PageShell width="comfortable" aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={5} />
      <div aria-hidden="true" className="flex flex-col gap-6">
        <Skeleton className="h-(--control-md) w-full rounded-md sm:max-w-md" />
        <div className="flex h-7 items-center">
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex h-7 items-center">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="flex h-[1.125rem] items-center">
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
          </div>
          <div className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
            {ROWS.map((row) => (
              <div key={row} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="size-9 shrink-0" />
                <Skeleton className="size-12 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="size-8 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  )
}
