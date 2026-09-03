'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useTransition } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deleteRoutine, type MarketingActionState, saveRoutine } from '@/lib/marketing/actions'
import type { RoutineRow } from '@/lib/marketing/queries'

const INITIAL: MarketingActionState = { ok: false, message: '' }

export function RoutineDialog({
  tenantSlug,
  routine,
  open,
  onOpenChange,
}: {
  tenantSlug: string
  /** null = alta. */
  routine: RoutineRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isEdit = routine !== null

  const [state, formAction, pending] = useActionState(
    (prev: MarketingActionState, fd: FormData) => saveRoutine(tenantSlug, prev, fd),
    INITIAL,
  )

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar al cambiar
  // cualquier otra dep (p. ej. `isEdit`) y cerraba el diálogo con un toast de
  // éxito mentiroso. El padre además remonta este componente en cada apertura,
  // así que `state` arranca siempre en INITIAL.
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Rutina actualizada.' : 'Rutina creada.')
      onOpenChange(false)
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state, isEdit, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEdit ? 'Editar rutina' : 'Nueva rutina semanal'}
          </DialogTitle>
          <DialogDescription>
            Algo que se repite todas las semanas. Los tildes se reinician solos cada lunes.
          </DialogDescription>
        </DialogHeader>

        <form key={routine?.id ?? 'new'} action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={routine.id} /> : null}

          <div className="space-y-1.5">
            <Label htmlFor="routine-title">
              Nombre<span className="text-destructive"> *</span>
            </Label>
            <Input
              id="routine-title"
              name="title"
              required
              maxLength={160}
              defaultValue={routine?.title ?? ''}
              placeholder="Historia de Happy Hour"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-description">Detalle</Label>
            <Textarea
              id="routine-description"
              name="description"
              rows={3}
              maxLength={400}
              defaultValue={routine?.description ?? ''}
              placeholder="Qué marcas, qué horario, qué se muestra…"
              className="resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="routine-slots">Veces por semana</Label>
            <Input
              id="routine-slots"
              name="slots"
              type="number"
              min={1}
              max={14}
              required
              defaultValue={routine?.slots ?? 1}
              className="w-28"
            />
            <p className="text-xs text-muted-foreground">
              Cuántos casilleros a tildar. 3 = hay que hacerla tres veces.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <DeleteRoutineButton
                tenantSlug={tenantSlug}
                routine={routine}
                onDeleted={() => onOpenChange(false)}
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Guardando…' : isEdit ? 'Guardar' : 'Crear rutina'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteRoutineButton({
  tenantSlug,
  routine,
  onDeleted,
}: {
  tenantSlug: string
  routine: RoutineRow
  onDeleted: () => void
}) {
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar esta rutina?</AlertDialogTitle>
          <AlertDialogDescription>
            Se borra «{routine.title}» y también el historial de tildes de todas las semanas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await deleteRoutine(tenantSlug, routine.id)
                if (result.ok) {
                  toast.success('Rutina eliminada.')
                  onDeleted()
                } else {
                  toast.error(result.message)
                }
              })
            }}
          >
            {pending ? 'Eliminando…' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
