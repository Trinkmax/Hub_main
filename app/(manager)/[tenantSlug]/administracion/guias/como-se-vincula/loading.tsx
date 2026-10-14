import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/** «Cómo se vincula cada cosa»: el encabezado, el dibujo de las uniones y sus explicaciones. */
export default function GuiaVinculosLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="card-hairline space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <Skeleton className="h-6 w-96 max-w-full" />
        {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((k) => (
          <div key={k} className="flex items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-0.5 w-10" />
            <Skeleton className="h-9 w-40 rounded-xl" />
          </div>
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </AdmPage>
  )
}
