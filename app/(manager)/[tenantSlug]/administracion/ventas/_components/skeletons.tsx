import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Los esqueletos de Ventas, cada uno con la forma de lo que va a aparecer: la
 * hoja verde, el almanaque de siete columnas (también en el celular), el
 * ticket, la libreta de renglones con margen. Reservan el alto para que lo que
 * llega después no empuje lo de arriba.
 */

const SURFACE = 'card-hairline rounded-2xl border bg-card p-4 shadow-xs sm:p-5'

function keys(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i.toString()}`)
}

/** La fila de vistas y, a la derecha, el período. */
export function ViewPillsSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex gap-1.5 overflow-hidden py-1">
        {['w-24', 'w-36', 'w-32', 'w-28'].map((width) => (
          <Skeleton key={width} className={cn('h-11 shrink-0 rounded-full md:h-9', width)} />
        ))}
      </div>
      <Skeleton className="h-11 w-56 rounded-full md:h-9" />
    </div>
  )
}

/** El selector de mes mientras llega desde cuándo se llevan las cuentas. */
export function StepperSkeleton() {
  return <Skeleton className="h-11 w-56 rounded-full md:pointer-fine:h-9" />
}

/** La hoja verde: el número, la oración, el botón y la pista. */
export function MonthHeroSkeleton() {
  return (
    <div className="adm-hero grid min-h-[220px] gap-x-8 gap-y-5 rounded-3xl p-5 sm:p-7 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <Skeleton className="h-3 w-40 bg-white/15" />
        <Skeleton className="h-12 w-64 max-w-full bg-white/15 sm:h-14" />
        <Skeleton className="h-4 w-80 max-w-full bg-white/10" />
        <Skeleton className="h-12 w-72 max-w-full rounded-md bg-white/15" />
      </div>
      <div className="space-y-4 rounded-2xl bg-white/8 p-5 lg:col-span-5">
        <Skeleton className="h-5 w-56 max-w-full bg-white/15" />
        <Skeleton className="h-3.5 w-full rounded-full bg-white/10" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-12 bg-white/10" />
          <Skeleton className="h-12 bg-white/10" />
        </div>
      </div>
    </div>
  )
}

/** El almanaque: siete columnas por cinco semanas, en cualquier ancho. */
export function AlmanacSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(SURFACE, '@container/almanac', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="grid grid-cols-7 gap-1 @[42rem]/almanac:gap-1.5">
        {keys(35, 'dia').map((key) => (
          <Skeleton
            key={key}
            className="h-14 rounded-lg @[28rem]/almanac:h-16 @[42rem]/almanac:h-24"
          />
        ))}
      </div>
    </div>
  )
}

/** Un ticket: el papel con sus renglones y el total. */
export function NightTicketSkeleton() {
  return (
    <div className="adm-ticket-wrap" aria-busy="true">
      <div className="adm-ticket force-light space-y-3 px-5 pt-5 pb-8">
        <span className="sr-only">Cargando el ticket de la noche…</span>
        <Skeleton className="mx-auto h-5 w-32" />
        <Skeleton className="mx-auto h-3 w-24" />
        <div className="space-y-2.5 pt-2">
          {keys(5, 'renglon').map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="space-y-2.5 pt-2">
          {keys(3, 'llega').map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** La noche elegida: su encabezado y el ticket. */
export function NightSkeleton() {
  return (
    <div className="space-y-4">
      <div className={cn(SURFACE, 'space-y-3')}>
        <Skeleton className="h-6 w-52 max-w-full" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-44" />
      </div>
      <NightTicketSkeleton />
    </div>
  )
}

/** «El mes» entero: la hoja verde, el almanaque y la noche al lado. */
export function MonthSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Cargando el mes…</span>
      <MonthHeroSkeleton />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <AlmanacSkeleton />
        <NightSkeleton />
      </div>
    </div>
  )
}

/** Un panel con título y un dibujo o una lista adentro. */
export function PanelSkeleton({ className, tall = false }: { className?: string; tall?: boolean }) {
  return (
    <div className={cn(SURFACE, 'space-y-4', className)} aria-busy="true">
      <Skeleton className="h-5 w-64 max-w-full" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className={cn('w-full rounded-xl', tall ? 'h-56' : 'h-28')} />
    </div>
  )
}

/** Una libreta: renglones con su margen, su nombre y su importe. */
export function LedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card-hairline overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="divide-y divide-border/60">
        {keys(rows, 'renglon').map((key) => (
          <div key={key} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-5 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Un héroe crema: el número, la oración, el botón y una barra. */
export function CreamHeroSkeleton() {
  return (
    <div className={cn(SURFACE, 'space-y-4 sm:p-6')} aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-64 max-w-full sm:h-14" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-12 w-44 rounded-md" />
      </div>
      <Skeleton className="h-3 w-full rounded-full" />
      <div className="grid gap-2 sm:grid-cols-3">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </div>
    </div>
  )
}

/** «Plata por cobrar»: el héroe, el día por día y quién te debe. */
export function ReceivablesSkeleton() {
  return (
    <div className="space-y-6">
      <CreamHeroSkeleton />
      <PanelSkeleton tall />
      <LedgerSkeleton />
    </div>
  )
}

/** «Lo que llegó»: de cada $ 100 y la lista de cobros. */
export function NetSkeleton() {
  return (
    <div className="space-y-6">
      <div className={cn(SURFACE, 'space-y-5')} aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-56 max-w-full" />
        <Skeleton className="h-5 w-[28rem] max-w-full" />
        <div className="space-y-4">
          {keys(5, 'medio').map((key) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-48 max-w-[50%]" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <LedgerSkeleton rows={4} />
    </div>
  )
}

/** «Facturas»: el panel de lo facturado, el ticket del mes y las facturas aparte. */
export function InvoicesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="max-lg:order-2">
          <PanelSkeleton tall />
        </div>
        <NightTicketSkeleton />
      </div>
      <LedgerSkeleton rows={3} />
    </div>
  )
}
