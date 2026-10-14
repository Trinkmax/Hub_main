import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * La ficha de un asiento mientras carga: el «‹ Libro diario», el título con su
 * estado, la oración con el botón al comprobante y las líneas Debe / Haber.
 */
export default function AsientoLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
      </div>
      <div className="card-hairline flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-96 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-11 w-48" />
      </div>
      <div className="card-hairline rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="space-y-3 px-4 py-4">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-56 max-w-[60%]" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
