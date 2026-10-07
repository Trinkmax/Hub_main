import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'
import { ListSkeleton } from '@/components/ui/skeleton-list'

/** Plan de cuentas: encabezado, el buscador con sus filtros y el árbol. */
export default function PlanDeCuentasLoading() {
  return (
    <PageShell>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-9 w-48 sm:block" />
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <Skeleton className="h-9 w-full max-w-md rounded-full" />
      <ListSkeleton rows={10} />
    </PageShell>
  )
}
