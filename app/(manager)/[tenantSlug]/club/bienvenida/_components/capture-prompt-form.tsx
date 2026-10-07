'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
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
  const [enabled, setEnabled] = useState(config.enabled)
  const [state, action] = useActionState(
    (prev: CapturePromptState, fd: FormData) => updateCapturePromptConfig(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message)
    else if (!state.ok && state.message) toast.error(state.message)
  }, [state])

  return (
    <Card asChild className="max-w-2xl">
      <form action={action}>
        {/* El Switch de Radix se maneja controlado y su estado viaja en este
            input (igual que welcome-reward-form). */}
        <input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />

        <Field
          label="Mostrar la invitación a registrarse"
          layout="toggle"
          hint="Aparece en el primer escaneo (abajo de la carta) y al confirmar la primera orden. Apagada, no se muestra ninguna invitación automática."
        >
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </Field>

        <Field label="Título" name="headline" required>
          <Input
            maxLength={80}
            defaultValue={config.headline}
            placeholder="Sumá puntos en cada visita"
          />
        </Field>

        <Field label="Subtítulo" name="subtext" required>
          <Textarea
            maxLength={160}
            showCount
            defaultValue={config.subtext}
            placeholder="Dejá tu nombre y teléfono y empezá a ganar beneficios."
          />
        </Field>

        <FormActions sticky={false}>
          <SubmitButton pendingText="Guardando…">Guardar invitación</SubmitButton>
        </FormActions>
      </form>
    </Card>
  )
}
