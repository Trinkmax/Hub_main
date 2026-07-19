'use client'

import { Check, Loader2, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type ConversationTagActionState,
  createConversationTag,
  deleteConversationTag,
  updateConversationTag,
} from '@/lib/conversation-tags/actions'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import { TAG_COLORS } from '@/lib/conversation-tags/schemas'

const INITIAL: ConversationTagActionState = { ok: true }

/** Nombres legibles para lectores de pantalla (paralelo a TAG_COLORS). */
const COLOR_NAMES: Record<string, string> = {
  '#94a3b8': 'Gris',
  '#f87171': 'Rojo',
  '#fb923c': 'Naranja',
  '#fbbf24': 'Ámbar',
  '#4ade80': 'Verde',
  '#34d399': 'Esmeralda',
  '#22d3ee': 'Cian',
  '#60a5fa': 'Azul',
  '#a78bfa': 'Violeta',
  '#f472b6': 'Rosa',
}

/** Chip grande con el color real de la etiqueta (fondo tintado + punto sólido). */
function TagChip({ tag }: { tag: ConversationTag }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-sm font-medium"
      style={{ backgroundColor: `${tag.color}1f` }}
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: tag.color }}
      />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

/** Radios de color desde la paleta curada. `name="color"` para el submit. */
function ColorSwatches({ defaultValue }: { defaultValue?: string }) {
  const palette = TAG_COLORS as readonly string[]
  const inPalette = defaultValue != null && palette.includes(defaultValue)
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-foreground">Color</legend>
      <div className="flex flex-wrap gap-2.5">
        {TAG_COLORS.map((c, i) => {
          const checked = inPalette ? c === defaultValue : i === 0
          return (
            <label key={c} className="cursor-pointer">
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={checked}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-background transition-transform hover:scale-110 peer-checked:ring-foreground/70 peer-focus-visible:ring-ring peer-checked:[&>svg]:opacity-100"
                style={{ backgroundColor: c }}
              >
                <Check
                  className="size-4 text-white opacity-0 drop-shadow-sm transition-opacity"
                  aria-hidden
                />
              </span>
              <span className="sr-only">{COLOR_NAMES[c] ?? c}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function TagsManager({ tenantSlug, tags }: { tenantSlug: string; tags: ConversationTag[] }) {
  const formRef = useRef<HTMLFormElement>(null)
  const firstRun = useRef(true)
  const [createState, createAction, creating] = useActionState(
    createConversationTag.bind(null, tenantSlug),
    INITIAL,
  )

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (createState.ok) {
      toast.success('Etiqueta creada.')
      formRef.current?.reset()
    } else {
      toast.error(createState.message)
    }
  }, [createState])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card p-4 sm:p-5">
        <h2 className="text-base font-medium tracking-tight">Nueva etiqueta</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Poné un nombre corto y elegí un color para reconocerla de un vistazo.
        </p>
        <form ref={formRef} action={createAction} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-tag-name">Nombre</Label>
            <Input
              id="new-tag-name"
              name="name"
              placeholder="Reservas, Quejas, VIP…"
              maxLength={40}
              required
            />
          </div>
          <ColorSwatches />
          <div className="flex justify-end">
            <Button type="submit" disabled={creating} className="gap-1.5">
              {creating ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              Agregar etiqueta
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium tracking-tight">
          Tus etiquetas
          {tags.length > 0 ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{tags.length}</span>
          ) : null}
        </h2>
        {tags.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border/70 bg-secondary/60 text-muted-foreground">
              <Tags className="size-5" aria-hidden />
            </div>
            <p className="text-base font-medium">Todavía no hay etiquetas</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground text-pretty">
              Creá la primera con el formulario de arriba. Ideas para arrancar: Reservas, Quejas,
              VIP.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
            {tags.map((tag) => (
              <TagRow key={tag.id} tenantSlug={tenantSlug} tag={tag} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TagRow({ tenantSlug, tag }: { tenantSlug: string; tag: ConversationTag }) {
  const [editOpen, setEditOpen] = useState(false)
  const firstUpdate = useRef(true)
  const firstDelete = useRef(true)

  const [updateState, updateAction, updating] = useActionState(
    updateConversationTag.bind(null, tenantSlug),
    INITIAL,
  )
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteConversationTag.bind(null, tenantSlug),
    INITIAL,
  )

  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false
      return
    }
    if (updateState.ok) {
      toast.success('Etiqueta actualizada.')
      setEditOpen(false)
    } else {
      toast.error(updateState.message)
    }
  }, [updateState])

  useEffect(() => {
    if (firstDelete.current) {
      firstDelete.current = false
      return
    }
    // En éxito, revalidatePath re-renderiza la lista y esta fila se desmonta.
    if (!deleteState.ok) toast.error(deleteState.message)
  }, [deleteState])

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/30 sm:px-4">
      <div className="min-w-0 flex-1">
        <TagChip tag={tag} />
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Editar ${tag.name}`}>
            <Pencil className="size-4" aria-hidden />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar etiqueta</DialogTitle>
            <DialogDescription>Cambiá el nombre o el color de la etiqueta.</DialogDescription>
          </DialogHeader>
          <form action={updateAction} className="space-y-4">
            <input type="hidden" name="id" value={tag.id} />
            <div className="space-y-1.5">
              <Label htmlFor={`name-${tag.id}`}>Nombre</Label>
              <Input
                id={`name-${tag.id}`}
                name="name"
                defaultValue={tag.name}
                maxLength={40}
                required
              />
            </div>
            <ColorSwatches defaultValue={tag.color} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={updating} className="gap-1.5">
                {updating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Borrar ${tag.name}`}
            className="size-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar “{tag.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a quitar de todas las conversaciones que la tengan. Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={tag.id} />
              <Button type="submit" variant="destructive" disabled={deleting} className="gap-1.5">
                {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Borrar
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
