import { Skeleton } from '@/components/ui/skeleton'

/**
 * «Cargar una compra» mientras carga, con su forma real: el papel con sus tres columnas y sus totales,
 * y al costado el panel de la foto.
 */
export default function NuevaCompraLoading() {
  return (
    <div
      className="mx-auto grid w-full max-w-7xl content-start gap-3.5 px-4 pt-3.5 pb-6 sm:px-6 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando la compra…</span>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-8 w-64 max-w-full rounded-lg" />
      </div>
      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_286px] xl:items-start">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_104px] md:grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)]">
            <div className="grid content-start gap-2 p-3.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-44 max-w-full" />
            </div>
            <div className="flex flex-col items-center gap-1.5 border-l border-border/70 px-[7px] pb-2.5 md:border-x">
              <Skeleton className="h-[58px] w-[62px] rounded-none" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
            <div className="col-span-2 grid content-start gap-2 border-t border-border/70 p-3.5 md:col-span-1 md:border-t-0">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-9 w-full" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          </div>
          <div className="grid gap-3 border-t border-border/70 p-3.5">
            <div className="ml-auto grid w-full max-w-[19.5rem] gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="grid gap-[7px] sm:grid-cols-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-secondary/40 px-3.5 py-2.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-44" />
          </div>
        </div>
        <div className="order-first grid justify-items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-border bg-card p-3.5 xl:order-none">
          <Skeleton className="hidden size-[124px] rounded-lg md:block" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-52 max-w-full" />
        </div>
      </div>
    </div>
  )
}
