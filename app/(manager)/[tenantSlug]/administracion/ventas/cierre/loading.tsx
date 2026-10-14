import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Cierre del día mientras carga, con la forma real de la pantalla: volver y
 * título, el día con sus flechas, los pasos numerados a la izquierda y el
 * ticket a la derecha (sin lugar para las dos columnas el ticket no se ve:
 * está detrás de «Ver ticket»).
 */
export default function CierreDelDiaLoading() {
  return (
    <AdmPage width="comfortable" className="max-sm:space-y-4 max-sm:py-4">
      <div className="space-y-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="hidden h-4 w-96 max-w-full sm:block" />
      </div>
      <Skeleton className="h-11 w-72 max-w-full rounded-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="space-y-4 sm:space-y-5">
          {/* Paso 1: los medios, agrupados. */}
          <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-72 max-w-full" />
                <Skeleton className="h-4 w-80 max-w-full" />
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {['a', 'b', 'c'].map((group) => (
                <div key={group} className="grid gap-3 rounded-xl bg-secondary/50 p-3 sm:p-4">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  {['x', 'y'].map((row) => (
                    <div key={row} className="flex items-center justify-between gap-3">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-11 w-36 sm:w-48" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-44" />
            </div>
          </div>
          {/* Los pasos que siguen. */}
          {['2', '3'].map((step) => (
            <div
              key={step}
              className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-52 max-w-full" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
              </div>
              <Skeleton className="mt-4 h-20 w-full rounded-xl" />
            </div>
          ))}
        </div>
        {/* El ticket. */}
        <div className="hidden space-y-3 rounded-t-[10px] bg-card p-5 shadow-xs xl:block">
          <Skeleton className="mx-auto h-5 w-32" />
          <Skeleton className="mx-auto h-3 w-24" />
          <div className="space-y-3 pt-4">
            {['a', 'b', 'c', 'd'].map((line) => (
              <div key={line} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
          </div>
        </div>
      </div>
    </AdmPage>
  )
}
