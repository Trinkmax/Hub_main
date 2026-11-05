import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { OnboardingRowStatus } from '@/lib/accounting/onboarding'
import { cn } from '@/lib/utils'

/**
 * El estado de un paso de la Puesta en marcha: un badge suave con la palabra (el color nunca va
 * solo: dice «Listo», «Falta»…). Server-safe.
 */

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
