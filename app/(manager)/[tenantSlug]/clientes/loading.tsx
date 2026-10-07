import { PageShell } from '@/components/ui/page-shell'
import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonStatus,
  SkeletonTable,
} from '@/components/ui/skeleton'

/** Copia la lista de clientes: encabezado con dos acciones, la barra de filtros y la tabla. */
export default function ClientesLoading() {
  return (
    <PageShell aria-busy="true">
      <SkeletonStatus />
      <SkeletonPageHeader actions={2} />
      <div className="flex min-w-0 flex-col gap-3">
        <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-(--control-sm) min-w-48 flex-1" />
          <Skeleton className="h-(--control-sm) w-72 max-w-full" />
          <Skeleton className="h-(--control-sm) w-full sm:w-52" />
          <Skeleton className="h-(--control-sm) w-full sm:w-48" />
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </PageShell>
  )
}
