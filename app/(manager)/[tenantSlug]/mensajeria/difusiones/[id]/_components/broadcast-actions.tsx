'use client'

import { Ban, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmFormState } from '@/components/ui/confirm-dialog'
import {
  type BroadcastActionState,
  cancelBroadcast,
  resendFailedRecipients,
  sendBroadcastNow,
} from '@/lib/broadcasts/actions'
import { toConfirmState } from '../../../_components/confirm-state'

const init: BroadcastActionState = { ok: true }

type BroadcastAction = (
  slug: string,
  prev: BroadcastActionState,
  formData: FormData,
) => Promise<BroadcastActionState>

/**
 * Corre la Server Action desde la confirmación: si sale bien, el diálogo se
 * cierra y avisa; si falla, queda abierto con el motivo adentro (antes el
 * error era un toast que se iba).
 */
function confirmAction(tenantSlug: string, action: BroadcastAction, successMessage: string) {
  return async (_prev: ConfirmFormState, formData: FormData) => {
    const result = await action(tenantSlug, init, formData)
    // El mensaje del server es técnico («3 reencolados»): se avisa en criollo.
    if (result.ok) toast.success(successMessage)
    return toConfirmState(result)
  }
}

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
  const canSendNow = status === 'scheduled' || status === 'draft'
  const canCancel = status === 'scheduled' || status === 'draft'
  const canResend =
    (status === 'sent' || status === 'partial' || status === 'failed') && failedCount > 0
  const fields = { id: broadcastId }

  if (!canSendNow && !canCancel && !canResend) return null

  return (
    <div className="flex flex-wrap gap-2">
      {canCancel ? (
        <ConfirmDialog
          tone="danger"
          icon={Ban}
          title="¿Cancelar la difusión?"
          description="No se le va a mandar a nadie. Si después la querés mandar, armás una nueva."
          confirmLabel="Cancelar difusión"
          pendingLabel="Cancelando…"
          cancelLabel="Volver"
          formAction={confirmAction(tenantSlug, cancelBroadcast, 'Difusión cancelada.')}
          hiddenFields={fields}
          trigger={
            <Button type="button" variant="danger-ghost">
              <Ban aria-hidden />
              Cancelar difusión
            </Button>
          }
        />
      ) : null}

      {canResend ? (
        <ConfirmDialog
          icon={RotateCcw}
          title="¿Reenviar los mensajes que fallaron?"
          description={`Vamos a volver a intentar ${formatCount(failedCount)} que no habían salido.`}
          confirmLabel="Reenviar"
          pendingLabel="Reenviando…"
          cancelLabel="Volver"
          formAction={confirmAction(
            tenantSlug,
            resendFailedRecipients,
            'Listo, volvemos a intentar los que fallaron.',
          )}
          hiddenFields={fields}
          trigger={
            <Button type="button" variant="secondary">
              <RotateCcw aria-hidden />
              Reenviar fallidos ({failedCount})
            </Button>
          }
        />
      ) : null}

      {canSendNow ? (
        <ConfirmDialog
          icon={Send}
          title="¿Enviar la difusión ahora?"
          description={
            <>
              Le llega por WhatsApp a <strong>todos los destinatarios</strong> de la lista que
              aceptaron recibir promociones y no están bloqueados. Una vez que sale, no se puede
              deshacer.
            </>
          }
          confirmLabel="Enviar ahora"
          pendingLabel="Enviando…"
          cancelLabel="Todavía no"
          formAction={confirmAction(tenantSlug, sendBroadcastNow, 'La difusión ya está saliendo.')}
          hiddenFields={fields}
          trigger={
            <Button type="button">
              <Send aria-hidden />
              Enviar ahora
            </Button>
          }
        />
      ) : null}
    </div>
  )
}

function formatCount(n: number): string {
  return n === 1 ? '1 mensaje' : `${n} mensajes`
}
