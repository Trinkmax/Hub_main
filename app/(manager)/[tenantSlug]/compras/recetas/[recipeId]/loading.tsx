import { ChevronLeft } from 'lucide-react'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** La misma forma que la ficha: volver, el título con sus botones y los renglones. */
export default function RecetaLoading() {
  return (
    <PageShell width="comfortable">
      <div className="space-y-3">
        <span className="-ml-1.5 inline-flex min-h-11 items-center gap-1 px-1.5 text-sm text-muted-foreground md:min-h-9">
          <ChevronLeft className="size-4" aria-hidden />
          Recetas
        </span>
        <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 flex-1 sm:w-36 sm:flex-none md:h-10" />
            <Skeleton className="h-11 w-24 md:h-10" />
          </div>
        </div>
      </div>
      <section className="space-y-3">
        <Skeleton className="h-7 w-64 max-w-full" />
        <div className="space-y-3 md:space-y-0 md:divide-y md:divide-border/60 md:rounded-xl md:border md:bg-card">
          {['a', 'b', 'c', 'd'].map((row) => (
            <div
              key={row}
              className="grid gap-3 rounded-xl border bg-card p-3 md:grid-cols-[minmax(0,1fr)_14rem_10rem_2.75rem] md:items-center md:rounded-none md:border-0 md:bg-transparent md:px-4 md:py-3"
            >
              <Skeleton className="h-11 w-full md:h-10" />
              <Skeleton className="h-11 w-full md:h-10" />
              <Skeleton className="h-11 w-40 rounded-full md:h-9" />
              <Skeleton className="hidden size-10 md:block" />
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full md:h-10 md:w-44" />
      </section>
    </PageShell>
  )
}
