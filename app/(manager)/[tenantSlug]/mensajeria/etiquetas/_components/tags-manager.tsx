'use client'

import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
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

/** Radios de color desde la paleta curada. `name="color"` para el submit. */
function ColorSwatches({ defaultValue }: { defaultValue?: string }) {
  const palette = TAG_COLORS as readonly string[]
  const inPalette = defaultValue != null && palette.includes(defaultValue)
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-foreground">Color</legend>
      <div className="flex flex-wrap gap-2">
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
                className="block size-7 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-background transition-transform hover:scale-110 peer-checked:ring-foreground peer-focus-visible:ring-ring"
                style={{ backgroundColor: c }}
              />
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
      toast.success('Etiqueta creada')
      formRef.current?.reset()
    } else {
      toast.error(createState.message)
    }
  }, [createState])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/70 bg-card/85 p-5">
        <h2 className="mb-4 font-serif text-lg font-semibold tracking-tight">Nueva etiqueta</h2>
        <form ref={formRef} action={createAction} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="new-tag-name">Nombre</Label>
            <Input
              id="new-tag-name"
              name="name"
              placeholder="VIP, Reclamo, Reserva…"
              maxLength={40}
              required
            />
          </div>
          <ColorSwatches />
          <Button type="submit" disabled={creating} className="gap-1.5">
            {creating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            Agregar
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold tracking-tight">
          Etiquetas
          {tags.length > 0 ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{tags.length}</span>
          ) : null}
        </h2>
        {tags.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay etiquetas. Creá la primera arriba para empezar a organizar el inbox.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/60">
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
      toast.success('Etiqueta actualizada')
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
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: tag.color }}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Editar ${tag.name}`}>
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
            className="text-muted-foreground hover:text-destructive"
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
