'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * El contador de personas, en un solo lugar.
 *
 * Antes cada pantalla dibujaba el suyo: la tarjeta del mozo, el diálogo de
 * cerrar mesa del dueño, el popup de la reserva. Tres steppers con tres tamaños
 * y tres límites distintos para el mismo número.
 *
 * El rango va de 1 a 99 a propósito, igual que `actualGuestsSchema`: cero
 * personas NO es un conteo, es "no vino", y eso es una transición de estado
 * aparte. Dejar bajar hasta 0 acá invitaría a registrar una ausencia como una
 * mesa de cero.
 */

const MIN = 1
const MAX = 99

export function GuestCountStepper({
  value,
  onChange,
  size = 'md',
  disabled,
  className,
  label = 'persona',
}: {
  value: number
  onChange: (next: number) => void
  /** `lg` para el celular del mozo (targets de 48px), `sm` para filas de tabla. */
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
  /** Singular para los aria-label. "persona" → "Una persona menos". */
  label?: string
}) {
  const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n))
  const btn = size === 'lg' ? 'size-12' : size === 'md' ? 'size-9' : 'size-7'
  const num =
    size === 'lg' ? 'min-w-14 text-3xl' : size === 'md' ? 'min-w-10 text-xl' : 'min-w-7 text-sm'

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(btn, 'rounded-full')}
        aria-label={`Una ${label} menos`}
        disabled={disabled || value <= MIN}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus className={size === 'lg' ? 'size-5' : 'size-3.5'} aria-hidden />
      </Button>
      <span
        aria-live="polite"
        className={cn('text-center font-mono font-semibold tabular-nums', num)}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn(btn, 'rounded-full')}
        aria-label={`Una ${label} más`}
        disabled={disabled || value >= MAX}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus className={size === 'lg' ? 'size-5' : 'size-3.5'} aria-hidden />
      </Button>
    </div>
  )
}
