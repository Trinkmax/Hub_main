import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Barra de progreso (kit HUB §3.4). Server-safe: un `role="progressbar"` a
 * mano, sin Radix, así se puede dibujar desde un Server Component.
 *
 * - El indicador se mueve con `transform: translateX()` (no `width`) en 220 ms
 *   `ease-ui`; con «reducir movimiento», sin transición.
 * - Indeterminado (`value={null}`): un tramo del 30 % que recorre la pista en
 *   1,2 s lineal. Con «reducir movimiento», tramo quieto al centro. Usa el
 *   `enter` de tw-animate-css (ya cargado en globals.css) en loop: arranca
 *   corrido a la izquierda (`slide-in-from-left`) y termina en su `transform`
 *   propio, del otro lado de la pista.
 * - Nombre accesible: `label` (o un `aria-labelledby`). `valueText` es lo que
 *   lee el lector («3 de 5 tareas»); en indeterminado, «Cargando».
 */

export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger'

const TONE_CLASS: Readonly<Record<ProgressTone, string>> = {
  brand: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
}

export type ProgressProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** 0–100; `null` = indeterminado. */
  value: number | null
  /** Default `brand`. */
  tone?: ProgressTone
  /** `sm` 4 px · `md` 6 px (default). */
  size?: 'sm' | 'md'
  /** Nombre accesible (`aria-label`). */
  label?: string
  /** `aria-valuetext`: «3 de 5 tareas». */
  valueText?: string
}

function Progress({
  value,
  tone = 'brand',
  size = 'md',
  label,
  valueText,
  className,
  ...props
}: ProgressProps) {
  const indeterminate = value === null || !Number.isFinite(value)
  const current = indeterminate ? null : Math.min(100, Math.max(0, value))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={current ?? undefined}
      aria-valuetext={valueText ?? (current === null ? 'Cargando' : undefined)}
      data-slot="progress"
      data-state={current === null ? 'indeterminate' : current >= 100 ? 'complete' : 'loading'}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-secondary',
        size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
      {...props}
    >
      {current === null ? (
        <div
          data-slot="progress-indicator"
          className={cn(
            'absolute inset-y-0 left-0 w-[30%] rounded-full',
            TONE_CLASS[tone],
            // De −100 % (afuera a la izquierda) a 333,33 % de su ancho (100 % de
            // la pista: afuera a la derecha), lineal y sin fin.
            'transform-[translateX(333.333%)] animate-in slide-in-from-left repeat-infinite ease-linear animation-duration-1200',
            // Quieto al centro: 35 % de la pista = 116,67 % del tramo.
            'motion-reduce:animate-none motion-reduce:transform-[translateX(116.667%)]',
          )}
        />
      ) : (
        <div
          data-slot="progress-indicator"
          className={cn(
            'h-full w-full rounded-full transition-transform duration-220 ease-ui motion-reduce:transition-none',
            TONE_CLASS[tone],
          )}
          style={{ transform: `translateX(-${100 - current}%)` }}
        />
      )}
    </div>
  )
}

export { Progress }
