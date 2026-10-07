'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Field, FormActions } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  type SavePlatformMetaConfigResult,
  savePlatformMetaConfig,
} from '@/lib/platform/meta-config-actions'

type Initial = { appId: string; webhookVerifyToken: string; hasSecret: boolean }
const init: SavePlatformMetaConfigResult = { ok: true }

export function MetaConfigForm({ initial }: { initial: Initial }) {
  const submitted = useRef(false)
  const [state, action] = useActionState(
    async (_prev: SavePlatformMetaConfigResult, formData: FormData) => {
      submitted.current = true
      return savePlatformMetaConfig({
        appId: formData.get('appId'),
        appSecret: formData.get('appSecret'),
        webhookVerifyToken: formData.get('webhookVerifyToken'),
      })
    },
    init,
  )

  useEffect(() => {
    if (!submitted.current) return
    if (state.ok) toast.success('Credenciales guardadas')
    else toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="flex max-w-xl flex-col gap-4">
      <Field label="App ID" name="appId" required>
        <Input defaultValue={initial.appId} autoComplete="off" spellCheck={false} />
      </Field>
      <Field
        label="App Secret"
        name="appSecret"
        hint={
          initial.hasSecret
            ? 'Ya hay uno guardado: dejalo vacío para conservarlo.'
            : 'Todavía no hay uno guardado.'
        }
      >
        <Input
          type="password"
          autoComplete="off"
          placeholder={initial.hasSecret ? '••••••••' : undefined}
        />
      </Field>
      <Field
        label="Webhook Verify Token"
        name="webhookVerifyToken"
        hint="Si lo cambiás, actualizalo también en el dashboard de Meta."
        required
      >
        <Input defaultValue={initial.webhookVerifyToken} autoComplete="off" spellCheck={false} />
      </Field>
      <FormActions>
        <SubmitButton pendingText="Guardando…">Guardar credenciales</SubmitButton>
      </FormActions>
    </form>
  )
}
