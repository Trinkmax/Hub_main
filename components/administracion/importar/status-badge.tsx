import { StatusPill } from '@/components/administracion/kit'
import type { ImportBatchStatus, ProposalStatus } from '@/lib/imports/server/types'
import { displayBatchStatus, type InboxBatch } from '@/lib/imports/ui/inbox'
import { proposalBadge } from '@/lib/imports/ui/review-copy'

/**
 * El estado de un archivo y el de una hoja, como píldora (`StatusPill`: punto +
 * palabra, nunca el color solo). Las palabras salen de `displayBatchStatus()` y
 * `proposalBadge()`, así la lista del dueño y la tabla de la contadora dicen lo
 * mismo («Nada para cargar», «Ya está cargado»…). Server-safe.
 */
export function BatchStatusPill({
  batch,
  className,
}: {
  batch: Pick<InboxBatch, 'status' | 'pending' | 'counts'> & { status: ImportBatchStatus }
  className?: string
}) {
  const shown = displayBatchStatus(batch)
  return (
    <span title={shown.hint} className={className}>
      <StatusPill tone={shown.tone}>{shown.label}</StatusPill>
    </span>
  )
}

export function ProposalStatusPill({
  status,
  reason,
  className,
}: {
  status: ProposalStatus
  /** Por qué se salteó (`error.reason`): separa «Ya está cargado» de «No es nuestro». */
  reason?: string | null
  className?: string
}) {
  const badge = proposalBadge(status, reason)
  return (
    <StatusPill tone={badge.tone} className={className}>
      {badge.label}
    </StatusPill>
  )
}
