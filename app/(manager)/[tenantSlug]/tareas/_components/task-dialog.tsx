'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldRow, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { Textarea } from '@/components/ui/textarea'
import {
  createMarketingTask,
  deleteMarketingTask,
  type MarketingActionState,
  updateMarketingTask,
} from '@/lib/marketing/actions'
import {
  CATEGORY_LABELS,
  isTaskCategory,
  KIND_LABELS,
  TASK_CATEGORIES,
  TASK_KINDS,
  TASK_STATUSES,
  type TaskCategory,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow, TeamMember } from '@/lib/marketing/queries'
import { TASK_STATUS_META } from './task-status'

const INITIAL: MarketingActionState = { ok: false, message: '' }

/** Valor centinela del combo: Radix Select no admite `value=""`. */
const NOBODY = 'none'

export function TaskDialog({
  tenantSlug,
  team,
  task,
  defaultCategory,
  open,
  onOpenChange,
  onSaved,
}: {
  tenantSlug: string
  team: TeamMember[]
  /** null = alta. */
  task: MarketingTaskRow | null
  defaultCategory: TaskCategory
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se llama con la sección elegida cuando el guardado salió bien. */
  onSaved?: (category: TaskCategory) => void
}) {
  const isEdit = task !== null

  // Dónde cae la tarea recién creada: la sección la elige el combo del form,
  // así que se lee del FormData en el momento de enviar. Sirve para que el
  // tablero salte a esa pestaña y la tarea no "desaparezca".
  const submittedCategory = useRef<TaskCategory>(defaultCategory)

  const [state, formAction] = useActionState((prev: MarketingActionState, fd: FormData) => {
    const category = fd.get('category')
    if (typeof category === 'string' && isTaskCategory(category)) {
      submittedCategory.current = category
    }
    return isEdit
      ? updateMarketingTask(tenantSlug, prev, fd)
      : createMarketingTask(tenantSlug, prev, fd)
  }, INITIAL)

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar cuando
  // cambiaba cualquier otra dep (p. ej. `isEdit` al pasar de alta a edición) y
  // cerraba el diálogo con un toast de éxito mentiroso. El padre además remonta
  // este componente en cada apertura, así que `state` arranca siempre en INITIAL.
  // El error no va en un toast: se muestra adentro del formulario (FormError).
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Tarea actualizada.' : 'Tarea creada.')
      onSaved?.(submittedCategory.current)
      onOpenChange(false)
    }
  }, [state, isEdit, onOpenChange, onSaved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        // El dueño carga tareas desde el celular: si el foco fuera al primer
        // campo, el teclado taparía medio formulario. Va a la caja del diálogo,
        // que el lector de pantalla anuncia con su título.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle>
          <DialogDescription>
            Lo que cargues acá lo ven todos los socios al instante.
          </DialogDescription>
        </DialogHeader>

        {/* `key` fuerza un form nuevo por tarea: sin esto los defaultValue
            quedan pegados al abrir otra tarea distinta. */}
        <form
          key={task?.id ?? 'new'}
          action={formAction}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody className="grid gap-4">
            <FormError message={state.ok ? null : state.message} />
            {isEdit ? <input type="hidden" name="id" value={task.id} /> : null}

            <Field label="Tarea" name="title" required>
              <Input
                maxLength={160}
                defaultValue={task?.title ?? ''}
                placeholder="¿Qué hay que hacer?"
              />
            </Field>

            <FieldRow>
              <Field label="Sección" name="category">
                <Select defaultValue={task?.category ?? defaultCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_CATEGORIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {CATEGORY_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Tipo de tarea" name="kind">
                <Select defaultValue={task?.kind ?? 'design'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_KINDS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {KIND_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <PersonField
                name="responsible_user_id"
                label="Responsable"
                emptyLabel="Sin asignar"
                team={team}
                defaultValue={task?.responsibleId ?? null}
              />
              <PersonField
                name="involved_user_id"
                label="Involucrado"
                emptyLabel="Nadie más"
                team={team}
                defaultValue={task?.involvedId ?? null}
              />

              <Field
                label="Fecha ideal"
                name="ideal_date"
                optional
                hint="Cuándo estaría bueno que salga."
              >
                <DatePicker defaultValue={task?.idealDate ?? null} clearable />
              </Field>
              <Field
                label="Fecha definida"
                name="defined_date"
                optional
                hint="Cuando ya hay compromiso. Manda sobre la ideal."
              >
                <DatePicker defaultValue={task?.definedDate ?? null} clearable />
              </Field>
            </FieldRow>

            <Field label="Especificaciones" name="specifications" optional>
              <Textarea
                rows={2}
                maxLength={2000}
                defaultValue={task?.specifications ?? ''}
                placeholder="Indicaciones concretas para hacerla"
              />
            </Field>

            <Field label="Comentarios y contexto" name="notes" optional>
              <Textarea
                rows={4}
                maxLength={4000}
                defaultValue={task?.notes ?? ''}
                placeholder="Promos, textos, referencias y todo lo que haga falta"
              />
            </Field>

            <FieldRow>
              <Field label="Estado" name="status">
                <Select defaultValue={task?.status ?? 'todo'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {TASK_STATUS_META[value].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Link del archivo" name="file_url" optional>
                <Input
                  type="url"
                  inputMode="url"
                  defaultValue={task?.fileUrl ?? ''}
                  placeholder="https://drive.google.com/…"
                />
              </Field>
            </FieldRow>
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            {isEdit ? (
              <DeleteTaskButton tenantSlug={tenantSlug} task={task} onDeleted={onOpenChange} />
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:ms-auto sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <SubmitButton pendingText="Guardando…">
                {isEdit ? 'Guardar cambios' : 'Crear tarea'}
              </SubmitButton>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PersonField({
  name,
  label,
  emptyLabel,
  team,
  defaultValue,
}: {
  name: string
  label: string
  emptyLabel: string
  team: TeamMember[]
  defaultValue: string | null
}) {
  // Radix Select no acepta "" como value, así que el "sin asignar" viaja como
  // centinela y el hidden lo manda vacío (el schema lo normaliza a null).
  const [value, setValue] = useState(defaultValue ?? NOBODY)

  return (
    <>
      <input type="hidden" name={name} value={value === NOBODY ? '' : value} />
      <Field label={label}>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>{emptyLabel}</SelectItem>
            {team.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}

function DeleteTaskButton({
  tenantSlug,
  task,
  onDeleted,
}: {
  tenantSlug: string
  task: MarketingTaskRow
  onDeleted: (open: boolean) => void
}) {
  return (
    <ConfirmDialog
      tone="danger"
      icon={Trash2}
      title={`¿Borrar la tarea «${task.title}»?`}
      description="Se borra para todo el equipo y no se puede recuperar."
      confirmLabel="Borrar tarea"
      pendingLabel="Borrando…"
      onConfirm={async () => {
        const result = await deleteMarketingTask(tenantSlug, task.id)
        if (!result.ok) return result
        toast.success('Tarea borrada.')
        onDeleted(false)
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
