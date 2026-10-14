import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { CreamHeroSkeleton, LedgerSkeleton } from '../../_components/skeletons'

/** La ficha de quien te debe: volver, el nombre, cuánto te debe, las tres vistas y lo pendiente. */
export default function ClienteLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <CreamHeroSkeleton />
      <div className="flex gap-1.5 overflow-hidden py-1">
        <Skeleton className="h-11 w-36 shrink-0 rounded-full md:h-9" />
        <Skeleton className="h-11 w-40 shrink-0 rounded-full md:h-9" />
        <Skeleton className="h-11 w-20 shrink-0 rounded-full md:h-9" />
      </div>
      <LedgerSkeleton rows={6} />
    </AdmPage>
  )
}
