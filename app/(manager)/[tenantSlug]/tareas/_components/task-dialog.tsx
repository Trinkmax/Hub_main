'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  STATUS_LABELS,
  TASK_CATEGORIES,
  TASK_KINDS,
  TASK_STATUSES,
  type TaskCategory,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow, TeamMember } from '@/lib/marketing/queries'

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
  // tablero salte a esa solapa y la tarea no "desaparezca".
  const submittedCategory = useRef<TaskCategory>(defaultCategory)

  const [state, formAction, pending] = useActionState(
    (prev: MarketingActionState, fd: FormData) => {
      const category = fd.get('category')
      if (typeof category === 'string' && isTaskCategory(category)) {
        submittedCategory.current = category
      }
      return isEdit
        ? updateMarketingTask(tenantSlug, prev, fd)
        : createMarketingTask(tenantSlug, prev, fd)
    },
    INITIAL,
  )

  // Depende del OBJETO `state`, no de `state.ok`: el objeto es nuevo por cada
  // submit. Con `state.ok` en las deps, el efecto se volvía a disparar cuando
  // cambiaba cualquier otra dep (p. ej. `isEdit` al pasar de alta a edición) y
  // cerraba el diálogo con un toast de éxito mentiroso. El padre además remonta
  // este componente en cada apertura, así que `state` arranca siempre en INITIAL.
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? 'Tarea actualizada.' : 'Tarea creada.')
      onSaved?.(submittedCategory.current)
      onOpenChange(false)
    } else if (state.message) {
      toast.error(state.message)
    }
  }, [state, isEdit, onOpenChange, onSaved])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // El dueño carga tareas desde el celular: el diálogo tiene que
        // scrollear adentro y no empujar el layout.
        className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
        // Sin esto, Radix enfoca el primer control y en mobile abre el teclado
        // tapando medio formulario.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {isEdit ? 'Editar tarea' : 'Cargar una tarea'}
          </DialogTitle>
          <DialogDescription>
            Lo que cargues acá lo ven todos los socios al instante.
          </DialogDescription>
        </DialogHeader>

        {/* `key` fuerza un form nuevo por tarea: sin esto los defaultValue
            quedan pegados al abrir otra tarea distinta. */}
        <form key={task?.id ?? 'new'} action={formAction} className="space-y-4">
          {isEdit ? <input type="hidden" name="id" value={task.id} /> : null}

          <Field label="Tarea" htmlFor="title" required>
            <Input
              id="title"
              name="title"
              required
              maxLength={160}
              defaultValue={task?.title ?? ''}
              placeholder="¿Qué hay que hacer?"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sección" htmlFor="category">
              <Select name="category" defaultValue={task?.category ?? defaultCategory}>
                <SelectTrigger id="category" className="w-full">
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

            <Field label="Tipo de tarea" htmlFor="kind">
              <Select name="kind" defaultValue={task?.kind ?? 'design'}>
                <SelectTrigger id="kind" className="w-full">
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
              id="responsible_user_id"
              label="Responsable"
              emptyLabel="Sin asignar"
              team={team}
              defaultValue={task?.responsibleId ?? null}
            />
            <PersonField
              id="involved_user_id"
              label="Involucrado"
              emptyLabel="Nadie más"
              team={team}
              defaultValue={task?.involvedId ?? null}
            />

            <Field label="Fecha ideal" htmlFor="ideal_date" hint="Cuándo estaría bueno que salga.">
              <Input
                id="ideal_date"
                name="ideal_date"
                type="date"
                defaultValue={task?.idealDate ?? ''}
              />
            </Field>
            <Field
              label="Fecha definida"
              htmlFor="defined_date"
              hint="Cuando ya hay compromiso. Manda sobre la ideal."
            >
              <Input
                id="defined_date"
                name="defined_date"
                type="date"
                defaultValue={task?.definedDate ?? ''}
              />
            </Field>
          </div>

          <Field label="Especificaciones" htmlFor="specifications">
            <Textarea
              id="specifications"
              name="specifications"
              rows={2}
              maxLength={2000}
              defaultValue={task?.specifications ?? ''}
              placeholder="Indicaciones concretas para hacerla"
              className="resize-none"
            />
          </Field>

          <Field label="Comentarios y contexto" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              maxLength={4000}
              defaultValue={task?.notes ?? ''}
              placeholder="Promos, textos, referencias y todo lo que haga falta"
              className="resize-none"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estado" htmlFor="status">
              <Select name="status" defaultValue={task?.status ?? 'todo'}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Link del archivo" htmlFor="file_url">
              <Input
                id="file_url"
                name="file_url"
                type="url"
                inputMode="url"
                defaultValue={task?.fileUrl ?? ''}
                placeholder="https://drive.google.com/…"
              />
            </Field>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <DeleteTaskButton tenantSlug={tenantSlug} task={task} onDeleted={onOpenChange} />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function PersonField({
  id,
  label,
  emptyLabel,
  team,
  defaultValue,
}: {
  id: string
  label: string
  emptyLabel: string
  team: TeamMember[]
  defaultValue: string | null
}) {
  // Radix Select no acepta "" como value, así que el "sin asignar" viaja como
  // centinela y el schema lo normaliza a null en el server.
  const [value, setValue] = useState(defaultValue ?? NOBODY)

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input type="hidden" name={id} value={value === NOBODY ? '' : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={id} className="w-full">
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
    </div>
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
          <AlertDialogTitle>¿Eliminar esta tarea?</AlertDialogTitle>
          <AlertDialogDescription>
            «{task.title}» se borra para todo el equipo y no se puede recuperar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await deleteMarketingTask(tenantSlug, task.id)
                if (result.ok) {
                  toast.success('Tarea eliminada.')
                  onDeleted(false)
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
