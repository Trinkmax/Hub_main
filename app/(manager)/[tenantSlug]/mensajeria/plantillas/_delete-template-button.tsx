'use client'

import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmFormState } from '@/components/ui/confirm-dialog'
import type { MetaActionState } from '@/lib/meta/actions'
import { deleteTemplateAction } from '@/lib/meta/template-actions'
import { toConfirmState } from '../_components/confirm-state'
import { humanizeTemplateName } from './_template-display'

const initial: MetaActionState = { ok: true }

export function DeleteTemplateButton({
  tenantSlug,
  channelId,
  templateName,
}: {
  tenantSlug: string
  channelId: string
  templateName: string
}) {
  const displayName = humanizeTemplateName(templateName)

  // La confirmación espera la respuesta: si WhatsApp no la deja borrar, el
  // motivo queda en el diálogo.
  async function remove(_prev: ConfirmFormState, formData: FormData) {
    const result = await deleteTemplateAction(tenantSlug, initial, formData)
    if (result.ok && result.message) toast.success(result.message)
    return toConfirmState(result, 'No se pudo borrar la plantilla.')
  }

  return (
    <ConfirmDialog
      tone="danger"
      icon={Trash2Icon}
      title={`¿Borrar la plantilla «${displayName}»?`}
      description={
        <>
          Se borra de acá y también de tu cuenta de WhatsApp (
          <span className="font-mono type-small">{templateName}</span>). No se puede deshacer: si
          una difusión o automatización la usa, ese mensaje deja de salir.
        </>
      }
      confirmLabel="Borrar plantilla"
      pendingLabel="Borrando…"
      formAction={remove}
      hiddenFields={{ name: templateName, channel_id: channelId }}
      trigger={
        <Button
          variant="danger-ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Borrar la plantilla ${displayName}`}
        >
          <Trash2Icon aria-hidden />
        </Button>
      }
    />
  )
}
