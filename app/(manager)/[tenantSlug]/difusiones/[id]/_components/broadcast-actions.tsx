'use client'

import { useActionState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  type BroadcastActionState,
  cancelBroadcast,
  resendFailedRecipients,
  sendBroadcastNow,
} from '@/lib/broadcasts/actions'

const init: BroadcastActionState = { ok: true }

export function BroadcastActions({
  tenantSlug,
  broadcastId,
  status,
  failedCount,
}: {
  tenantSlug: string
  broadcastId: string
  status: string
  failedCount: number
}) {
  const [, cancelAction] = useActionState(cancelBroadcast.bind(null, tenantSlug), init)
  const [, nowAction] = useActionState(sendBroadcastNow.bind(null, tenantSlug), init)
  const [, resendAction] = useActionState(resendFailedRecipients.bind(null, tenantSlug), init)

  const canSendNow = status === 'scheduled' || status === 'draft'
  const canCancel = status === 'scheduled' || status === 'draft'
  const canResend =
    (status === 'sent' || status === 'partial' || status === 'failed') && failedCount > 0

  return (
    <div className="flex flex-wrap gap-2">
      {canSendNow ? (
        <form action={nowAction}>
          <input type="hidden" name="id" value={broadcastId} />
          <Button type="submit" size="sm" onClick={() => toast.message('Enviando…')}>
            Enviar ahora
          </Button>
        </form>
      ) : null}
      {canResend ? (
        <form action={resendAction}>
          <input type="hidden" name="id" value={broadcastId} />
          <Button type="submit" size="sm" variant="outline">
            Reenviar fallidos ({failedCount})
          </Button>
        </form>
      ) : null}
      {canCancel ? (
        <form action={cancelAction}>
          <input type="hidden" name="id" value={broadcastId} />
          <Button type="submit" size="sm" variant="destructive">
            Cancelar
          </Button>
        </form>
      ) : null}
    </div>
  )
}
