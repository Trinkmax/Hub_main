import type { ReactNode } from 'react'
import { Planilla, SimplePage } from '@/components/administracion/planilla'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * El esqueleto de un libro con la forma real (nunca un spinner): la barra con el período a la
 * izquierda y las exportaciones a la derecha y la planilla. Server-safe.
 */
export function BookSkeleton({
  picker = 'range',
  totals = 0,
  rows = 8,
  columns = 6,
  filters = false,
  heading = false,
  children,
}: {
  picker?: 'range' | 'month' | 'none'
  /** Cuántos números trae el totalizador (0 = sin totalizador). */
  totals?: number
  rows?: number
  columns?: number
  /** Otra fila de filtros (nivel, cuenta, caja). */
  filters?: boolean
  /** Las pantallas que no son solapa llevan su título a la vista. */
  heading?: boolean
  /** Para reemplazar la planilla por otra forma. */
  children?: ReactNode
}) {
  return (
    <SimplePage>
      {heading ? <HeadingSkeleton /> : null}
      <div className="flex flex-wrap items-center gap-2.5">
        {picker === 'none' ? null : <PickerSkeleton range={picker === 'range'} />}
        <Skeleton className="ml-auto h-11 w-20 md:pointer-fine:h-8" />
      </div>
      {filters ? <Skeleton className="h-11 w-full max-w-xl md:pointer-fine:h-8" /> : null}
      {totals > 0 ? <TotalizerSkeleton items={totals} /> : null}
      {children ?? <TableSkeleton rows={rows} columns={columns} />}
    </SimplePage>
  )
}

/** El título de una pantalla de tarea (el cierre, una ficha, el asiento manual). */
export function HeadingSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-8 w-60 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action ? <Skeleton className="h-11 w-32 md:pointer-fine:h-9" /> : null}
    </div>
  )
}

/** El segmento del período. */
export function PickerSkeleton({ range = false }: { range?: boolean }) {
  return <Skeleton className={`h-11 md:pointer-fine:h-8 ${range ? 'w-80 max-w-full' : 'w-52'}`} />
}

/** La tira de los totales. */
export function TotalizerSkeleton({ items = 4 }: { items?: number }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {Array.from({ length: items }).map((_, i) => (
        <div key={`total-${i.toString()}`} className="space-y-2 px-4 py-2.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28 max-w-full" />
        </div>
      ))}
    </div>
  )
}

/** Una planilla: encabezado y filas, con las cifras a la derecha. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  const cols = Math.max(2, columns)
  return (
    <Planilla>
      <div className="flex items-center gap-4 border-b border-border bg-secondary/50 px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton
            key={`h-${i.toString()}`}
            className={i >= cols - 2 ? 'ml-auto h-3 w-16' : 'h-3 w-20'}
          />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r.toString()}`} className="flex items-center gap-4 px-3 py-2.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-40 max-w-[40%]" />
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </Planilla>
  )
}
