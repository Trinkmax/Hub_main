'use client'

import { Check, Megaphone, Plus, Sparkles, Tag, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { createItemTag } from '@/lib/item-tags/actions'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import { deleteMenuItem, updateMenuItem } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { MenuImageUploader } from './image-uploader'

const NEW_TAG_DEFAULT_COLOR = '#94a3b8'

function fmtARS(cents: number): string {
  if (!Number.isFinite(cents)) return ''
  return `$${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function ItemEditDialog({
  item,
  tenantSlug,
  tenantId,
  categories,
  allTags,
  onClose,
}: {
  item: MenuItem
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  allTags: ItemTagRow[]
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [description, setDescription] = useState(item.description ?? '')
  const [categoryId, setCategoryId] = useState(item.category_id)
  const [priceCents, setPriceCents] = useState(String(item.price_cents))
  const [pointsOverride, setPointsOverride] = useState(
    item.points_override === null ? '' : String(item.points_override),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url ?? null)
  const [active, setActive] = useState(item.active)
  const [featured, setFeatured] = useState(item.featured)

  // Estado local de tags asignadas. El sheet trabaja optimista contra la UI;
  // recién al hacer "Guardar" mandamos el set completo a updateMenuItem,
  // que internamente llama a setItemTags con approach diff.
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(item.tags.map((t) => t.id))

  // Lista local de tags del tenant — la mutamos cuando creamos una nueva
  // desde acá adentro, para no cerrar el sheet y volver a abrirlo.
  const [tagsLocal, setTagsLocal] = useState<ItemTagRow[]>(allTags)

  // Sub-form de "crear tag" dentro de la tab.
  const [showNewTagForm, setShowNewTagForm] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(NEW_TAG_DEFAULT_COLOR)
  const [newTagError, setNewTagError] = useState<string | null>(null)

  const [pending, startTransition] = useTransition()
  const [creatingTag, startCreatingTag] = useTransition()
  const [deleting, startDelete] = useTransition()

  const priceParsed = Number.parseInt(priceCents, 10)
  const priceValid = !Number.isNaN(priceParsed) && priceParsed >= 0

  const toggleTagLocal = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const onSave = () => {
    if (name.trim().length === 0) {
      toast.error('El nombre es obligatorio.')
      return
    }
    if (!priceValid) {
      toast.error('Precio inválido.')
      return
    }
    const pts = pointsOverride === '' ? null : Number.parseInt(pointsOverride, 10)
    if (pts !== null && Number.isNaN(pts)) {
      toast.error('Puntos extra inválidos.')
      return
    }
    startTransition(async () => {
      const r = await updateMenuItem(tenantSlug, {
        id: item.id,
        category_id: categoryId,
        name: name.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        price_cents: priceParsed,
        points_override: pts,
        image_url: imageUrl,
        active,
        featured,
        tag_ids: selectedTagIds,
      })
      if (r.ok) {
        toast.success('Guardado.')
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onCreateInlineTag = () => {
    setNewTagError(null)
    const trimmed = newTagName.trim()
    if (trimmed.length === 0) {
      setNewTagError('Ponele un nombre.')
      return
    }
    const fd = new FormData()
    fd.set('name', trimmed)
    fd.set('color', newTagColor)
    startCreatingTag(async () => {
      const r = await createItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (!r.ok) {
        setNewTagError(r.message)
        return
      }
      if (!r.tagId) {
        setNewTagError('No se pudo crear la etiqueta.')
        return
      }
      // Agregamos a la lista local y la marcamos como asignada para que
      // el dueño no tenga que tocar el checkbox.
      const created: ItemTagRow = {
        id: r.tagId,
        name: trimmed,
        color: newTagColor,
        created_at: new Date().toISOString(),
        assignment_count: 0,
      }
      setTagsLocal((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedTagIds((prev) => [...prev, created.id])
      setNewTagName('')
      setNewTagColor(NEW_TAG_DEFAULT_COLOR)
      setShowNewTagForm(false)
      toast.success(`Etiqueta "${trimmed}" creada.`)
    })
  }

  const onDelete = () => {
    startDelete(async () => {
      const r = await deleteMenuItem(tenantSlug, item.id)
      if (r.ok) {
        toast.success('Ítem eliminado.')
        onClose()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 px-6 py-4">
          <SheetTitle className="font-serif text-2xl font-semibold tracking-tight">
            Editar ítem
          </SheetTitle>
          <SheetDescription>
            Cambios en nombre, precio, etiquetas y configuración avanzada.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="info" className="flex flex-1 min-h-0 flex-col">
          <TabsList className="mx-6 mt-4 grid w-auto grid-cols-3">
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="tags">Etiquetas</TabsTrigger>
            <TabsTrigger value="advanced">Avanzado</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <TabsContent value="info" className="m-0 grid gap-4 outline-none">
              <div className="grid gap-1.5">
                <Label htmlFor="item-name">Nombre</Label>
                <Input
                  id="item-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="item-desc">Descripción</Label>
                <Textarea
                  id="item-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={300}
                  rows={3}
                  placeholder="Notas que verá el cliente (ingredientes, picante, etc.)"
                />
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {description.length}/300
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="item-price">Precio (centavos)</Label>
                  <Input
                    id="item-price"
                    type="number"
                    min={0}
                    step={1}
                    value={priceCents}
                    onChange={(e) => setPriceCents(e.target.value)}
                    className="tabular-nums"
                  />
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {priceValid
                      ? `Equivale a ${fmtARS(priceParsed)}`
                      : 'Ingresá el precio en centavos.'}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="item-pts" className="flex items-center gap-1.5">
                    Puntos extra
                    <span className="text-[10px] font-normal text-muted-foreground">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    id="item-pts"
                    type="number"
                    step={1}
                    value={pointsOverride}
                    onChange={(e) => setPointsOverride(e.target.value)}
                    placeholder="—"
                    className="tabular-nums"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Sumá estos puntos cuando alguien pida este ítem.
                  </p>
                </div>
              </div>

              <MenuImageUploader
                tenantId={tenantId}
                value={imageUrl}
                onChange={setImageUrl}
                label="Foto del ítem"
              />
            </TabsContent>

            <TabsContent value="tags" className="m-0 grid gap-4 outline-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Etiquetas asignadas</p>
                  <p className="text-xs text-muted-foreground">
                    Marcá las que apliquen. Aparecen como pills en la carta.
                  </p>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {selectedTagIds.length} de {tagsLocal.length}
                </span>
              </div>

              {tagsLocal.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/30 p-6 text-center">
                  <Tag className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
                  <p className="text-sm text-muted-foreground">Todavía no creaste etiquetas.</p>
                </div>
              ) : (
                <ul className="card-hairline grid gap-1 rounded-lg border bg-card p-1.5">
                  {tagsLocal.map((t) => {
                    const checked = selectedTagIds.includes(t.id)
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => toggleTagLocal(t.id)}
                          aria-pressed={checked}
                          className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                            checked ? 'bg-primary/10 text-foreground' : 'hover:bg-secondary/40'
                          }`}
                        >
                          <span
                            aria-hidden
                            className="size-3 shrink-0 rounded-full border border-border/40"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="flex-1 truncate font-medium">{t.name}</span>
                          {checked ? <Check className="size-4 text-primary" aria-hidden /> : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {showNewTagForm ? (
                <div className="card-hairline rounded-lg border bg-card p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Nueva etiqueta
                  </p>
                  <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                      aria-label="Color"
                    />
                    <Input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      maxLength={40}
                      placeholder="Vegano, Sin TACC, Picante…"
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={onCreateInlineTag}
                        disabled={creatingTag}
                        className="gap-1"
                      >
                        <Plus className="size-3.5" />
                        Crear
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowNewTagForm(false)
                          setNewTagError(null)
                          setNewTagName('')
                        }}
                        disabled={creatingTag}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                  {newTagError ? (
                    <p className="mt-2 text-xs text-destructive">{newTagError}</p>
                  ) : null}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowNewTagForm(true)}
                  className="w-fit gap-1.5"
                >
                  <Plus className="size-3.5" />
                  Crear nueva etiqueta
                </Button>
              )}
            </TabsContent>

            <TabsContent value="advanced" className="m-0 grid gap-5 outline-none">
              <div className="grid gap-1.5">
                <Label htmlFor="item-cat">Categoría</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="item-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {!c.active ? ' (pausada)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Mové el ítem a otra categoría sin perder sus datos.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="item-active" className="text-sm font-medium">
                    Disponible
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Si está apagado, el ítem se oculta del cliente.
                  </p>
                </div>
                <Switch
                  id="item-active"
                  checked={active}
                  onCheckedChange={setActive}
                  aria-label="Disponible"
                />
              </div>

              <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card p-3">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="item-featured"
                    className="flex items-center gap-1.5 text-sm font-medium"
                  >
                    <Sparkles className="size-3.5 text-primary" aria-hidden />
                    Destacado
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Aparece en la sección "Destacados" arriba de la carta.
                  </p>
                </div>
                <Switch
                  id="item-featured"
                  checked={featured}
                  onCheckedChange={setFeatured}
                  aria-label="Destacado"
                />
              </div>

              <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">Zona de riesgo</p>
                <p className="text-xs text-muted-foreground">
                  Si el ítem aparece en visitas pasadas, no podrás eliminarlo. Pausalo en su lugar.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="gap-1.5" disabled={deleting}>
                      <Trash2 className="size-3.5" />
                      Eliminar ítem
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar "{item.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault()
                          onDelete()
                        }}
                        disabled={deleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleting ? 'Eliminando…' : 'Eliminar'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <SheetFooter className="flex flex-col gap-2 border-t border-border/60 px-6 py-4 sm:flex-row sm:justify-between">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link
              href={`/${tenantSlug}/difusiones/nueva?prefillName=${encodeURIComponent(
                `Novedad: ${name}`,
              )}`}
              target="_blank"
              rel="noopener"
            >
              <Megaphone className="size-3.5" />
              Anunciar este ítem
            </Link>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onSave} disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
