import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * «Cómo arrancar»: encabezado, la tarjeta del avance con «Lo próximo», «Tené a
 * mano» y la primera sección con sus ítems. La forma real, nunca un spinner.
 */
export default function ComoArrancarLoading() {
  return (
    <PageShell width="comfortable">
      <Skeleton className="h-3 w-28" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>

      <div className="card-hairline grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4 p-5">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="space-y-2">
            {['a', 'b', 'c', 'd'].map((k) => (
              <Skeleton key={k} className="h-4 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-3 border-t border-border/60 p-5 lg:border-t-0 lg:border-l">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-11 w-full rounded-md sm:w-40 md:h-9" />
            <Skeleton className="h-11 w-full rounded-md sm:w-36 md:h-9" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="card-hairline space-y-3 rounded-xl border bg-card p-5 lg:col-start-2 lg:row-start-1">
          <Skeleton className="h-6 w-32" />
          {['a', 'b', 'c', 'd', 'e'].map((k) => (
            <div key={k} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded-[4px]" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="card-hairline overflow-hidden rounded-xl border bg-card lg:col-start-1 lg:row-start-1">
          <div className="space-y-2 border-b border-border/60 px-5 py-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <div className="divide-y divide-border/60">
            {['a', 'b', 'c', 'd'].map((k) => (
              <div key={k} className="flex gap-3 px-4 py-5 sm:gap-4 sm:px-5">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="h-11 w-full rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  )
}
