import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Plan de cuentas: encabezado, pestañas, el buscador con sus filtros, los niveles y el árbol. */
export default function PlanDeCuentasLoading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-11 w-36 md:h-9" />
          <Skeleton className="h-11 w-36 md:h-9" />
        </div>
      </div>
      <div className="flex gap-4 border-b border-border/60 pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-36" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="flex flex-col gap-3 lg:flex-row lg:justify-between">
        <Skeleton className="h-9 w-full max-w-md rounded-full" />
        <Skeleton className="h-9 w-64 rounded-full" />
      </div>
      <ListSkeleton rows={10} />
    </PageShell>
  )
}
