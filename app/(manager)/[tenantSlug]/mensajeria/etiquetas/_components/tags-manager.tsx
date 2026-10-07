'use client'

import { Check, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useEffectEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, type ConfirmFormState } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { FormActions } from '@/components/ui/form-actions'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  type ConversationTagActionState,
  createConversationTag,
  deleteConversationTag,
  updateConversationTag,
} from '@/lib/conversation-tags/actions'
import type { ConversationTag } from '@/lib/conversation-tags/queries'
import { TAG_COLORS } from '@/lib/conversation-tags/schemas'
import { toConfirmState } from '../../_components/confirm-state'

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

/**
 * La etiqueta como se ve en los chats: fondo tintado del color y punto sólido.
 * El nombre va en tinta (el color de la paleta como letra no se leía).
 */
function TagChip({ tag }: { tag: ConversationTag }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border px-3 py-1 type-body font-medium text-foreground"
      style={{ backgroundColor: `${tag.color}1f` }}
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10 ring-inset"
        style={{ backgroundColor: tag.color }}
      />
      <span className="truncate">{tag.name}</span>
    </span>
  )
}

/**
 * Radios de color desde la paleta curada (`name="color"` para el submit). El
 * elegido lleva check y un aro de tinta (forma y contraste, no solo color); el
 * foco es el contorno del panel. Sin agrandar al pasar el mouse.
 */
function ColorSwatches({ defaultValue }: { defaultValue?: string }) {
  const palette = TAG_COLORS as readonly string[]
  const inPalette = defaultValue != null && palette.includes(defaultValue)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 type-label text-foreground">Color</legend>
      <div className="flex flex-wrap gap-2.5">
        {TAG_COLORS.map((c, i) => {
          const checked = inPalette ? c === defaultValue : i === 0
          return (
            <label key={c} className="relative cursor-pointer hit-area">
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={checked}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-background peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-(--ring) peer-checked:[&>svg]:opacity-100"
                style={{ backgroundColor: c }}
              >
                {/* El aro de tinta marca la elegida (3:1 o más en los dos temas);
                    el check blanco acompaña. */}
                <Check
                  className="size-4 text-white opacity-0 drop-shadow-sm"
                  strokeWidth={3}
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
  const [editing, setEditing] = useState<ConversationTag | null>(null)
  const [createState, createAction] = useActionState(
    createConversationTag.bind(null, tenantSlug),
    INITIAL,
  )
  // Cada respuesta se atiende una sola vez, por identidad (con un «primera
  // vez» en un ref, el doble efecto del modo estricto avisaba al montar).
  const handledCreate = useRef(createState)

  useEffect(() => {
    if (createState === handledCreate.current) return
    handledCreate.current = createState
    if (createState.ok) {
      toast.success('Etiqueta creada.')
      formRef.current?.reset()
    } else {
      toast.error(createState.message)
    }
  }, [createState])

  return (
    <>
      <Section
        title="Nueva etiqueta"
        description="Poné un nombre corto y elegí un color para reconocerla de un vistazo."
      >
        <form ref={formRef} action={createAction} className="flex flex-col gap-4">
          <Field label="Nombre">
            <Input name="name" placeholder="Reservas, Quejas, VIP…" maxLength={40} required />
          </Field>
          <ColorSwatches />
          <FormActions sticky={false}>
            <SubmitButton pendingText="Agregando…">
              <Plus aria-hidden />
              Agregar etiqueta
            </SubmitButton>
          </FormActions>
        </form>
      </Section>

      <Section divider title="Tus etiquetas" description={tagsCountText(tags.length)}>
        <DataTable
          caption="Tus etiquetas"
          rows={tags}
          getRowId={(tag) => tag.id}
          empty={
            <EmptyState
              size="sm"
              icon={Tags}
              title="Todavía no hay etiquetas"
              description="Creá la primera con el formulario de arriba. Ideas para arrancar: Reservas, Quejas, VIP."
            />
          }
          columns={[
            {
              id: 'tag',
              header: 'Etiqueta',
              cell: (tag) => <TagChip tag={tag} />,
            },
            {
              id: 'actions',
              header: 'Acciones',
              headerHidden: true,
              align: 'end',
              width: '6rem',
              cell: (tag) => (
                <TagActions tenantSlug={tenantSlug} tag={tag} onEdit={() => setEditing(tag)} />
              ),
            },
          ]}
        />
      </Section>

      <EditTagDialog
        tenantSlug={tenantSlug}
        tag={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
    </>
  )
}

function tagsCountText(count: number): string {
  if (count === 0) return 'Las que crees aparecen acá.'
  return count === 1 ? '1 etiqueta' : `${count} etiquetas`
}

function TagActions({
  tenantSlug,
  tag,
  onEdit,
}: {
  tenantSlug: string
  tag: ConversationTag
  onEdit: () => void
}) {
  async function remove(_prev: ConfirmFormState, formData: FormData) {
    const result = await deleteConversationTag(tenantSlug, INITIAL, formData)
    // En éxito, revalidatePath re-renderiza la lista y esta fila se va.
    if (result.ok) toast.success('Etiqueta borrada.')
    return toConfirmState(result)
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon-sm" aria-label={`Editar ${tag.name}`} onClick={onEdit}>
        <Pencil aria-hidden />
      </Button>
      <ConfirmDialog
        tone="danger"
        icon={Trash2}
        title={`¿Borrar la etiqueta «${tag.name}»?`}
        description="Se quita de todas las conversaciones que la tengan. No se puede deshacer."
        confirmLabel="Borrar etiqueta"
        pendingLabel="Borrando…"
        formAction={remove}
        hiddenFields={{ id: tag.id }}
        trigger={
          <Button variant="danger-ghost" size="icon-sm" aria-label={`Borrar ${tag.name}`}>
            <Trash2 aria-hidden />
          </Button>
        }
      />
    </div>
  )
}

function EditTagDialog({
  tenantSlug,
  tag,
  onOpenChange,
}: {
  tenantSlug: string
  tag: ConversationTag | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={tag !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Editar etiqueta</DialogTitle>
          <DialogDescription>Cambiá el nombre o el color de la etiqueta.</DialogDescription>
        </DialogHeader>
        {/* key: cada etiqueta arranca su formulario de cero. */}
        {tag ? (
          <EditTagForm
            key={tag.id}
            tenantSlug={tenantSlug}
            tag={tag}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditTagForm({
  tenantSlug,
  tag,
  onDone,
}: {
  tenantSlug: string
  tag: ConversationTag
  onDone: () => void
}) {
  const [updateState, updateAction] = useActionState(
    updateConversationTag.bind(null, tenantSlug),
    INITIAL,
  )
  const handledUpdate = useRef(updateState)
  // Solo la respuesta del server dispara el aviso: que el padre se vuelva a
  // dibujar (y `onDone` cambie de identidad) no cierra el diálogo.
  const done = useEffectEvent(onDone)

  useEffect(() => {
    if (updateState === handledUpdate.current) return
    handledUpdate.current = updateState
    if (updateState.ok) {
      toast.success('Etiqueta actualizada.')
      done()
    } else {
      toast.error(updateState.message)
    }
  }, [updateState])

  return (
    <form action={updateAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={tag.id} />
      <Field label="Nombre">
        <Input name="name" defaultValue={tag.name} maxLength={40} required />
      </Field>
      <ColorSwatches defaultValue={tag.color} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
      </DialogFooter>
    </form>
  )
}
