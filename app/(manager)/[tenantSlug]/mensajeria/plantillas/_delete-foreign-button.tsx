'use client'

import { Languages } from 'lucide-react'
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
import { deleteForeignTemplatesAction } from '@/lib/meta/template-actions'

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
  const [state, action, pending] = useActionState(
    deleteForeignTemplatesAction.bind(null, tenantSlug),
    initial,
  )

  useEffect(() => {
    if (!state.ok && state.message) toast.error(state.message)
    else if (state.ok && state.message) toast.success(state.message)
  }, [state])

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={pending}>
          <Languages className="size-4" aria-hidden />
          {pending ? 'Borrando…' : `Borrar de WhatsApp las de ejemplo (${names.length})`}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Borrar {names.length} plantillas en inglés?</AlertDialogTitle>
          <AlertDialogDescription>
            Ya están ocultas en todo el panel. Esto además las borra de tu cuenta de WhatsApp. Son
            las de muestra de Meta, en inglés; ninguna difusión ni automatización tuya las usa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded-lg bg-secondary/60 px-3 py-2 font-mono text-xs">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <form action={action}>
            <input type="hidden" name="channel_id" value={channelId} />
            <AlertDialogAction type="submit" disabled={pending}>
              Borrar todas
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
