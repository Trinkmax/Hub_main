import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Los esqueletos de Ventas, cada uno con la forma de lo que va a aparecer: la barra, los números de
 * arriba y la planilla con sus renglones. Reservan el alto para que lo que llega después no empuje
 * lo de arriba.
 */

const SHEET = 'overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs'

function keys(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i.toString()}`)
}

/** La fila de controles: el mes o el filtro a la izquierda y lo que se hace a la derecha. */
export function BarSkeleton({ aside = true }: { aside?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Skeleton className="h-11 w-56 rounded-full md:pointer-fine:h-9" />
      {aside ? <Skeleton className="ml-auto size-11 rounded-md md:pointer-fine:size-9" /> : null}
    </div>
  )
}

/** Los números de arriba, en una sola tira. */
export function TotalizerSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div
      className={cn(SHEET, 'grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]')}
    >
      {keys(items, 'numero').map((key) => (
        <div key={key} className="space-y-2 px-4 py-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  )
}

/** Una planilla: el encabezado, los renglones y el pie. */
export function SheetSkeleton({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className={SHEET}>
      <div className="flex items-center gap-6 border-b border-border bg-secondary/50 px-3 py-2.5">
        {keys(columns, 'titulo').map((key, index) => (
          <Skeleton key={key} className={cn('h-3 w-14', index > 0 && 'ml-auto')} />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {keys(rows, 'renglon').map((key) => (
          <div key={key} className="flex items-center gap-6 px-3 py-[9px]">
            {keys(columns, 'celda').map((cell, index) => (
              <Skeleton key={cell} className={cn('h-4 w-16', index > 0 && 'ml-auto')} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-secondary/40 px-3 py-2.5">
        <Skeleton className="h-3 w-56 max-w-[50%]" />
        <Skeleton className="h-8 w-28" />
      </div>
    </div>
  )
}

/** La planilla del mes: el mes, sus tres números y un renglón por día. */
export function MonthSkeleton() {
  return (
    <>
      <span className="sr-only">Cargando el mes…</span>
      <BarSkeleton />
      <TotalizerSkeleton />
      <SheetSkeleton rows={14} columns={5} />
    </>
  )
}

/** «Por cobrar»: los filtros, los dos números y quién te debe. */
export function ReceivablesSkeleton() {
  return (
    <>
      <BarSkeleton />
      <TotalizerSkeleton items={2} />
      <SheetSkeleton rows={5} columns={3} />
    </>
  )
}

/** «Lo que llegó»: el período, los tres números y un renglón por medio. */
export function NetSkeleton() {
  return (
    <>
      <BarSkeleton aside={false} />
      <TotalizerSkeleton />
      <SheetSkeleton rows={6} columns={5} />
    </>
  )
}

/** «Cobros»: el período y la lista. */
export function CollectionsSkeleton() {
  return (
    <>
      <BarSkeleton />
      <TotalizerSkeleton items={2} />
      <SheetSkeleton rows={8} columns={4} />
    </>
  )
}

/** «Facturas»: el período, los tres números, por canal y las facturas aparte. */
export function InvoicesSkeleton() {
  return (
    <>
      <BarSkeleton aside={false} />
      <TotalizerSkeleton />
      <SheetSkeleton rows={3} columns={4} />
      <SheetSkeleton rows={3} columns={4} />
    </>
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

/** Una libreta (la ficha de quien te debe): renglones con su margen, su nombre y su importe. */
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

/** Un héroe crema (la ficha de quien te debe): el número, la oración, el botón y una barra. */
export function CreamHeroSkeleton() {
  return (
    <div
      className="card-hairline space-y-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-6"
      aria-busy="true"
    >
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
