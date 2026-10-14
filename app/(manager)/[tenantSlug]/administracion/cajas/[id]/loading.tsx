import { AdmPage } from '@/components/administracion/kit'
import { Skeleton } from '@/components/ui/skeleton'

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f'] as const

/**
 * La ficha de una caja mientras carga, con su forma: volver, el nombre, la
 * tarjeta en grande (el número a la izquierda, el conteo a la derecha), el
 * dibujo, el período y los movimientos día por día.
 */
export default function CajaLoading() {
  return (
    <AdmPage width="comfortable">
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-56 max-w-full" />
      </div>

      <div
        aria-hidden="true"
        className="card-hairline relative overflow-hidden rounded-2xl border bg-card p-5 pt-[1.625rem] shadow-xs sm:p-6 sm:pt-[1.875rem]"
      >
        <Skeleton className="absolute inset-x-0 top-0 h-1.5 rounded-none" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-8">
          <div className="space-y-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-12 w-64 max-w-full sm:h-14" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-6 w-40 rounded-full" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
          <Skeleton className="h-11 w-32 rounded-full md:h-9" />
          <Skeleton className="h-11 w-44 rounded-full md:h-9" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
      >
        <div className="space-y-2">
          <Skeleton className="h-6 w-80 max-w-full" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-40 w-full sm:h-48" />
        <Skeleton className="h-24 w-full" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
        <div className="flex gap-2">
          <Skeleton className="h-11 w-44 rounded-full md:h-9" />
          <Skeleton className="h-11 w-24 rounded-full md:h-9" />
        </div>
        <Skeleton className="h-11 w-28 md:h-9" />
      </div>

      <div
        aria-hidden="true"
        className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
      >
        <Skeleton className="h-6 w-56" />
        <div className="flex gap-1.5">
          <Skeleton className="h-11 w-16 rounded-full md:h-9" />
          <Skeleton className="h-11 w-16 rounded-full md:h-9" />
          <Skeleton className="h-11 w-16 rounded-full md:h-9" />
        </div>
        <div className="divide-y divide-border/60">
          {ROWS.map((key) => (
            <div key={key} className="flex items-center gap-3 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </AdmPage>
  )
}
