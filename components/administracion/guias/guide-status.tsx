import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GuideStepStatus } from './arca-guide-model'

/**
 * El número de un paso con el color de su estado (✓ hecho, número primario «Te toca», gris
 * pendiente, «!» revisar, ✗ no anduvo). Es decorativo: el estado siempre va también en texto
 * (`guideStatusText`) al lado. Server-safe.
 */

const DOT: Readonly<Record<GuideStepStatus, string>> = {
  done: 'border-success bg-success text-success-foreground',
  todo: 'border-primary bg-primary text-primary-foreground',
  pending: 'border-border bg-secondary/40 text-muted-foreground',
  check: 'border-warning bg-warning/15 text-warning-text',
  failed: 'border-destructive bg-destructive text-destructive-foreground',
}

/** El color del texto del estado («Hecho» en verde, «Te toca» en primario…). */
export const GUIDE_STATUS_TEXT_CLASS: Readonly<Record<GuideStepStatus, string>> = {
  done: 'text-success',
  todo: 'text-primary',
  pending: 'text-muted-foreground',
  check: 'text-warning-text',
  failed: 'text-destructive',
}

export function GuideStatusDot({
  status,
  n,
  size = 'md',
  className,
}: {
  status: GuideStepStatus
  n: number
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums',
        size === 'md' ? 'size-9 text-sm' : 'size-6 text-[11px]',
        DOT[status],
        className,
      )}
    >
      {status === 'done' ? (
        <Check className={size === 'md' ? 'size-4' : 'size-3.5'} strokeWidth={3} />
      ) : status === 'failed' ? (
        <X className={size === 'md' ? 'size-4' : 'size-3.5'} strokeWidth={3} />
      ) : status === 'check' ? (
        '!'
      ) : (
        n
      )}
    </span>
  )
}
