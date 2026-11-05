import { SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from '../../libros/_components/book-skeleton'

/** La ficha de un asiento mientras carga: la vuelta, el título y los renglones. */
export default function AsientoLoading() {
  return (
    <SimplePage width="narrow">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <TableSkeleton rows={4} columns={4} />
    </SimplePage>
  )
}
