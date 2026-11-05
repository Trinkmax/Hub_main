import { Planilla, SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { HeadingSkeleton, PickerSkeleton } from '../_components/book-skeleton'

/** Cierre de mes mientras carga: el título con sus botones, el mes y el checklist. */
export default function CierreDeMesLoading() {
  return (
    <SimplePage width="narrow">
      <HeadingSkeleton action />
      <PickerSkeleton />
      <Planilla>
        <div className="divide-y divide-border/60">
          {['1', '2', '3', '4', '5', '6'].map((k) => (
            <div key={k} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="ml-auto h-7 w-14" />
            </div>
          ))}
        </div>
      </Planilla>
    </SimplePage>
  )
}
