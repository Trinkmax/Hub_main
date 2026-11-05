import type { ReactNode } from 'react'
import { Planilla, PlanillaBar } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Lo que se ve mientras carga una planilla de Compras, con la forma real: la barra, el totalizador y
 * las filas. El marco es el de `SimplePage`, sin su entrada (lo que aparece después ya la trae).
 */

const WIDTHS = ['w-48', 'w-36', 'w-56', 'w-40', 'w-44', 'w-32', 'w-52', 'w-40'] as const

/** El marco de una pantalla mientras carga. */
export function PlanillaLoading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      aria-busy="true"
      className="mx-auto grid w-full max-w-7xl content-start gap-3.5 px-4 pt-3.5 pb-24 sm:px-6 lg:px-8"
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function BarSkeleton({ widths = ['w-56', 'w-72'] }: { widths?: readonly string[] }) {
  return (
    <PlanillaBar>
      {widths.map((width) => (
        <Skeleton key={width} className={cn('h-8 max-w-full rounded-lg', width)} />
      ))}
    </PlanillaBar>
  )
}

/** Los números de arriba. */
export function TotalizerSkeleton({ items = 3 }: { items?: number }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {Array.from({ length: items }, (_, index) => `totalizador-${index}`).map((key) => (
        <div
          key={key}
          className="min-w-0 border-border/70 px-4 py-2.5 not-first:border-l max-sm:nth-[2n+1]:border-l-0 max-sm:nth-[n+3]:border-t"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-6 w-28 max-w-full" />
        </div>
      ))}
    </div>
  )
}

/** La hoja: el encabezado y unas filas, con los números a la derecha. */
export function SheetSkeleton({
  rows = 8,
  columns = 3,
  head,
}: {
  rows?: number
  /** Cuántas columnas de plata. */
  columns?: number
  /** Algo arriba de las filas (la búsqueda, los filtros). */
  head?: ReactNode
}) {
  const cells = Array.from({ length: columns }, (_, index) => `columna-${index}`)
  return (
    <Planilla>
      {head ? <div className="border-b border-border/70 px-3 py-2">{head}</div> : null}
      <div className="flex items-center justify-between gap-4 border-b border-border bg-secondary/50 px-3 py-2.5">
        <Skeleton className="h-2.5 w-24" />
        <div className="flex gap-6">
          {cells.map((key) => (
            <Skeleton key={key} className="h-2.5 w-14" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }, (_, index) => `fila-${index}`).map((key, index) => (
          <div key={key} className="flex items-center justify-between gap-4 px-3 py-[9px]">
            <Skeleton className={cn('h-3.5 max-w-full', WIDTHS[index % WIDTHS.length] ?? 'w-40')} />
            <div className="flex gap-6">
              {cells.map((cell) => (
                <Skeleton key={cell} className="h-3.5 w-14" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Planilla>
  )
}
