'use client'

import { Trash2Icon } from 'lucide-react'
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
import type { MetaActionState } from '@/lib/meta/actions'
import { deleteTemplateAction } from '@/lib/meta/template-actions'
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
  const boundAction = deleteTemplateAction.bind(null, tenantSlug)
  const [state, action, pending] = useActionState(boundAction, initial)

  const displayName = humanizeTemplateName(templateName)

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(`No se pudo eliminar la plantilla. ${state.message}`)
    }
  }, [state])

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          disabled={pending}
          aria-label={`Eliminar la plantilla ${displayName}`}
        >
          <Trash2Icon className="size-4" aria-hidden />
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta plantilla?</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a borrar <strong>«{displayName}»</strong>{' '}
            <span className="font-mono text-xs">({templateName})</span> de acá y también de tu
            cuenta de WhatsApp. No se puede deshacer: si una difusión o automatización la usa, ese
            mensaje va a dejar de salir.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <form action={action}>
            <input type="hidden" name="name" value={templateName} />
            <input type="hidden" name="channel_id" value={channelId} />
            <AlertDialogAction
              type="submit"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 w-full"
            >
              {pending ? 'Eliminando…' : 'Sí, eliminar'}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
