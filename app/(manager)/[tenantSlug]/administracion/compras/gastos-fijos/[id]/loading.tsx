import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'

function StepSkeleton({ fields }: { fields: number }) {
  return (
    <div className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-7 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
      </div>
      {Array.from({ length: fields }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: relleno fijo, sin identidad
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-11 w-full max-w-md" />
        </div>
      ))}
    </div>
  )
}

/** La ficha del gasto fijo mientras carga: las tres secciones y, al lado, el renglón de la planilla. */
export default function GastoFijoLoading() {
  return (
    <AdmPage width="comfortable">
      <div aria-busy="true" className="space-y-6">
        <span className="sr-only">Cargando el gasto fijo…</span>
        <Skeleton className="h-4 w-28" />
        <div className="space-y-2">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
          <div className="card-hairline space-y-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5 lg:order-last">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
          </div>
          <div className="space-y-4">
            <StepSkeleton fields={2} />
            <StepSkeleton fields={3} />
            <StepSkeleton fields={2} />
          </div>
        </div>
      </div>
    </AdmPage>
  )
}
