import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/** «El día a día»: el encabezado, el índice (en la compu) y las recetas plegadas. */
export default function GuiaDiaADiaLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <div className="hidden space-y-2.5 lg:block">
          <Skeleton className="h-6 w-28" />
          {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => (
            <Skeleton key={k} className="h-5 w-full" />
          ))}
        </div>
        <div className="space-y-3">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <div
              key={k}
              className="card-hairline flex items-start gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5"
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-64 max-w-full" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
