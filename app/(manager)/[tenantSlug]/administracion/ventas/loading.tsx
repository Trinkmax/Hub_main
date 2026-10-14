import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'
import { MonthSkeleton, ViewPillsSkeleton } from './_components/skeletons'

/** Ventas: el título, las cuatro vistas, la hoja verde, el almanaque de siete columnas y el ticket. */
export default function VentasLoading() {
  return (
    <AdmPage>
      <div className="space-y-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <ViewPillsSkeleton />
      <MonthSkeleton />
    </AdmPage>
  )
}
