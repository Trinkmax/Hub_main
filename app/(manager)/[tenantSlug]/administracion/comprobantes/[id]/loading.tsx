import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * La ficha de un comprobante mientras carga, con su forma real: el encabezado,
 * a la izquierda el bloque de la plata y el mapa de vínculos, y a la derecha
 * la silueta del papel (debajo del bloque de la plata en el celular).
 */

const RAIL_ROWS = ['a', 'b', 'c', 'd'] as const
const PAPER_ROWS = ['a', 'b', 'c', 'd', 'e'] as const

export default function ComprobanteLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        {/* ① Qué pasó con la plata */}
        <div className="card-hairline rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:col-start-1 lg:row-start-1">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="space-y-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-12 w-56 max-w-full" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-3/4 max-w-sm" />
            </div>
            <Skeleton className="h-12 w-full sm:w-40" />
          </div>
        </div>

        {/* ② El papel */}
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="mx-auto w-full max-w-[22.5rem] rounded-md border border-dashed border-border bg-card/60 px-5 pt-5 pb-8 lg:max-w-none">
            <div className="flex flex-col items-center gap-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3 w-56 max-w-full" />
              <Skeleton className="mt-2 h-7 w-36" />
            </div>
            <div className="my-4 border-t border-dashed border-border" />
            <div className="space-y-3">
              {PAPER_ROWS.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  <div className="h-0 flex-1 border-b border-dotted border-border" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
            <div className="my-4 border-t-[3px] border-double border-border" />
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-36" />
            </div>
            <div className="mt-6 flex flex-col items-center gap-2">
              <Skeleton className="h-3 w-56 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        </div>

        {/* ③ Con qué está unido */}
        <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5 lg:col-start-1 lg:row-start-2">
          <Skeleton className="h-6 w-60 max-w-full" />
          <div className="mt-5 space-y-5 border-l-2 border-border pl-4">
            {RAIL_ROWS.map((k) => (
              <div key={k} className="grid gap-x-3 gap-y-2 sm:grid-cols-[10.5rem_minmax(0,1fr)]">
                <Skeleton className="h-9 w-24 rounded-xl" />
                <div className="space-y-2 pt-1">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdmPage>
  )
}
