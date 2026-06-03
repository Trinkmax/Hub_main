'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { type CapturePromptState, updateCapturePromptConfig } from '@/lib/capture-prompt/actions'
import type { CapturePromptConfig } from '@/lib/capture-prompt/schemas'

const initial: CapturePromptState = { ok: false, message: '' }

export function CapturePromptForm({
  tenantSlug,
  config,
}: {
  tenantSlug: string
  config: CapturePromptConfig
}) {
  const [state, action, pending] = useActionState(
    (prev: CapturePromptState, fd: FormData) => updateCapturePromptConfig(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok && state.message) toast.error(state.message)
  }, [state])

  return (
    <form action={action} className="max-w-2xl space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-display text-base font-semibold">Invitación a registrarse</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          El gancho que ve el comensal en el primer escaneo (bottom sheet) y al confirmar su primera
          orden. Si lo desactivás, no se muestra ninguna invitación automática.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Switch id="enabled" name="enabled" defaultChecked={config.enabled} />
        <Label htmlFor="enabled">Mostrar la invitación de captura</Label>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="headline">Título</Label>
        <Input
          id="headline"
          name="headline"
          maxLength={80}
          required
          defaultValue={config.headline}
          placeholder="Sumá puntos en cada visita"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="subtext">Subtítulo</Label>
        <Textarea
          id="subtext"
          name="subtext"
          maxLength={160}
          required
          defaultValue={config.subtext}
          placeholder="Dejá tu nombre y teléfono y empezá a ganar beneficios."
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}
