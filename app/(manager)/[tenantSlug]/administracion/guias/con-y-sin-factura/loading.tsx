import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/** «Con factura y sin factura»: el encabezado, los cuatro papeles y los casos. */
export default function GuiaFacturaLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="card-hairline space-y-5 rounded-2xl border bg-card p-4 sm:p-5">
        <Skeleton className="h-6 w-[26rem] max-w-full" />
        <div className="grid gap-5 md:grid-cols-4">
          {['a', 'b', 'c', 'd'].map((k) => (
            <div key={k} className="space-y-2.5">
              <Skeleton className="h-[4.5rem] w-14" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-96 rounded-2xl" />
    </AdmPage>
  )
}
