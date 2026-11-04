import type { ReactNode } from 'react'
import { RetryButton } from '@/components/administracion/kit/retry-button'
import { cn } from '@/lib/utils'

/**
 * Lo que comparten las planillas de Compras. Server-safe.
 *
 * Una fila entera lleva a su detalle con un solo link, estirado: `PRow` con `className="relative"`
 * y `ROW_LINK` en el link. Lo que se toca adentro de la fila va en `ROW_ACTIONS_CELL`, por encima.
 */

/** El link de una fila, estirado hasta los bordes de la fila. */
export const ROW_LINK =
  "rounded-sm outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"

/** La celda de las acciones: arriba del link de la fila y sin sumarle alto a la fila. */
export const ROW_ACTIONS_CELL = 'relative z-10 w-px py-0 text-right whitespace-nowrap'

/** Un botón de fila: chico con mouse, cómodo para el pulgar en táctil. */
export const ROW_BUTTON = 'h-9 md:pointer-fine:h-7'

/** La raya de lo que no tiene nada: se lee como vacío, no como un cero. */
export function NoAmount() {
  return (
    <span className="text-muted-foreground/70">
      <span aria-hidden>–</span>
      <span className="sr-only">Nada</span>
    </span>
  )
}

/** El encabezado de una hoja con sus controles: la búsqueda, un filtro, el «⋯». */
export function SheetControls({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** El vacío de una planilla: una oración y un botón, adentro de la misma hoja. */
export function SheetEmpty({
  children,
  action,
  secondary,
}: {
  children: ReactNode
  action?: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground text-pretty">{children}</p>
      {action || secondary ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  )
}

/** Una lectura que falló, adentro de la misma hoja: por qué, y reintentar. */
export function SheetError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6">
      <p role="alert" className="max-w-prose text-sm text-muted-foreground text-pretty">
        {message}
      </p>
      <RetryButton />
    </div>
  )
}
