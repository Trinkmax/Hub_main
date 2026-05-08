'use client'

import { Plug, RefreshCw, Unplug } from 'lucide-react'
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
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(
    disconnectChannel.bind(null, tenantSlug),
    initial,
  )
  const [syncState, syncAction, syncPending] = useActionState(
    syncTemplatesAction.bind(null, tenantSlug),
    initial,
  )

  useEffect(() => {
    if (!disconnectState.ok && disconnectState.message) toast.error(disconnectState.message)
    else if (disconnectState.ok && disconnectState.message) toast.success(disconnectState.message)
  }, [disconnectState])

  useEffect(() => {
    if (!syncState.ok && syncState.message) toast.error(syncState.message)
    else if (syncState.ok && syncState.message) toast.success(syncState.message)
  }, [syncState])

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" className="gap-1.5">
        <a href={`/api/meta/${type}/connect?tenant=${encodeURIComponent(tenantSlug)}`}>
          <Plug className="size-4" />
          Reconectar
        </a>
      </Button>
      {type === 'whatsapp' ? (
        <form action={syncAction}>
          <input type="hidden" name="channel_id" value={channelId} />
          <Button type="submit" variant="outline" disabled={syncPending} className="gap-1.5">
            <RefreshCw className={`size-4 ${syncPending ? 'animate-spin' : ''}`} />
            {syncPending ? 'Sincronizando…' : 'Sincronizar templates'}
          </Button>
        </form>
      ) : null}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            disabled={disconnectPending}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Unplug className="size-4" />
            Desconectar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar canal?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a perder la posibilidad de enviar y recibir mensajes hasta reconectar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <form action={disconnectAction}>
              <input type="hidden" name="channel_id" value={channelId} />
              <AlertDialogAction
                type="submit"
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Desconectar
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
