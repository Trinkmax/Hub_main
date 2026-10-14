import { Skeleton } from '@/components/ui/skeleton'

/**
 * La hoja de un proveedor mientras carga, con su forma real: la tapa verde (el
 * nombre, el número, la barra y sus tres datos), las dos vistas y el panel «Lo
 * que le debés» con sus renglones y su margen.
 */
export default function SupplierLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando el proveedor…</span>
      <Skeleton className="h-4 w-36" />
      <div className="adm-hero space-y-5 rounded-3xl p-5 sm:p-7">
        <Skeleton className="h-9 w-72 max-w-full bg-white/15" />
        <div className="space-y-2.5">
          <Skeleton className="h-3 w-20 bg-white/15" />
          <Skeleton className="h-12 w-64 max-w-full bg-white/15 sm:h-14" />
          <Skeleton className="h-4 w-80 max-w-full bg-white/15" />
        </div>
        <Skeleton className="h-3 w-full rounded-full bg-white/15" />
        <div className="flex flex-wrap gap-2 border-t border-white/12 pt-4">
          {['w-40', 'w-56', 'w-44'].map((w) => (
            <Skeleton key={w} className={`h-9 rounded-full bg-white/15 ${w}`} />
          ))}
        </div>
      </div>
      <div className="flex gap-1.5">
        {['w-28', 'w-24'].map((w) => (
          <Skeleton key={w} className={`h-11 rounded-full md:h-9 ${w}`} />
        ))}
      </div>
      <div className="card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 divide-y divide-border/60">
          {['a', 'b', 'c'].map((k) => (
            <div key={k} className="flex">
              <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 border-r border-adm-s5/35 py-3 sm:w-16">
                <Skeleton className="h-2 w-8" />
                <Skeleton className="h-5 w-6" />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-24 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
