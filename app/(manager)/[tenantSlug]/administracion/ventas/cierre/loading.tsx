import { SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

const SHEET = 'overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs'

/**
 * Cierre del día mientras carga, con la forma real de la pantalla: volver y el día con sus flechas, el
 * título, la planilla de medios con lo que se anota debajo y, a la derecha, lo que se calcula solo.
 */
export default function CierreDelDiaLoading() {
  return (
    <SimplePage>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <Skeleton className="h-8 w-72 max-w-full" />
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_286px] lg:items-start">
        <div className={SHEET}>
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
            <Skeleton className="h-4 w-64 max-w-[50%]" />
            <Skeleton className="h-8 w-52 max-w-[40%]" />
          </div>
          <div className="divide-y divide-border/60">
            {['a', 'b', 'c', 'd', 'e', 'f'].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </div>
          <div className="grid gap-3 border-t border-border/70 p-3 sm:grid-cols-3">
            {['con', 'sin', 'contado'].map((field) => (
              <div key={field} className="space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-border/70 bg-secondary/40 px-3 py-2">
            <Skeleton className="h-9 w-44" />
          </div>
        </div>
        <div className={SHEET}>
          <div className="border-b border-border/70 px-3 py-2.5">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="divide-y divide-border/60">
            {['iva', 'iibb', 'municipal'].map((line) => (
              <div key={line} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SimplePage>
  )
}
