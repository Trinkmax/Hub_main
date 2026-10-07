'use client'

import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createItemTag, deleteItemTag, updateItemTag } from '@/lib/item-tags/actions'
import type { ItemTagRow } from '@/lib/item-tags/queries'

const DEFAULT_COLOR = '#94a3b8'

type EditingState = { id: string; name: string; color: string } | null

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
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Si cierran el dialog, reiniciamos formularios locales para no mostrar
  // errores ni borradores rancios cuando vuelvan a abrir.
  useEffect(() => {
    if (!open) {
      setEditing(null)
      setToDelete(null)
      setNewName('')
      setNewColor(DEFAULT_COLOR)
      setCreateError(null)
      setEditError(null)
    }
  }, [open])

  const handleCreate = () => {
    setCreateError(null)
    if (newName.trim().length === 0) {
      setCreateError('Ponele un nombre.')
      return
    }
    const fd = new FormData()
    fd.set('name', newName.trim())
    fd.set('color', newColor)
    startTransition(async () => {
      const r = await createItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (r.ok) {
        toast.success(`Etiqueta "${newName.trim()}" creada.`)
        setNewName('')
        setNewColor(DEFAULT_COLOR)
      } else {
        setCreateError(r.message)
      }
    })
  }

  const handleUpdate = () => {
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
    startTransition(async () => {
      const r = await updateItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (r.ok) {
        toast.success('Etiqueta actualizada.')
        setEditing(null)
      } else {
        setEditError(r.message)
      }
    })
  }

  const handleDelete = () => {
    if (!toDelete) return
    const target = toDelete
    startTransition(async () => {
      const r = await deleteItemTag(tenantSlug, target.id)
      if (r.ok) {
        toast.success(r.message ?? `Etiqueta "${target.name}" eliminada.`)
        setToDelete(null)
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-semibold tracking-tight">
            Etiquetas del menú
          </DialogTitle>
          <DialogDescription>
            Marcá tus ítems con etiquetas como Vegano, Sin TACC, Picante, Sin alcohol…
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Listado actual */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Existentes
            </h3>
            {tags.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/30 p-6 text-center text-sm text-muted-foreground">
                Todavía no hay etiquetas. Creá la primera abajo.
              </div>
            ) : (
              <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-lg border bg-card">
                {tags.map((t) => {
                  const isEditing = editing?.id === t.id
                  if (isEditing) {
                    return (
                      <li key={t.id} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="color"
                            value={editing.color}
                            onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                            className="size-8 cursor-pointer rounded border border-border bg-transparent"
                            aria-label="Color"
                          />
                          <Input
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            maxLength={40}
                            className="h-8 flex-1 min-w-0"
                            aria-label="Nombre de la etiqueta"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={handleUpdate}
                            disabled={pending}
                            aria-label="Guardar"
                            className="size-8"
                          >
                            <Check className="size-4 text-success" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditing(null)
                              setEditError(null)
                            }}
                            disabled={pending}
                            aria-label="Cancelar"
                            className="size-8"
                          >
                            <X className="size-4 text-muted-foreground" />
                          </Button>
                        </div>
                        {editError ? (
                          <p className="mt-1.5 text-xs text-destructive">{editError}</p>
                        ) : null}
                      </li>
                    )
                  }
                  const count = t.assignment_count ?? 0
                  return (
                    <li
                      key={t.id}
                      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/30"
                    >
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-full border border-border/40"
                        style={{ backgroundColor: t.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.name}</p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {count === 0
                            ? 'Sin ítems asignados'
                            : `${count} ítem${count === 1 ? '' : 's'}`}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditing({ id: t.id, name: t.name, color: t.color })}
                        aria-label={`Editar ${t.name}`}
                        className="size-8 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setToDelete(t)}
                        aria-label={`Eliminar ${t.name}`}
                        className="size-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* Crear nueva */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Nueva etiqueta
            </h3>
            <div className="card-hairline rounded-lg border bg-card p-3">
              <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="new-tag-color"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Color
                  </Label>
                  <input
                    id="new-tag-color"
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded border border-border bg-transparent"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="new-tag-name"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                  >
                    Nombre
                  </Label>
                  <Input
                    id="new-tag-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={40}
                    placeholder="Vegano, Sin TACC, Picante…"
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleCreate}
                  disabled={pending || newName.trim().length === 0}
                  className="gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Crear
                </Button>
              </div>
              {createError ? (
                <p className="mt-2 text-xs text-destructive">{createError}</p>
              ) : (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Tag className="size-3" />
                  Las etiquetas aparecen como pills coloreadas en cada ítem.
                </p>
              )}
            </div>
          </section>
        </div>
      </DialogContent>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la etiqueta "{toDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && (toDelete.assignment_count ?? 0) > 0
                ? `Se quitará de ${toDelete.assignment_count} ítem${toDelete.assignment_count === 1 ? '' : 's'}. No se puede deshacer.`
                : 'No tiene ítems asignados. No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
