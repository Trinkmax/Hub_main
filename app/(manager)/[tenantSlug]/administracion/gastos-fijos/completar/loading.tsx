import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'

/** «Completar la planilla» mientras carga: la tira de arriba y ocho renglones de dos campos. */
export default function CompletarPlanillaLoading() {
  return (
    <AdmPage width="comfortable">
      <div aria-busy="true" className="space-y-5">
        <span className="sr-only">Cargando tus gastos fijos…</span>
        <Skeleton className="h-4 w-28" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
        <div className="card-hairline flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:px-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-9 w-44" />
          </div>
          <Skeleton className="h-11 w-72 max-w-full rounded-full" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
        <div className="card-hairline rounded-2xl border bg-card shadow-xs">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
              key={index}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/60 px-3 py-3.5 last:border-b-0 sm:px-5"
            >
              <div className="min-w-0 flex-1 basis-40 space-y-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
              <div className="flex items-end gap-4">
                <Skeleton className="h-11 w-40" />
                <Skeleton className="h-11 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
