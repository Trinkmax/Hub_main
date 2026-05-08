'use client'

import { RefreshCw } from 'lucide-react'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type MetaActionState, syncTemplatesAction } from '@/lib/meta/actions'

const initial: MetaActionState = { ok: true }

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
    if (!state.ok && state.message) toast.error(state.message)
    else if (state.ok && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={action}>
      <input type="hidden" name="channel_id" value={channelId} />
      <Button type="submit" disabled={pending} className="gap-2">
        <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Sincronizando…' : 'Sincronizar con Meta'}
      </Button>
    </form>
  )
}
