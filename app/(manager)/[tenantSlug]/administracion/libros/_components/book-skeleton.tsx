import type { ReactNode } from 'react'
import { PageShell } from '@/components/ui/page-shell'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * El esqueleto de un libro con la forma real (H.2: nunca un spinner): volver,
 * encabezado con «Exportar», el período, una franja de números opcional y la
 * tabla. Server-safe.
 */
export function BookSkeleton({
  picker = 'range',
  stats = 0,
  rows = 8,
  columns = 6,
  filters = false,
  width = 'default',
  children,
}: {
  picker?: 'range' | 'month' | 'none'
  /** Tarjetas de números arriba de la tabla (IVA, posición). */
  stats?: number
  rows?: number
  columns?: number
  /** Una barra de filtros (cuenta, caja, persona) además del período. */
  filters?: boolean
  width?: 'default' | 'comfortable' | 'compact'
  /** Para reemplazar la tabla por otra forma (la posición de IVA, los cierres). */
  children?: ReactNode
}) {
  return (
    <PageShell width={width}>
      <Skeleton className="h-3 w-28" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      {picker === 'none' ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-11 w-60 rounded-xl" />
          <Skeleton className="h-11 w-24 rounded-full" />
          {picker === 'range' ? (
            <>
              <Skeleton className="h-11 w-44 rounded-full" />
              <Skeleton className="h-11 w-24 rounded-full" />
            </>
          ) : null}
        </div>
      )}
      {filters ? <Skeleton className="h-14 w-full rounded-xl" /> : null}
      {stats > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={`stat-${i.toString()}`} className="h-28 rounded-xl" />
          ))}
        </section>
      ) : null}
      {children ?? <TableSkeleton rows={rows} columns={columns} />}
    </PageShell>
  )
}

/** Una tabla de libro: encabezado y filas, con las cifras a la derecha. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  const cols = Math.max(2, columns)
  return (
    <div className="card-hairline overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-4 border-b border-border/60 bg-secondary/40 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton
            key={`h-${i.toString()}`}
            className={i >= cols - 2 ? 'ml-auto h-3 w-16' : 'h-3 w-20'}
          />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r.toString()}`} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-40 max-w-[40%]" />
            <Skeleton className="ml-auto h-3.5 w-20" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
