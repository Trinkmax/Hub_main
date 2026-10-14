import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'
import { HeaderSkeleton } from '../_components/book-skeleton'

/**
 * «Fin de mes» mientras carga, con la forma real: la fila de pestañas del año,
 * los tres pasos (el primero alto, con sus cuatro renglones) y el papel del mes
 * a la derecha (arriba y plegado en el celular).
 */
export default function FinDeMesLoading() {
  return (
    <AdmPage width="comfortable">
      <HeaderSkeleton action={false} />

      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-1">
        {['a', 'b', 'c', 'd'].map((k) => (
          <Skeleton key={k} className="h-[4.25rem] rounded-t-xl rounded-b-md sm:w-28" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-7">
          <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <StepHead />
            <div className="mt-4 divide-y divide-border/60">
              {['1', '2', '3', '4'].map((k) => (
                <div key={k} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-6 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-full max-w-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {['2', '3'].map((k) => (
            <div key={k} className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
              <StepHead />
            </div>
          ))}
        </div>

        <div className="order-1 lg:order-2 lg:col-span-5">
          {/* Celular: la línea plegada. Compu: el papel. */}
          <Skeleton className="h-11 w-full rounded-2xl lg:hidden" />
          <div className="hidden space-y-4 rounded-xl bg-adm-paper p-5 shadow-xs lg:block">
            <div className="flex flex-col items-center gap-2">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-56 rounded-md" />
            </div>
            {['a', 'b', 'c', 'd'].map((k) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdmPage>
  )
}

function StepHead() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
    </div>
  )
}
