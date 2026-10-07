'use client'

import { CircleAlert, CircleCheck } from 'lucide-react'
import * as React from 'react'
import { type BadgeTone, badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { BALANCE_STATUS_LABEL, type BalanceStatus, balanceDiffText } from './entry-balance'

const STATUS_TONE: Readonly<Record<BalanceStatus, BadgeTone>> = {
  empty: 'neutral',
  balanced: 'success',
  unbalanced: 'danger',
}

/**
 * El único momento con intención del kit (§2.10): fundido + `scale(0.98 → 1)`
 * en 160 ms al pasar de «cuadra» a «no cuadra» o al revés. Con «reducir
 * movimiento», solo fundido. Nunca al montar: lo que está desde que carga la
 * pantalla no se anima.
 */
const SEAL_MOTION =
  'animate-in fade-in-0 zoom-in-98 duration-160 ease-(--ease-ui) motion-reduce:zoom-in-100'

export type BalanceSealProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  status: BalanceStatus
  /** Debe − Haber, en centavos. Se muestra solo si no cuadra («· diferencia $ 12,40»). */
  diffCents?: number | bigint
  /** Para cambiar los textos («Completo» en vez de «Cuadra» en los medios de pago). */
  labels?: Partial<Record<BalanceStatus, string>>
  /** El texto de la diferencia. Default «diferencia $ 12,40». */
  diffText?: (diff: bigint) => string
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(value < 0 ? -Math.round(-value) : Math.round(value))
}

/**
 * El sello «Cuadra» / «No cuadra · diferencia $ 12,40» / «Sin importes» de
 * `EntryPreview` y del pie de `EntryEditor` (kit §3.8).
 *
 * Accesibilidad:
 * - El estado vive en `role="status"` (`aria-live="polite"`), un contenedor
 *   estable que nunca se desmonta: si se re-montara la región para animarla,
 *   varios lectores no anunciarían el cambio. Lo que se anima es el sello de
 *   adentro (con `key` por estado).
 * - Adentro de la región va solo la palabra del estado: la región habla cuando
 *   se pasa de cuadra a no cuadra o al revés, no en cada tecla.
 * - La diferencia va en un nodo aparte, afuera de la región: se lee al
 *   recorrer, pero no se anuncia mientras se tipea.
 *
 * Es cliente solo para saber si el estado cambió desde que se montó (la
 * animación no corre al cargar); `EntryPreview` sigue siendo server-safe.
 */
function BalanceSeal({
  status,
  diffCents = 0,
  labels,
  diffText = balanceDiffText,
  className,
  ...props
}: BalanceSealProps) {
  const [shown, setShown] = React.useState(status)
  const [changed, setChanged] = React.useState(false)
  if (status !== shown) {
    setShown(status)
    setChanged(true)
  }

  const Icon = status === 'balanced' ? CircleCheck : status === 'unbalanced' ? CircleAlert : null
  const label = labels?.[status] ?? BALANCE_STATUS_LABEL[status]
  const diff = toBigInt(diffCents)

  return (
    <span
      data-slot="balance-seal"
      data-status={status}
      data-tone={STATUS_TONE[status]}
      className={badgeVariants({
        tone: STATUS_TONE[status],
        size: 'md',
        className: cn('max-w-full', className),
      })}
      {...props}
    >
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-slot="balance-status"
        className="inline-flex items-center"
      >
        <span
          key={status}
          data-slot="balance-seal-mark"
          className={cn('inline-flex items-center gap-1', changed && SEAL_MOTION)}
        >
          {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
          {label}
        </span>
      </span>
      {status === 'unbalanced' && diff !== 0n ? (
        <span data-slot="balance-diff" className="type-amount">
          {` · ${diffText(diff)}`}
        </span>
      ) : null}
    </span>
  )
}

export { BalanceSeal }
