'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  type BroadcastActionState,
  cancelBroadcast,
  resendFailedRecipients,
  sendBroadcastNow,
} from '@/lib/broadcasts/actions'

const init: BroadcastActionState = { ok: true }

// Toastea el resultado de una Server Action (éxito con mensaje / error).
// Antes se descartaba el estado (`const [, action]`) y los errores eran mudos.
function useActionToast(state: BroadcastActionState) {
  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])
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
  const [nowState, nowAction, nowPending] = useActionState(
    sendBroadcastNow.bind(null, tenantSlug),
    init,
  )
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelBroadcast.bind(null, tenantSlug),
    init,
  )
  const [resendState, resendAction, resendPending] = useActionState(
    resendFailedRecipients.bind(null, tenantSlug),
    init,
  )
  useActionToast(nowState)
  useActionToast(cancelState)
  useActionToast(resendState)

  const canSendNow = status === 'scheduled' || status === 'draft'
  const canCancel = status === 'scheduled' || status === 'draft'
  const canResend =
    (status === 'sent' || status === 'partial' || status === 'failed') && failedCount > 0

  return (
    <div className="flex flex-wrap gap-2">
      {canSendNow ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              disabled={nowPending}
              className="bg-(--wa-accent) text-white hover:bg-(--wa-accent-deep)"
            >
              {nowPending ? 'Enviando…' : 'Enviar ahora'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Enviar la difusión ahora?</AlertDialogTitle>
              <AlertDialogDescription>
                Se enviará el mensaje por WhatsApp a <strong>todos los destinatarios</strong> de la
                audiencia (los que aceptaron recibir promociones y no están bloqueados). Esta acción
                no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>No, todavía no</AlertDialogCancel>
              <form action={nowAction}>
                <input type="hidden" name="id" value={broadcastId} />
                <AlertDialogAction type="submit" className="w-full">
                  Sí, enviar ahora
                </AlertDialogAction>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {canResend ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" disabled={resendPending}>
              {resendPending ? 'Reintentando…' : `Reenviar fallidos (${failedCount})`}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Reenviar los mensajes fallidos?</AlertDialogTitle>
              <AlertDialogDescription>
                Vamos a volver a intentar el envío de {failedCount}{' '}
                {failedCount === 1 ? 'mensaje' : 'mensajes'} que habían fallado.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>No</AlertDialogCancel>
              <form action={resendAction}>
                <input type="hidden" name="id" value={broadcastId} />
                <AlertDialogAction type="submit" className="w-full">
                  Sí, reenviar
                </AlertDialogAction>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {canCancel ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" disabled={cancelPending}>
              {cancelPending ? 'Cancelando…' : 'Cancelar'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar la difusión?</AlertDialogTitle>
              <AlertDialogDescription>
                La difusión programada no se enviará. Podés volver a crear una nueva más adelante.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <form action={cancelAction}>
                <input type="hidden" name="id" value={broadcastId} />
                <AlertDialogAction
                  type="submit"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full"
                >
                  Sí, cancelar
                </AlertDialogAction>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
