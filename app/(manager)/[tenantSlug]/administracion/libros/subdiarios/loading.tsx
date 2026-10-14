import { Skeleton } from '@/components/ui/skeleton'
import { BookSkeleton, PickerSkeleton, TableSkeleton } from '../_components/book-skeleton'

/** Subdiarios: las seis píldoras del tipo, el período y la tabla ancha (en el celular, la lista). */
export default function SubdiariosLoading() {
  return (
    <BookSkeleton picker="none">
      <div className="space-y-3 py-2">
        <div className="flex gap-1.5 overflow-hidden py-1 sm:flex-wrap">
          {['w-24', 'w-20', 'w-20', 'w-36', 'w-28', 'w-32'].map((w, i) => (
            <Skeleton
              key={`tipo-${i.toString()}`}
              className={`h-11 shrink-0 rounded-full md:pointer-fine:h-9 ${w}`}
            />
          ))}
        </div>
        <PickerSkeleton range />
      </div>
      <TableSkeleton rows={10} columns={9} />
    </BookSkeleton>
  )
}
