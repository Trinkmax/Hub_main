'use client'

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { createItemTag, deleteItemTag, updateItemTag } from '@/lib/item-tags/actions'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import { ROW_LIST_CLASSES, TagDot } from './menu-ui'

const DEFAULT_COLOR = '#94a3b8'

type EditingState = { id: string; name: string; color: string } | null

/** El selector de color nativo, con el tamaño y el foco de los controles del kit. */
function ColorInput({
  value,
  onChange,
  label,
  id,
}: {
  value: string
  onChange: (next: string) => void
  label?: string
  id?: string
}) {
  return (
    <input
      id={id}
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="size-(--control-md) shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
    />
  )
}

export function TagsManagerDialog({
  tenantSlug,
  tags,
  trigger,
}: {
  tenantSlug: string
  tags: ItemTagRow[]
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EditingState>(null)
  const [toDelete, setToDelete] = useState<ItemTagRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [creating, startCreating] = useTransition()
  const [saving, startSaving] = useTransition()

  // Si cierran el dialog, reiniciamos formularios locales para no mostrar
  // errores ni borradores rancios cuando vuelvan a abrir.
  useEffect(() => {
    if (!open) {
      setEditing(null)
      setDeleteOpen(false)
      setNewName('')
      setNewColor(DEFAULT_COLOR)
      setCreateError(null)
      setEditError(null)
    }
  }, [open])

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateError(null)
    if (newName.trim().length === 0) {
      setCreateError('Ponele un nombre.')
      return
    }
    const fd = new FormData()
    fd.set('name', newName.trim())
    fd.set('color', newColor)
    startCreating(async () => {
      const r = await createItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (r.ok) {
        toast.success(`Etiqueta «${newName.trim()}» creada.`)
        setNewName('')
        setNewColor(DEFAULT_COLOR)
      } else {
        setCreateError(r.message)
      }
    })
  }

  const handleUpdate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    setEditError(null)
    if (editing.name.trim().length === 0) {
      setEditError('Ponele un nombre.')
      return
    }
    const current = editing
    const fd = new FormData()
    fd.set('id', current.id)
    fd.set('name', current.name.trim())
    fd.set('color', current.color)
    startSaving(async () => {
      const r = await updateItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (r.ok) {
        toast.success('Etiqueta actualizada.')
        setEditing(null)
      } else {
        setEditError(r.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Etiquetas de la carta</DialogTitle>
          <DialogDescription>
            Marcá tus ítems con etiquetas como Vegano, Sin TACC, Picante o Sin alcohol. En la carta
            se ven como chips de color.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-6">
          {/* Listado actual */}
          <section aria-labelledby="tags-existing-title" className="grid gap-2">
            <h3 id="tags-existing-title" className="type-label text-foreground">
              Las que ya tenés
            </h3>
            {tags.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center type-small text-muted-foreground">
                Todavía no hay etiquetas. Creá la primera acá abajo.
              </p>
            ) : (
              <ul className={ROW_LIST_CLASSES}>
                {tags.map((t) => {
                  const isEditing = editing?.id === t.id
                  if (isEditing) {
                    return (
                      <li key={t.id} className="px-3 py-2.5">
                        <form onSubmit={handleUpdate} className="grid gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <ColorInput
                              value={editing.color}
                              onChange={(color) => setEditing({ ...editing, color })}
                              label="Color de la etiqueta"
                            />
                            <Input
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                              maxLength={40}
                              autoFocus
                              invalid={editError !== null}
                              className="min-w-0 flex-1"
                              aria-label="Nombre de la etiqueta"
                            />
                            <Button
                              type="submit"
                              size="icon-sm"
                              variant="ghost"
                              loading={saving}
                              aria-label="Guardar la etiqueta"
                            >
                              <Check aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                setEditing(null)
                                setEditError(null)
                              }}
                              disabled={saving}
                              aria-label="Cancelar la edición"
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </div>
                          {editError ? (
                            <p role="alert" className="type-caption text-destructive-text">
                              {editError}
                            </p>
                          ) : null}
                        </form>
                      </li>
                    )
                  }
                  const count = t.assignment_count ?? 0
                  return (
                    <li key={t.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                      <TagDot color={t.color} className="size-3" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate type-body font-medium">{t.name}</p>
                        <p className="type-caption type-amount text-muted-foreground">
                          {count === 0
                            ? 'Sin ítems asignados'
                            : `${count} ${count === 1 ? 'ítem' : 'ítems'}`}
                        </p>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })}
                        aria-label={`Editar ${t.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="danger-ghost"
                        onClick={() => {
                          setToDelete(t)
                          setDeleteOpen(true)
                        }}
                        aria-label={`Borrar ${t.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Crear nueva */}
          <form
            onSubmit={handleCreate}
            aria-labelledby="tags-new-title"
            className="grid gap-3 border-t border-border pt-6"
          >
            <h3 id="tags-new-title" className="type-label text-foreground">
              Nueva etiqueta
            </h3>
            <div className="grid items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Field label="Color">
                {(control) => (
                  <ColorInput id={control.id} value={newColor} onChange={setNewColor} />
                )}
              </Field>
              <Field label="Nombre" error={createError}>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={40}
                  placeholder="Vegano, Sin TACC, Picante…"
                />
              </Field>
              <Button
                type="submit"
                loading={creating}
                disabled={newName.trim().length === 0}
                className="sm:mt-[calc(1.125rem+0.5rem)]"
              >
                <Plus aria-hidden="true" />
                Crear
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tone="danger"
        title={`¿Borrar la etiqueta «${toDelete?.name ?? ''}»?`}
        description={
          toDelete && (toDelete.assignment_count ?? 0) > 0
            ? `Se quita de ${toDelete.assignment_count} ${toDelete.assignment_count === 1 ? 'ítem' : 'ítems'}. No se puede deshacer.`
            : 'No tiene ítems asignados. No se puede deshacer.'
        }
        confirmLabel="Borrar etiqueta"
        pendingLabel="Borrando…"
        onConfirm={async () => {
          if (!toDelete) return
          const target = toDelete
          const r = await deleteItemTag(tenantSlug, target.id)
          if (!r.ok) return r
          toast.success(r.message ?? `Etiqueta «${target.name}» borrada.`)
        }}
      />
    </Dialog>
  )
}
