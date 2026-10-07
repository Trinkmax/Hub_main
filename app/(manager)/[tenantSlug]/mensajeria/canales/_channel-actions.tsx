'use client'

import { Plug, RefreshCw, Unplug } from 'lucide-react'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SubmitButton } from '@/components/ui/submit-button'
import { disconnectChannel, type MetaActionState, syncTemplatesAction } from '@/lib/meta/actions'

const initial: MetaActionState = { ok: true }

export function ChannelCardActions({
  channelId,
  type,
  tenantSlug,
}: {
  channelId: string
  type: 'whatsapp' | 'instagram'
  tenantSlug: string
}) {
  const [syncState, syncAction] = useActionState(
    syncTemplatesAction.bind(null, tenantSlug),
    initial,
  )
  const channelName = type === 'whatsapp' ? 'WhatsApp' : 'Instagram'

  useEffect(() => {
    if (!syncState.ok && syncState.message) toast.error(syncState.message)
    else if (syncState.ok && syncState.message) toast.success(syncState.message)
  }, [syncState])

  // La confirmación espera la acción con el diálogo abierto: si Meta falla,
  // el motivo queda adentro en lugar de un aviso que se va.
  async function disconnect(_prev: unknown, formData: FormData) {
    const result = await disconnectChannel(tenantSlug, initial, formData)
    if (result.ok && result.message) toast.success(result.message)
    return result
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="secondary">
        <a href={`/api/meta/${type}/connect?tenant=${encodeURIComponent(tenantSlug)}`}>
          <Plug aria-hidden />
          Reconectar
        </a>
      </Button>
      {type === 'whatsapp' ? (
        <form action={syncAction}>
          <input type="hidden" name="channel_id" value={channelId} />
          <SubmitButton variant="secondary" pendingText="Sincronizando…">
            <RefreshCw aria-hidden />
            Sincronizar plantillas
          </SubmitButton>
        </form>
      ) : null}
      <ConfirmDialog
        tone="danger"
        icon={Unplug}
        title={`¿Desconectar ${channelName}?`}
        description={`El bar deja de mandar y recibir mensajes por ${channelName} hasta que lo vuelvas a conectar. Las conversaciones ya guardadas no se pierden.`}
        confirmLabel={`Desconectar ${channelName}`}
        pendingLabel="Desconectando…"
        formAction={disconnect}
        hiddenFields={{ channel_id: channelId }}
        trigger={
          <Button variant="danger-ghost">
            <Unplug aria-hidden />
            Desconectar
          </Button>
        }
      />
    </div>
  )
}
