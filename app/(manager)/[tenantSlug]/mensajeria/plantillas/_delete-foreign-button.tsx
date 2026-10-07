'use client'

import { Languages } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmFormState } from '@/components/ui/confirm-dialog'
import type { MetaActionState } from '@/lib/meta/actions'
import { deleteForeignTemplatesAction } from '@/lib/meta/template-actions'
import { toConfirmState } from '../_components/confirm-state'

const initial: MetaActionState = { ok: true }

/**
 * Borra de una vez las plantillas que no están en español: son las de muestra
 * que Meta crea sola en toda cuenta nueva ("hello_world", "jaspers_market_…")
 * y ensucian la lista sin servir para nada en un bar de Córdoba.
 */
export function DeleteForeignTemplatesButton({
  channelId,
  tenantSlug,
  names,
}: {
  channelId: string
  tenantSlug: string
  names: string[]
}) {
  async function removeAll(_prev: ConfirmFormState, formData: FormData) {
    const result = await deleteForeignTemplatesAction(tenantSlug, initial, formData)
    if (result.ok && result.message) toast.success(result.message)
    return toConfirmState(result)
  }

  return (
    <ConfirmDialog
      tone="danger"
      icon={Languages}
      title={`¿Borrar ${names.length === 1 ? 'la plantilla' : `las ${names.length} plantillas`} en inglés?`}
      description="Ya están ocultas en todo el panel. Esto además las borra de tu cuenta de WhatsApp. Son las de muestra de Meta, en inglés; ninguna difusión ni automatización tuya las usa."
      confirmLabel={names.length === 1 ? 'Borrarla' : 'Borrar todas'}
      pendingLabel="Borrando…"
      cancelLabel="Volver"
      formAction={removeAll}
      hiddenFields={{ channel_id: channelId }}
      trigger={
        <Button variant="secondary">
          <Languages aria-hidden />
          Borrar de WhatsApp las de ejemplo ({names.length})
        </Button>
      }
    >
      <ul className="max-h-40 overflow-y-auto rounded-lg bg-secondary px-3 py-2 font-mono type-small text-foreground">
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </ConfirmDialog>
  )
}
