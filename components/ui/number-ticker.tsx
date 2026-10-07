import type * as React from 'react'
import { formatNumber, formatNumberKind, type NumberFormatKind } from '@/lib/format/number-kind'
import { cn } from '@/lib/utils'

export type { NumberFormatKind }

type NumberTickerProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  value: number
  decimalPlaces?: number
  /** @deprecated el kit no anima números (§1.1, «quieto por defecto»): se ignora. */
  durationMs?: number
  /** Función propia. Solo desde un componente cliente: una función no cruza la frontera RSC. */
  format?: (n: number) => string
  /** Formato serializable: el que va desde un Server Component. */
  formatKind?: NumberFormatKind
  /** @deprecated el kit no anima números: se ignora. */
  startOnView?: boolean
  /** @deprecated el kit no anima números: se ignora. */
  delayMs?: number
}

/**
 * @deprecated Dibuja el valor final, quieto: el kit no anima números (§3.5).
 * Así los números que contaban en el panel (KPIs del Resumen, reseñas, pulso
 * del operativo) se quedan quietos sin tocar las páginas. Para un número nuevo
 * usá `KPI` con el valor ya formateado. El contador animado sigue en
 * `components/ui-legacy/number-ticker` para el carnet de `/c`.
 *
 * Server-safe: sin hooks ni `motion`. El formato es el de
 * `lib/format/number-kind.ts`, escrito a mano (sin `Intl`, sin errores de
 * hidratación).
 */
export function NumberTicker({
  value,
  decimalPlaces = 0,
  durationMs: _durationMs,
  format,
  formatKind,
  startOnView: _startOnView,
  delayMs: _delayMs,
  className,
  ...props
}: NumberTickerProps) {
  const text = format
    ? format(value)
    : formatKind
      ? formatNumberKind(value, formatKind)
      : formatNumber(value, decimalPlaces)

  return (
    <span data-slot="number-ticker" className={cn('tabular-nums', className)} {...props}>
      {text}
    </span>
  )
}
