'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { SubmitButton } from '@/components/ui/submit-button'
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

  const [state, formAction] = useActionState(
    (prev: MarketingActionState, fd: FormData) => saveRoutine(tenantSlug, prev, fd),
    INITIAL,
  )

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar al cambiar
  // cualquier otra dep (p. ej. `isEdit`) y cerraba el diálogo con un toast de
  // éxito mentiroso. El padre además remonta este componente en cada apertura,
  // así que `state` arranca siempre en INITIAL. El error se ve en el formulario.
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Rutina actualizada.' : 'Rutina creada.')
      onOpenChange(false)
    }
  }, [state, isEdit, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar rutina' : 'Nueva rutina semanal'}</DialogTitle>
          <DialogDescription>
            Algo que se repite todas las semanas. Los tildes se reinician solos cada lunes.
          </DialogDescription>
        </DialogHeader>

        <form
          key={routine?.id ?? 'new'}
          action={formAction}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="grid gap-4">
            <FormError message={state.ok ? null : state.message} />
            {isEdit ? <input type="hidden" name="id" value={routine.id} /> : null}

            <Field label="Nombre" name="title" required>
              <Input
                maxLength={160}
                defaultValue={routine?.title ?? ''}
                placeholder="Historia de Happy Hour"
              />
            </Field>

            <Field label="Detalle" name="description" optional>
              <Textarea
                rows={3}
                maxLength={400}
                defaultValue={routine?.description ?? ''}
                placeholder="Qué marcas, qué horario, qué se muestra…"
              />
            </Field>

            <Field
              label="Veces por semana"
              name="slots"
              required
              hint="Cuántos casilleros hay que tildar. 3 = hay que hacerla tres veces."
            >
              <NumberField
                min={1}
                max={14}
                defaultValue={routine?.slots ?? 1}
                incrementLabel="Una vez más"
                decrementLabel="Una vez menos"
                className="max-w-48"
              />
            </Field>
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            {isEdit ? (
              <DeleteRoutineButton
                tenantSlug={tenantSlug}
                routine={routine}
                onDeleted={() => onOpenChange(false)}
              />
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <SubmitButton pendingText="Guardando…">
                {isEdit ? 'Guardar cambios' : 'Crear rutina'}
              </SubmitButton>
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
  return (
    <ConfirmDialog
      tone="danger"
      icon={Trash2}
      title={`¿Borrar la rutina «${routine.title}»?`}
      description="Se borra la rutina y también el historial de tildes de todas las semanas."
      confirmLabel="Borrar rutina"
      pendingLabel="Borrando…"
      onConfirm={async () => {
        const result = await deleteRoutine(tenantSlug, routine.id)
        if (!result.ok) return result
        toast.success('Rutina borrada.')
        onDeleted()
      }}
      trigger={
        <Button type="button" variant="danger-ghost">
          <Trash2 aria-hidden />
          Borrar
        </Button>
      }
    />
  )
}
