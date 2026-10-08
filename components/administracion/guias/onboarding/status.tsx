import { Check, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { OnboardingRowStatus } from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'

/**
 * El estado de un ítem de «Cómo arrancar» con las piezas del panel: el
 * círculo numerado del `Stepper` (hecho = ✓ verde, lo próximo = número sobre
 * el color principal, pendiente = número gris) y el badge suave con el estado
 * en palabras. El color nunca va solo: el badge dice «Listo», «Falta»… y el
 * círculo es decorativo (la lista ya es ordenada). Server-safe.
 */

export function StepMarker({
  n,
  status,
  isNext,
  className,
}: {
  n: number
  status: OnboardingRowStatus
  isNext: boolean
  className?: string
}) {
  const tone =
    status === 'done'
      ? 'border-success bg-success text-success-foreground'
      : status === 'info'
        ? 'border-info/40 bg-info/10 text-info'
        : isNext
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-secondary/40 text-muted-foreground'
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        tone,
        className,
      )}
    >
      {status === 'done' ? (
        <Check className="size-3.5" />
      ) : status === 'info' ? (
        <Info className="size-3.5" />
      ) : (
        n
      )}
    </span>
  )
}

const BADGE_TONE: Readonly<Record<'done' | 'next' | 'todo' | 'info', string>> = {
  done: 'border-success/30 bg-success/10 text-success',
  next: 'border-primary/30 bg-primary/10 text-primary',
  todo: 'border-border text-muted-foreground',
  info: 'border-transparent bg-muted text-muted-foreground',
}

export function StatusBadge({
  status,
  isNext,
  children,
}: {
  status: OnboardingRowStatus
  isNext: boolean
  children: ReactNode
}) {
  const tone = status === 'done' ? 'done' : status === 'info' ? 'info' : isNext ? 'next' : 'todo'
  return (
    <Badge variant="outline" className={cn('font-medium', BADGE_TONE[tone])}>
      {children}
    </Badge>
  )
}
