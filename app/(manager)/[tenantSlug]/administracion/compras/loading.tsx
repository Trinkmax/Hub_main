import { Skeleton } from '@/components/ui/skeleton'
import { HeroSkeleton, LibretaSkeleton } from './_components/suppliers-tab'

/**
 * Compras y pagos mientras carga, con la forma real de la portada: el
 * encabezado, las tres vistas, el número «Le debés a proveedores» al lado de la
 * puerta de carga y la hoja de la libreta con su margen.
 */
export default function ComprasLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
    >
      <span className="sr-only">Cargando Compras y pagos…</span>
      <div className="space-y-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-1.5">
        {['w-28', 'w-32', 'w-20'].map((w) => (
          <Skeleton key={w} className={`h-11 rounded-full md:h-9 ${w}`} />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
        <HeroSkeleton className="lg:col-span-7" />
        <div className="card-hairline space-y-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5 lg:col-span-5">
          <Skeleton className="h-6 w-48" />
          {['a', 'b', 'c'].map((k) => (
            <Skeleton key={k} className="h-14 w-full rounded-xl sm:h-[4.25rem]" />
          ))}
        </div>
      </div>
      <LibretaSkeleton />
    </div>
  )
}
