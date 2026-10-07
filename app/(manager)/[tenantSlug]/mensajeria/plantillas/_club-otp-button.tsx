'use client'

import { KeyRound } from 'lucide-react'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { MetaActionState } from '@/lib/meta/actions'
import { createClubOtpTemplateAction } from '@/lib/meta/template-actions'

const initial: MetaActionState = { ok: true }

/**
 * Crea la plantilla con la que la carta manda el código de recuperación del
 * club fuera de la ventana de 24 h. Se muestra sólo si el bar todavía no la
 * tiene: es un paso de configuración de una vez.
 */
export function ClubOtpTemplateButton({
  channelId,
  tenantSlug,
}: {
  channelId: string
  tenantSlug: string
}) {
  const [state, action, pending] = useActionState(
    createClubOtpTemplateAction.bind(null, tenantSlug),
    initial,
  )

  useEffect(() => {
    if (!state.ok && state.message) toast.error(state.message)
    else if (state.ok && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={action}>
      <input type="hidden" name="channel_id" value={channelId} />
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="gap-2"
        title="Plantilla de código de un solo uso (categoría Autenticación) para recuperar el acceso al club"
      >
        <KeyRound className="size-4" aria-hidden />
        {pending ? 'Creando…' : 'Crear plantilla del código del club'}
      </Button>
    </form>
  )
}
