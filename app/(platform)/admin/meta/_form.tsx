'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type SavePlatformMetaConfigResult,
  savePlatformMetaConfig,
} from '@/lib/platform/meta-config-actions'

type Initial = { appId: string; webhookVerifyToken: string; hasSecret: boolean }
const init: SavePlatformMetaConfigResult = { ok: true }

export function MetaConfigForm({ initial }: { initial: Initial }) {
  const submitted = useRef(false)
  const [state, action, pending] = useActionState(
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
    <Card className="p-6">
      <form action={action} className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="appId">App ID</Label>
          <Input id="appId" name="appId" defaultValue={initial.appId} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="appSecret">App Secret</Label>
          <Input
            id="appSecret"
            name="appSecret"
            type="password"
            autoComplete="off"
            placeholder={
              initial.hasSecret ? '•••• configurado (vacío = conservar)' : 'Sin configurar'
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="webhookVerifyToken">Webhook Verify Token</Label>
          <Input
            id="webhookVerifyToken"
            name="webhookVerifyToken"
            defaultValue={initial.webhookVerifyToken}
            required
          />
          <p className="text-xs text-muted-foreground">
            Si lo cambiás, actualizalo también en el dashboard de Meta.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>
    </Card>
  )
}
