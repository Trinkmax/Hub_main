import { PageHeader } from '@/components/ui/page-header'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = ['a', 'b', 'c', 'd'] as const

/** Las pestañas, los chips y un mes de funciones: lo que se ve mientras llegan los números. */
export default function Loading() {
  return (
    <PageShell width="comfortable">
      <PageHeader
        eyebrow="Entradas"
        title="Ventas online"
        description={<Skeleton className="h-4 w-[30rem] max-w-full" />}
      />
      <div className="flex h-11 items-center gap-4 border-b border-border/60 px-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-24 rounded-full sm:h-9" />
        <Skeleton className="h-11 w-28 rounded-full sm:h-9" />
        <Skeleton className="h-11 w-32 rounded-full sm:h-9" />
      </div>
      <div className="card-hairline overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="divide-y divide-border/60">
          {ROWS.map((row) => (
            <div key={row} className="flex items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-1.5 w-full max-w-sm" />
              </div>
              <Skeleton className="h-14 w-[4.75rem] rounded-lg sm:h-12" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  )
}
