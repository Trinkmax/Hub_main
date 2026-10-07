'use client'

import { Plus, Tag, UtensilsCrossed, X } from 'lucide-react'
import { useActionState, useEffect, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FormError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { SubmitButton } from '@/components/ui/submit-button'
import {
  createItemTag,
  deleteItemTag,
  type TagActionState,
  toggleTagOnMenuItem,
} from '@/lib/item-tags/actions'
import type { ItemTagRow, ItemWithTags } from '@/lib/item-tags/queries'
import { cn } from '@/lib/utils'
import { TagDot } from '../../_components/menu-ui'

const initial: TagActionState = { ok: false, message: '' }

/**
 * Un tag como chip con su casilla: tocar el chip entero la marca. El id es
 * propio de cada instancia (la tabla dibuja la celda dos veces: tabla y
 * tarjeta del celular), así la etiqueta nunca apunta a la casilla escondida.
 */
function TagToggle({
  name,
  color,
  checked,
  disabled,
  onCheckedChange,
}: {
  name: string
  color: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-full border px-2.5 type-caption font-medium',
        checked
          ? 'border-primary bg-card text-foreground'
          : 'border-border-strong text-muted-foreground hover:bg-hover',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
      />
      <TagDot color={color} />#{name}
    </label>
  )
}

export function TagsManager({
  tenantSlug,
  initialTags,
  initialItems,
}: {
  tenantSlug: string
  initialTags: ItemTagRow[]
  initialItems: ItemWithTags[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [items, setItems] = useState(initialItems)
  const [pending, startTransition] = useTransition()
  const [toDelete, setToDelete] = useState<ItemTagRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [state, action] = useActionState(
    (prev: TagActionState, fd: FormData) => createItemTag(tenantSlug, prev, fd),
    initial,
  )

  useEffect(() => {
    if (state.ok) setShowCreate(false)
  }, [state.ok])

  const handleToggle = (menuItemId: string, tagId: string, enable: boolean) => {
    startTransition(async () => {
      const r = await toggleTagOnMenuItem(tenantSlug, menuItemId, tagId, enable)
      if (r.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === menuItemId
              ? {
                  ...it,
                  tag_ids: enable ? [...it.tag_ids, tagId] : it.tag_ids.filter((t) => t !== tagId),
                }
              : it,
          ),
        )
      } else toast.error(r.message)
    })
  }

  return (
    <>
      <Callout tone="info">
        Estos tags se usan en las punch cards que se sellan «Al consumir una etiqueta». En la carta
        se administran desde «Gestionar etiquetas».
      </Callout>

      <Section
        title="Tags disponibles"
        actions={
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button>
                <Plus aria-hidden="true" />
                Nuevo tag
              </Button>
            </DialogTrigger>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Nuevo tag</DialogTitle>
                <DialogDescription>Un nombre corto y un color para reconocerlo.</DialogDescription>
              </DialogHeader>
              <form action={action} className="flex min-h-0 flex-1 flex-col gap-4">
                <DialogBody className="grid gap-4">
                  <FormError message={!state.ok && state.message ? state.message : null} />
                  <Field label="Nombre" name="name" required>
                    <Input autoFocus maxLength={40} placeholder="cafe, vegano, sin-tacc…" />
                  </Field>
                  <Field label="Color">
                    {(control) => (
                      <input
                        id={control.id}
                        name="color"
                        type="color"
                        defaultValue="#94a3b8"
                        className="h-(--control-md) w-16 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
                      />
                    )}
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                    Cancelar
                  </Button>
                  <SubmitButton pendingText="Creando…">Crear tag</SubmitButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      >
        {initialTags.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Tag}
            title="Todavía no hay tags"
            description="Creá el primero con «Nuevo tag»: después lo asignás a los ítems acá abajo."
          />
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Tags disponibles">
            {initialTags.map((t) => (
              <li key={t.id}>
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-card ps-3 pe-0.5 type-label text-foreground">
                  <TagDot color={t.color} />#{t.name}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 rounded-full"
                    disabled={pending}
                    onClick={() => {
                      setToDelete(t)
                      setDeleteOpen(true)
                    }}
                    aria-label={`Borrar el tag #${t.name}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Asignar tags a ítems"
        description="Marcá los tags de cada ítem: se guardan al toque."
      >
        <DataTable
          caption="Ítems de la carta y sus tags"
          rows={items}
          getRowId={(it) => it.id}
          empty={
            <EmptyState
              size="sm"
              icon={UtensilsCrossed}
              title="Sin ítems en la carta todavía"
              description="Cargá la carta primero y volvé a etiquetarla."
            />
          }
          columns={[
            {
              id: 'item',
              header: 'Ítem',
              width: '16rem',
              cell: (it) => (
                <span className="flex flex-col">
                  <span className="type-body font-medium">{it.name}</span>
                  {it.category_name ? (
                    <span className="type-caption text-muted-foreground">{it.category_name}</span>
                  ) : null}
                </span>
              ),
            },
            {
              id: 'tags',
              header: 'Tags',
              mobile: 'meta',
              cell: (it) =>
                initialTags.length === 0 ? (
                  <span className="type-small text-muted-foreground">—</span>
                ) : (
                  <ul className="flex flex-wrap gap-2 py-1" aria-label={`Tags de ${it.name}`}>
                    {initialTags.map((tag) => {
                      const enabled = it.tag_ids.includes(tag.id)
                      return (
                        <li key={tag.id}>
                          <TagToggle
                            name={tag.name}
                            color={tag.color}
                            checked={enabled}
                            disabled={pending}
                            onCheckedChange={(v) => handleToggle(it.id, tag.id, v)}
                          />
                        </li>
                      )
                    })}
                  </ul>
                ),
            },
          ]}
        />
      </Section>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar el tag «#${toDelete?.name ?? ''}»?`}
        description="Se quita de todos los ítems que lo tienen. No se puede deshacer."
        confirmLabel="Borrar tag"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const r = await deleteItemTag(tenantSlug, target.id)
          if (!r.ok) return { ok: false, error: r.message }
          toast.success(`Tag «#${target.name}» borrado.`)
        }}
      />
    </>
  )
}
