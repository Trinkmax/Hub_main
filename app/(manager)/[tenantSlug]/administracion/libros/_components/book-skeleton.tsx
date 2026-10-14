import type { ReactNode } from 'react'
import { AdmPage } from '@/components/administracion/kit/adm-page'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * El esqueleto de un libro con la forma real (nunca un spinner): el «‹ Libros»,
 * el encabezado con «Exportar», la fila para pasar a otro libro, la banda de
 * período y filtros, la banda de totales (si el libro la tiene) y la tabla.
 * Server-safe.
 */
export function BookSkeleton({
  picker = 'range',
  stats = 0,
  rows = 8,
  columns = 6,
  filters = false,
  switcher = true,
  width = 'default',
  children,
}: {
  picker?: 'range' | 'month' | 'none'
  /** Cuántos pares trae la banda de totales (0 = sin banda). Se llama así desde antes: lo pasan los libros de IVA. */
  stats?: number
  rows?: number
  columns?: number
  /** Una fila de filtros (cuenta, caja, persona) además del período. */
  filters?: boolean
  /** La fila «entre libros» (no va en las pantallas que no son un libro). */
  switcher?: boolean
  width?: 'default' | 'comfortable' | 'compact'
  /** Para reemplazar la tabla por otra forma (sumas y saldos, subdiarios, historia). */
  children?: ReactNode
}) {
  return (
    <AdmPage width={width}>
      <HeaderSkeleton />
      {switcher ? <SwitcherSkeleton /> : null}
      {picker === 'none' && !filters ? null : (
        <div className="space-y-3 py-2">
          {picker === 'none' ? null : <PickerSkeleton range={picker === 'range'} />}
          {filters ? <Skeleton className="h-11 w-full max-w-xl rounded-full" /> : null}
        </div>
      )}
      {stats > 0 ? <TotalsSkeleton pairs={stats} /> : null}
      {children ?? <TableSkeleton rows={rows} columns={columns} />}
    </AdmPage>
  )
}

/** El «‹ volver», el título, la oración y el botón de exportar. */
export function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        {action ? <Skeleton className="h-9 w-28" /> : null}
      </div>
    </div>
  )
}

/** Las ocho píldoras de «entre libros». */
export function SwitcherSkeleton() {
  return (
    <div className="flex gap-1.5 overflow-hidden py-1 sm:flex-wrap">
      {['w-20', 'w-20', 'w-36', 'w-28', 'w-28', 'w-24', 'w-36', 'w-24'].map((w, i) => (
        <Skeleton
          key={`libro-${i.toString()}`}
          className={`h-11 shrink-0 rounded-full md:pointer-fine:h-9 ${w}`}
        />
      ))}
    </div>
  )
}

/** El mes con flechas y sus píldoras. */
export function PickerSkeleton({ range = false }: { range?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-11 w-60 rounded-full md:pointer-fine:h-9" />
      <Skeleton className="h-11 w-24 rounded-full md:pointer-fine:h-9" />
      {range ? (
        <>
          <Skeleton className="h-11 w-44 rounded-full md:pointer-fine:h-9" />
          <Skeleton className="h-11 w-24 rounded-full md:pointer-fine:h-9" />
        </>
      ) : null}
    </div>
  )
}

/** La banda de totales: pares «etiqueta / valor» con su raya. */
export function TotalsSkeleton({ pairs = 3 }: { pairs?: number }) {
  return (
    <div className="card-hairline flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border bg-card px-4 py-3 shadow-xs">
      {Array.from({ length: pairs }).map((_, i) => (
        <div key={`total-${i.toString()}`} className="space-y-1.5 border-l-2 border-border/70 pl-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
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
