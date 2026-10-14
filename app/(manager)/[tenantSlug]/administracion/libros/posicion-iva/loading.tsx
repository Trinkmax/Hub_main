import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'
import { HeaderSkeleton, PickerSkeleton } from '../_components/book-skeleton'

/**
 * «El IVA del mes» mientras carga, con la forma real: el mes, el panel del
 * número (la línea chica, el número ancho, la oración y la acción al lado) y la
 * barra de «cómo se calcula».
 */
export default function PosicionIvaLoading() {
  return (
    <AdmPage width="comfortable">
      <HeaderSkeleton />
      <PickerSkeleton />

      <div className="card-hairline grid gap-6 rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:grid-cols-12 lg:items-center">
        <div className="space-y-3 lg:col-span-7">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-14 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-6 w-56 rounded-full" />
        </div>
        <div className="space-y-3 border-t border-border/60 pt-5 lg:col-span-5 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-12 w-full sm:w-48" />
        </div>
      </div>

      <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <Skeleton className="h-6 w-[28rem] max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-4 w-full rounded-full" />
        {['a', 'b', 'c'].map((k) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-56 max-w-[60%]" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </AdmPage>
  )
}
