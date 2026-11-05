import { SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from '../libros/_components/book-skeleton'

/** Plan de cuentas mientras carga: la barra (buscar, Plan simple · Todas, los botones) y la tabla. */
export default function PlanDeCuentasLoading() {
  return (
    <SimplePage>
      <div className="flex flex-wrap items-center gap-2.5">
        <Skeleton className="h-11 w-64 max-w-full md:pointer-fine:h-8" />
        <Skeleton className="h-11 w-40 md:pointer-fine:h-8" />
        <Skeleton className="ml-auto h-11 w-48 md:pointer-fine:h-8" />
      </div>
      <TableSkeleton rows={14} columns={3} />
    </SimplePage>
  )
}
