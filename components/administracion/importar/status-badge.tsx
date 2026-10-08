import { Ban, CheckCircle2, CircleAlert, CircleDashed, Clock, Loader2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { ImportBatchStatus, ProposalStatus } from '@/lib/imports/server/types'
import {
  BATCH_STATUS_COPY,
  PROPOSAL_STATUS_COPY,
  TONE_BADGE_CLASS,
  type UiTone,
} from '@/lib/imports/ui/labels'
import { cn } from '@/lib/utils'

const TONE_ICON: Readonly<Record<UiTone, typeof CheckCircle2>> = {
  success: CheckCircle2,
  warning: CircleAlert,
  danger: XCircle,
  info: Clock,
  muted: Ban,
}

/** Un estado con su ícono y su texto (nunca solo el color). Server-safe. */
export function ToneBadge({
  tone,
  children,
  icon,
  className,
}: {
  tone: UiTone
  children: ReactNode
  icon?: typeof CheckCircle2
  className?: string
}) {
  const Icon = icon ?? TONE_ICON[tone]
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal', TONE_BADGE_CLASS[tone], className)}>
      <Icon aria-hidden />
      {children}
    </Badge>
  )
}

export function BatchStatusBadge({
  status,
  className,
}: {
  status: ImportBatchStatus
  className?: string
}) {
  const copy = BATCH_STATUS_COPY[status]
  return (
    <ToneBadge
      tone={copy.tone}
      icon={status === 'posting' ? Loader2 : status === 'staging' ? CircleDashed : undefined}
      className={className}
    >
      {copy.label}
    </ToneBadge>
  )
}

export function ProposalStatusBadge({
  status,
  className,
}: {
  status: ProposalStatus
  className?: string
}) {
  const copy = PROPOSAL_STATUS_COPY[status]
  return (
    <ToneBadge tone={copy.tone} className={className}>
      {copy.label}
    </ToneBadge>
  )
}
