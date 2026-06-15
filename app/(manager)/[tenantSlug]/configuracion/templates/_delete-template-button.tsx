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

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 gap-1.5 px-2"
          disabled={pending}
          aria-label={`Eliminar plantilla ${templateName}`}
        >
          <Trash2Icon className="size-3.5" />
          {pending ? 'Eliminando…' : 'Eliminar'}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar plantilla?</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a eliminar la plantilla <strong className="font-mono">{templateName}</strong> de
            Meta y de HUB. Esta acción no se puede deshacer. Si la plantilla está aprobada, Meta
            también la borrará de tu WABA.
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
              Sí, eliminar
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
