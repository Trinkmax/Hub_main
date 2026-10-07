'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// El rango va de 1 a 99 a propósito, igual que `actualGuestsSchema`: cero
// personas NO es un conteo, es "no vino", y eso es una transición de estado
// aparte. Dejar bajar hasta 0 acá invitaría a registrar una ausencia como una
// mesa de cero.
const MIN = 1
const MAX = 99

/**
 * El contador de personas con el número grande en el medio.
 *
 * @deprecated En el panel va `NumberField` del kit (§3.2), que además se puede
 * tipear y se maneja con las flechas. Este queda, con los tokens del kit, para
 * el tablero operativo hasta que su lote lo migre; el salón usa su copia
 * congelada (`components/legacy/reservations`).
 */
export function GuestCountStepper({
  value,
  onChange,
  size = 'md',
  disabled,
  className,
  label = 'persona',
  muted = false,
}: {
  value: number
  onChange: (next: number) => void
  /** `lg` para el celular del mozo (targets de 48px), `sm` para filas de tabla. */
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
  /** Singular para los aria-label. "persona" → "Una persona menos". */
  label?: string
  /** El número todavía no es un conteo real (es una propuesta): se ve apagado. */
  muted?: boolean
}) {
  const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n))
  const btnSize = size === 'lg' ? 'icon-lg' : size === 'md' ? 'icon' : 'icon-sm'
  const num =
    size === 'lg' ? 'min-w-14 text-3xl' : size === 'md' ? 'min-w-10 text-xl' : 'min-w-7 text-sm'

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Button
        type="button"
        variant="secondary"
        size={btnSize}
        className="rounded-full"
        aria-label={`Una ${label} menos`}
        disabled={disabled || value <= MIN}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus aria-hidden />
      </Button>
      <span
        aria-live="polite"
        className={cn(
          'text-center font-semibold type-amount',
          num,
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="secondary"
        size={btnSize}
        className="rounded-full"
        aria-label={`Una ${label} más`}
        disabled={disabled || value >= MAX}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}
