import { Planilla } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Los esqueletos del Resumen, con su forma (el panel verde y la planilla «Para hoy»): cuando llega el
 * dato nada salta de lugar. Los usa cada `Suspense` de la página y `loading.tsx`.
 */

/** Un bloque que late sobre el panel verde (ahí el gris crema no se ve). */
function HeroBone({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-white/10 motion-reduce:animate-none', className)}
    />
  )
}

const NUMBERS = ['a', 'b', 'c'] as const
const ROWS = ['a', 'b', 'c', 'd'] as const

export function HeroSkeleton() {
  // El mismo corte que el panel de verdad: dos columnas según su propio ancho.
  return (
    <div className="@container">
      <div className="adm-hero grid gap-x-8 gap-y-4 rounded-2xl p-4.5 sm:p-5 @min-[52rem]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)] @min-[52rem]:items-center">
        <span className="sr-only">Cargando el resumen…</span>
        <div aria-hidden className="space-y-2">
          <HeroBone className="h-3 w-16" />
          <HeroBone className="h-9 w-56 max-w-full" />
          <HeroBone className="h-3.5 w-72 max-w-full" />
        </div>
        <div aria-hidden className="grid grid-cols-2 gap-3.5 @min-[32rem]:grid-cols-3">
          {NUMBERS.map((key) => (
            <div key={key} className="space-y-1.5">
              <HeroBone className="h-3 w-24 max-w-full" />
              <HeroBone className="h-5 w-28 max-w-full" />
              <HeroBone className="h-3 w-20 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ParaHoySkeleton() {
  return (
    <Planilla>
      <div aria-hidden>
        <div className="border-b border-border/70 px-3 py-2.5">
          <Skeleton className="h-4 w-20" />
        </div>
        {ROWS.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-b-0"
          >
            <Skeleton className="h-4 w-72 max-w-[60%]" />
            <Skeleton className="h-10 w-20 rounded-md sm:h-8" />
          </div>
        ))}
      </div>
    </Planilla>
  )
}

/** La pantalla entera, para `loading.tsx`: mismo orden y mismas medidas que la página. */
export function ResumenSkeleton() {
  return (
    <>
      <div aria-hidden>
        <Skeleton className="h-8 w-64 max-w-full" />
      </div>
      <HeroSkeleton />
      <ParaHoySkeleton />
    </>
  )
}
