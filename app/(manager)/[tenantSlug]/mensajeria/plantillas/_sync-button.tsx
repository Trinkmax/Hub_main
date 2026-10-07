'use client'

import { RefreshCw } from 'lucide-react'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type MetaActionState, syncTemplatesAction } from '@/lib/meta/actions'

const initial: MetaActionState = { ok: true }

/** "Sincronizados N templates." → copy en criollo, sin perder el número. */
function friendlySyncMessage(message: string): string {
  const match = message.match(/\d+/)
  if (!match) return 'Listo. Tus plantillas quedaron al día con WhatsApp.'
  const count = Number(match[0])
  if (count === 0) return 'Listo. No había novedades: tus plantillas ya estaban al día.'
  if (count === 1) return 'Listo. Trajimos 1 plantilla de WhatsApp.'
  return `Listo. Trajimos ${count} plantillas de WhatsApp.`
}

export function TemplateSyncButton({
  channelId,
  tenantSlug,
}: {
  channelId: string
  tenantSlug: string
}) {
  const [state, action, pending] = useActionState(
    syncTemplatesAction.bind(null, tenantSlug),
    initial,
  )

  useEffect(() => {
    if (!state.ok && state.message) {
      toast.error(`No se pudieron traer las plantillas. ${state.message}`)
    } else if (state.ok && state.message) {
      toast.success(friendlySyncMessage(state.message))
    }
  }, [state])

  return (
    <form action={action}>
      <input type="hidden" name="channel_id" value={channelId} />
      <Button type="submit" variant="outline" disabled={pending} className="gap-2">
        <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} aria-hidden />
        {pending ? 'Trayendo novedades…' : 'Traer las novedades de WhatsApp'}
      </Button>
    </form>
  )
}
