import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/** Guías: encabezado, las dos guías con su avance y los tres archivos para bajar. */
export default function GuiasLoading() {
  return (
    <PageShell>
      <Skeleton className="h-3 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {['arranque', 'arca'].map((k) => (
          <div key={k} className="card-hairline space-y-4 rounded-xl border bg-card p-6">
            <Skeleton className="size-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-11 w-full rounded-md sm:w-40 md:h-9" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-6">
        {['mc', 'mp', 'banco'].map((k) => (
          <div key={k} className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}
