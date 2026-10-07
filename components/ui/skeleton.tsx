import type * as React from 'react'
import { cn } from '@/lib/utils'
import {
  KPI_CELL_PADDING,
  KPI_GRID_CLASS,
  KPI_GROUP_CLASS,
  KPI_GROUP_FRAME_CLASS,
  type KPIGroupColumns,
  kpiGroupColumns,
} from './kpi-grid'

/**
 * Esqueletos de carga (kit HUB §3.4). Server-safe.
 *
 * `bg-skeleton` es tinta al 7 %: se ve igual sobre papel y sobre cartulina. El
 * pulso es opacidad 1 → 0,5 → 1 en 1,6 s `ease-in-out` (los keyframes `pulse`
 * de Tailwind con el tiempo del kit) y queda quieto con «reducir movimiento».
 *
 * **Regla.** El esqueleto copia los altos finales (filas del alto de la
 * densidad, título de 28 px en su línea de 34), así nada salta al cargar. Cada
 * `loading.tsx` es `PageShell` + presets, con `aria-busy` en el contenedor y
 * «Cargando…» una sola vez para lectores de pantalla (`SkeletonStatus`):
 *
 * ```tsx
 * <PageShell aria-busy="true">
 *   <SkeletonStatus />
 *   <SkeletonPageHeader actions={1} />
 *   <SkeletonTable rows={8} columns={5} />
 * </PageShell>
 * ```
 *
 * Los presets son decorativos (`aria-hidden`); los anchos son fijos por
 * posición (nada de `Math.random`: el HTML del server y el del cliente tienen
 * que coincidir).
 */

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'rounded-md bg-skeleton animate-[pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

/** «Cargando…» para lectores de pantalla, una sola vez por pantalla. */
function SkeletonStatus({
  label = 'Cargando…',
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { label?: string }) {
  return (
    <span data-slot="skeleton-status" role="status" className={cn('sr-only', className)} {...props}>
      {label}
    </span>
  )
}

const range = (count: number) => Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => i)

/** Una línea de texto de `type-body` (20 px) con su barra de 12. */
function TextLine({ className }: { className?: string }) {
  return (
    <div className="flex h-5 items-center">
      <Skeleton className={cn('h-3 w-full', className)} />
    </div>
  )
}

// ─── Texto ───────────────────────────────────────────────────────────────────

const TEXT_WIDTHS = ['w-full', 'w-11/12', 'w-full', 'w-10/12'] as const

function SkeletonText({
  lines = 3,
  className,
  ...props
}: React.ComponentProps<'div'> & { lines?: number }) {
  const rows = range(lines)
  return (
    <div
      data-slot="skeleton-text"
      aria-hidden="true"
      className={cn('flex flex-col', className)}
      {...props}
    >
      {rows.map((i) => (
        <TextLine
          key={`line-${i.toString()}`}
          // La última línea queda corta, como un párrafo de verdad.
          className={
            i === rows.length - 1 && rows.length > 1
              ? 'w-3/5'
              : (TEXT_WIDTHS[i % TEXT_WIDTHS.length] ?? 'w-full')
          }
        />
      ))}
    </div>
  )
}

// ─── Encabezado de página ────────────────────────────────────────────────────

/**
 * El `PageHeader`: contexto opcional (volver o migas, 13/18), título `h1` de
 * `type-title` (28 px en una línea de 34; 36 desde `lg`), descripción de una
 * línea (14/20) y botones de acción del alto de los controles.
 */
function SkeletonPageHeader({
  description = true,
  actions = 0,
  context = false,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  /** Default `true`. */
  description?: boolean
  /** Cuántos botones de acción. Default 0. */
  actions?: number
  /** Fila de «volver» o migas arriba del título. Default `false`. */
  context?: boolean
}) {
  return (
    <div
      data-slot="skeleton-page-header"
      aria-hidden="true"
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {context ? (
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className="h-3 w-28" />
          </div>
        ) : null}
        <div className="flex h-[2.125rem] items-center lg:h-9">
          <Skeleton className="h-7 w-56 max-w-full" />
        </div>
        {description ? <TextLine className="w-80 max-w-full" /> : null}
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {range(actions).map((i) => (
            <Skeleton
              key={`action-${i.toString()}`}
              className={cn('h-(--control-md) rounded-md', i === actions - 1 ? 'w-36' : 'w-28')}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

/**
 * El `KPIGroup`, con su misma grilla (`kpi-grid.ts`): 2 × 2 o 1 × 3 en el
 * celular, 3 desde `md`, 4 recién desde `xl`, y los pelos entre celdas por
 * posición. Cada celda copia un KPI: `p-4 sm:p-6`, etiqueta de 13/18, 4 px, el
 * número (`type-kpi`: 32 px de interlínea en `md`; 36 desde `sm` en `lg`) y,
 * con `hint`, una línea de ayuda de 12/16.
 */
function SkeletonKPIGroup({
  count = 4,
  columns,
  framed = true,
  size = 'md',
  hint = true,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  count?: number
  /** Las mismas de `KPIGroup`. Default: las que salen de la cantidad. */
  columns?: KPIGroupColumns
  /** Default `true`: una sola tarjeta, como el grupo. */
  framed?: boolean
  /** El `size` de los KPIs: `lg` crece a 36 px desde `sm`. Default `md`. */
  size?: 'md' | 'lg'
  /** La línea de ayuda debajo del número. Default `true`. */
  hint?: boolean
}) {
  const items = range(count)
  const cols = columns ?? kpiGroupColumns(items.length)
  return (
    <div
      data-slot="skeleton-kpi-group"
      data-columns={cols}
      aria-hidden="true"
      className={cn(
        KPI_GROUP_CLASS,
        KPI_GRID_CLASS[cols],
        framed && KPI_GROUP_FRAME_CLASS,
        className,
      )}
      {...props}
    >
      {items.map((i) => (
        <div key={`kpi-${i.toString()}`} className={cn('flex flex-col gap-1', KPI_CELL_PADDING)}>
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className={cn('flex h-8 items-center', size === 'lg' && 'sm:h-9')}>
            <Skeleton className="h-7 w-32 max-w-full" />
          </div>
          {hint ? (
            <div className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-20" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ─── Sección ─────────────────────────────────────────────────────────────────

/**
 * La `Section`: título (`type-section`, 20/28; con `headingLevel={3}`,
 * `type-subtitle`, 16/24), descripción de una línea de 13/18, botones `sm`
 * a la derecha y 16 px hasta el contenido, que va en `children` (otro preset:
 * una tabla, un formulario, KPIs).
 *
 * ```tsx
 * <SkeletonSection actions={1}>
 *   <SkeletonTable rows={5} />
 * </SkeletonSection>
 * ```
 */
function SkeletonSection({
  title = true,
  description = true,
  actions = 0,
  headingLevel = 2,
  divider = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  /** Default `true`. */
  title?: boolean
  /** Default `true`. */
  description?: boolean
  /** Cuántos botones a la derecha del título. Default 0. */
  actions?: number
  /** Como en `Section`: `3` es el título chico (16/24). Default 2. */
  headingLevel?: 2 | 3
  /** Como en `Section`: pelo arriba y 24 px de aire. */
  divider?: boolean
}) {
  const hasHeader = title || description || actions > 0
  return (
    <div
      data-slot="skeleton-section"
      className={cn('flex flex-col gap-4', divider && 'border-t border-border pt-6', className)}
      {...props}
    >
      {hasHeader ? (
        <div
          aria-hidden="true"
          className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2"
        >
          {title || description ? (
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {title ? (
                <div className={cn('flex items-center', headingLevel === 3 ? 'h-6' : 'h-7')}>
                  <Skeleton
                    className={cn('max-w-full', headingLevel === 3 ? 'h-3.5 w-32' : 'h-4 w-44')}
                  />
                </div>
              ) : null}
              {description ? (
                <div className="flex h-[1.125rem] items-center">
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
              ) : null}
            </div>
          ) : null}
          {actions > 0 ? (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {range(actions).map((i) => (
                <Skeleton
                  key={`action-${i.toString()}`}
                  className={cn('h-(--control-sm) rounded-md', i === actions - 1 ? 'w-28' : 'w-24')}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

// ─── Tabla ───────────────────────────────────────────────────────────────────

const CELL_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5', 'w-1/3'] as const

/**
 * La `DataTable`: encabezado de 36 px (32 en compacta) sobre `bg-muted` y filas
 * del alto de la densidad (`--row-comfortable` 44 · `--row-compact` 36). La
 * última columna va a la derecha, como la plata. En el celular, con
 * `mobile="cards"` (default, como las listas), dibuja las tarjetas-fila.
 */
function SkeletonTable({
  rows = 8,
  columns = 5,
  density = 'comfortable',
  mobile = 'cards',
  className,
  ...props
}: React.ComponentProps<'div'> & {
  rows?: number
  columns?: number
  /** `comfortable` 44 px (listas) · `compact` 36 px (libros). */
  density?: 'comfortable' | 'compact'
  /** Igual que la tabla: `cards` en listas, `scroll` en libros. */
  mobile?: 'cards' | 'scroll'
}) {
  const rowItems = range(rows)
  const colItems = range(Math.max(1, columns))
  const compact = density === 'compact'
  // La primera columna (la principal) más ancha. `repeat(0, …)` no es CSS válido.
  const gridTemplate = {
    gridTemplateColumns:
      colItems.length > 1
        ? `minmax(0, 2fr) repeat(${colItems.length - 1}, minmax(0, 1fr))`
        : 'minmax(0, 1fr)',
  }
  const cell = (row: number, col: number) => {
    const numeric = col === colItems.length - 1 && colItems.length > 1
    return (
      <div
        key={`cell-${row.toString()}-${col.toString()}`}
        className={cn('flex items-center px-3', numeric && 'justify-end')}
      >
        <Skeleton
          className={cn(
            'h-3',
            numeric ? 'w-16' : (CELL_WIDTHS[(row + col) % CELL_WIDTHS.length] ?? 'w-1/2'),
          )}
        />
      </div>
    )
  }

  return (
    <div
      data-slot="skeleton-table"
      aria-hidden="true"
      className={cn('overflow-clip rounded-xl border border-border bg-card', className)}
      {...props}
    >
      <div className={cn(mobile === 'cards' ? 'hidden md:block' : 'overflow-x-auto')}>
        <div className={cn(mobile === 'scroll' && 'min-w-[40rem]')}>
          <div
            className={cn('grid border-b border-border-strong bg-muted', compact ? 'h-8' : 'h-9')}
            style={gridTemplate}
          >
            {colItems.map((col) => (
              <div
                key={`head-${col.toString()}`}
                className={cn(
                  'flex items-center px-3',
                  col === colItems.length - 1 && colItems.length > 1 && 'justify-end',
                )}
              >
                <Skeleton className="h-2.5 w-16" />
              </div>
            ))}
          </div>
          {rowItems.map((row) => (
            <div
              key={`row-${row.toString()}`}
              className={cn(
                'grid border-b border-border last:border-b-0',
                compact ? 'h-(--row-compact)' : 'h-(--row-comfortable)',
              )}
              style={gridTemplate}
            >
              {colItems.map((col) => cell(row, col))}
            </div>
          ))}
        </div>
      </div>
      {mobile === 'cards' ? (
        <ul className="divide-y divide-border md:hidden">
          {rowItems.map((row) => (
            <li key={`card-${row.toString()}`} className="flex items-start gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <TextLine className={CELL_WIDTHS[row % CELL_WIDTHS.length]} />
                <div className="flex h-[1.125rem] items-center">
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
              </div>
              <div className="flex h-5 items-center">
                <Skeleton className="h-3 w-16" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ─── Formulario ──────────────────────────────────────────────────────────────

const LABEL_WIDTHS = ['w-28', 'w-20', 'w-32', 'w-24'] as const

/**
 * Campos `Field` apilados: etiqueta de 13/18, 8 px, control del alto de los
 * controles (`--control-md`), 16 px entre campos; y la fila de acciones.
 */
function SkeletonForm({
  fields = 5,
  actions = true,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  fields?: number
  /** «Cancelar» y la principal, a la derecha. Default `true`. */
  actions?: boolean
}) {
  return (
    <div
      data-slot="skeleton-form"
      aria-hidden="true"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      {range(fields).map((i) => (
        <div key={`field-${i.toString()}`} className="flex flex-col gap-2">
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className={cn('h-3', LABEL_WIDTHS[i % LABEL_WIDTHS.length])} />
          </div>
          <Skeleton className="h-(--control-md) w-full rounded-md" />
        </div>
      ))}
      {actions ? (
        <div className="flex justify-end gap-2 pt-4">
          <Skeleton className="h-(--control-md) w-24 rounded-md" />
          <Skeleton className="h-(--control-md) w-32 rounded-md" />
        </div>
      ) : null}
    </div>
  )
}

// ─── Grilla de tarjetas ──────────────────────────────────────────────────────

/** Tarjetas `Card` (`p-4 sm:p-6`) en grilla de 1, 2 y 3 columnas. */
function SkeletonCardGrid({
  count = 6,
  className,
  ...props
}: React.ComponentProps<'div'> & { count?: number }) {
  return (
    <div
      data-slot="skeleton-card-grid"
      aria-hidden="true"
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}
      {...props}
    >
      {range(count).map((i) => (
        <div
          key={`card-${i.toString()}`}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  )
}

// ─── Compatibilidad ──────────────────────────────────────────────────────────

/**
 * Lista con avatar, dos líneas y un valor a la derecha (la de antes, con los
 * tokens nuevos). Para una lista nueva, `SkeletonTable`: copia la `DataTable`.
 */
function ListSkeleton({
  rows = 6,
  className,
  ...props
}: React.ComponentProps<'div'> & { rows?: number }) {
  return (
    <div
      data-slot="skeleton-list"
      aria-hidden="true"
      className={cn('overflow-clip rounded-xl border border-border bg-card', className)}
      {...props}
    >
      <div className="divide-y divide-border">
        {range(rows).map((i) => (
          <div key={`skeleton-${i.toString()}`} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32 max-w-full" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export {
  ListSkeleton,
  Skeleton,
  SkeletonCardGrid,
  SkeletonForm,
  SkeletonKPIGroup,
  SkeletonPageHeader,
  SkeletonSection,
  SkeletonStatus,
  SkeletonTable,
  SkeletonText,
}
