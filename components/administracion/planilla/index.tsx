import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * La planilla: la pieza de todas las pantallas de Administración desde noviembre de 2026 (pedido de
 * los socios y la contadora: «más simple, más parecido a un sistema tradicional»). Es lo que ya
 * conocen de su Excel, con la marca de HUB: filas apretadas, números alineados y la doble raya de
 * los libros en el total. Server-safe.
 *
 * Una pantalla es: `SimplePage` › (`Totalizer`) › `Planilla`. Sin tarjetas adentro de tarjetas y sin
 * oraciones explicando lo que el número ya dice.
 */

/** El marco de la pantalla: mismo ancho que la barra, y el aire justo entre los bloques. */
export function SimplePage({
  width = 'default',
  className,
  children,
}: {
  width?: 'default' | 'narrow'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // `minmax(0,1fr)`: una tabla ancha se desliza adentro de su hoja; nunca ensancha la página.
        'adm-rise mx-auto grid w-full grid-cols-[minmax(0,1fr)] content-start gap-3.5 px-4 pt-3.5 pb-24 sm:px-6 lg:px-8',
        width === 'narrow' ? 'max-w-5xl' : 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Una fila de controles arriba de la planilla: el mes, un filtro, una búsqueda. */
export function PlanillaBar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-wrap items-center gap-2.5', className)}>{children}</div>
}

/** La hoja: papel, borde finito, y el scroll horizontal adentro (nunca la página). */
export function Planilla({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** El encabezado de una hoja: un título chico y sus acciones. */
export function PlanillaTitle({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

/** El pie de una hoja: lo que se hace con la planilla (pegar una lista, agregar un renglón). */
export function PlanillaFoot({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-secondary/40 px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PTable({
  minWidth = 520,
  label,
  className,
  children,
}: {
  minWidth?: number
  /** Nombre accesible de la tabla. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    // `relative`: un `sr-only` de una columna fuera de la vista se posiciona acá, no contra la página.
    <div className="relative overflow-x-auto">
      <table
        aria-label={label}
        style={{ minWidth }}
        className={cn('w-full border-collapse text-sm tabular-nums', className)}
      >
        {children}
      </table>
    </div>
  )
}

const CELL = 'px-3 py-[7px] align-middle'

/**
 * Una columna que en el celular se va sin desarmar la tabla: queda de ancho cero, así los `colSpan` del
 * total siguen contando igual. Para que el número que importa se vea sin deslizar.
 */
export const PHONE_HIDDEN =
  'max-sm:w-0 max-sm:max-w-0 max-sm:overflow-hidden max-sm:p-0 max-sm:text-[0px] max-sm:[&>*]:hidden'
/** Para `PTable`: en el celular la tabla no pide más ancho que el de la pantalla. */
export const PHONE_FIT = 'max-sm:min-w-0!'

/** Una celda de encabezado: chica, en mayúsculas, como una planilla. */
export function PTh({
  align = 'left',
  className,
  children,
}: {
  align?: 'left' | 'right'
  className?: string
  children?: ReactNode
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border bg-secondary/50 px-3 py-2 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

/** Una celda. `align="right"` para todo lo que sea plata. */
export function PTd({
  align = 'left',
  colSpan,
  className,
  children,
}: {
  align?: 'left' | 'right'
  colSpan?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(CELL, align === 'right' && 'text-right whitespace-nowrap', className)}
    >
      {children}
    </td>
  )
}

/** Una fila, con su raya abajo y un tono al pasar. `flagged`: algo para mirar. */
export function PRow({
  flagged = false,
  className,
  children,
}: {
  flagged?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <tr
      className={cn(
        'group/row border-b border-border/60 transition-colors last:border-b-0 hover:bg-primary/[0.04] motion-reduce:transition-none',
        flagged && 'bg-warning/10 hover:bg-warning/15',
        className,
      )}
    >
      {children}
    </tr>
  )
}

/** La fila del total: raya arriba y doble raya abajo, como en los libros. */
export function PTotalRow({ children }: { children: ReactNode }) {
  return <tr className="adm-double-rule">{children}</tr>
}

/** Lo que aparece al pasar por la fila (en táctil, siempre). */
export const ROW_ACTION =
  'transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100'

/** Una celda que se escribe adentro de la planilla: el número a la derecha y solo la raya de abajo. */
export const CELL_INPUT =
  'w-28 rounded-md border border-transparent border-b-border bg-transparent px-2 py-0.5 text-right tabular-nums outline-none transition-[background-color,border-color,box-shadow] hover:bg-secondary/60 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20 disabled:opacity-60 motion-reduce:transition-none'
