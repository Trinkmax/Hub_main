'use client'

import { Megaphone, Plus, Sparkles, Tag, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { MenuImageUploader } from '@/components/media/image-uploader'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Field, FieldRow } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MoneyField } from '@/components/ui/money-field'
import { NumberField } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { createItemTag } from '@/lib/item-tags/actions'
import type { ItemTag, ItemTagRow } from '@/lib/item-tags/queries'
import { deleteMenuItem, updateMenuItem } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { deleteMenuImageByUrl } from '@/lib/menu/upload-image'
import { deleteMenuVideoByUrl } from '@/lib/menu/upload-video'
import { cn } from '@/lib/utils'
import { CategoryTreePicker } from './category-tree-picker'
import { TagDot } from './menu-ui'
import { WHOLE_PESOS_MESSAGE } from './new-item-form'
import { MenuVideoUploader } from './video-uploader'

const NEW_TAG_DEFAULT_COLOR = '#94a3b8'

type EditTab = 'info' | 'tags' | 'advanced'

export function ItemEditDialog({
  item,
  tenantSlug,
  tenantId,
  categories,
  allTags,
  onClose,
  onSaved,
  onDeleted,
  defaultTab = 'info',
}: {
  item: MenuItem
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  allTags: ItemTagRow[]
  onClose: () => void
  /** Se llama con el ítem actualizado tras guardar, para update optimista del contenedor. */
  onSaved?: (item: MenuItem) => void
  /** Se llama con el id tras eliminar, para sacar la card sin re-navegar. */
  onDeleted?: (id: string) => void
  /** Pestaña inicial. 'tags' cuando se abre desde "Etiquetas…" del card. */
  defaultTab?: EditTab
}) {
  const [tab, setTab] = useState<EditTab>(defaultTab)
  const [name, setName] = useState(item.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [description, setDescription] = useState(item.description ?? '')
  const [categoryId, setCategoryId] = useState(item.category_id)
  // El precio se edita en pesos enteros (la carta no muestra centavos) y viaja
  // en centavos, como guarda la base (CLAUDE.md §2). Arranca redondeado a pesos,
  // como antes.
  const [priceCents, setPriceCents] = useState<number | null>(
    Math.round(item.price_cents / 100) * 100,
  )
  const [priceError, setPriceError] = useState<string | null>(null)
  const [pointsOverride, setPointsOverride] = useState<number | null>(item.points_override)
  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url ?? null)
  const [videoUrl, setVideoUrl] = useState<string | null>(item.video_url ?? null)
  const [active, setActive] = useState(item.active)
  const router = useRouter()
  const [featured, setFeatured] = useState(item.featured)

  // Estado local de tags asignadas. El diálogo trabaja optimista contra la UI;
  // recién al hacer "Guardar" mandamos el set completo a updateMenuItem,
  // que internamente llama a setItemTags con approach diff.
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(item.tags.map((t) => t.id))

  // Lista local de tags del tenant — la mutamos cuando creamos una nueva
  // desde acá adentro, para no cerrar el diálogo y volver a abrirlo.
  const [tagsLocal, setTagsLocal] = useState<ItemTagRow[]>(allTags)

  // Sub-form de "crear tag" dentro de la pestaña.
  const [showNewTagForm, setShowNewTagForm] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(NEW_TAG_DEFAULT_COLOR)
  const [newTagError, setNewTagError] = useState<string | null>(null)

  const [pending, startTransition] = useTransition()
  const [creatingTag, startCreatingTag] = useTransition()

  const toggleTagLocal = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const onSave = () => {
    if (name.trim().length === 0) {
      setNameError('El nombre es obligatorio.')
      setTab('info')
      return
    }
    if (priceCents === null) {
      setPriceError('Escribí el precio en pesos.')
      setTab('info')
      return
    }
    if (priceCents % 100 !== 0) {
      setPriceError(WHOLE_PESOS_MESSAGE)
      setTab('info')
      return
    }
    const pts = pointsOverride
    startTransition(async () => {
      const r = await updateMenuItem(tenantSlug, {
        id: item.id,
        category_id: categoryId,
        name: name.trim(),
        description: description.trim().length > 0 ? description.trim() : null,
        price_cents: priceCents,
        points_override: pts,
        image_url: imageUrl,
        video_url: videoUrl,
        active,
        featured,
        tag_ids: selectedTagIds,
      })
      if (r.ok) {
        // Si se reemplazó o quitó la foto/el video, borrar los archivos
        // previos del bucket para no dejar huérfanos (mismo patrón que
        // category-edit-dialog; best-effort, no bloquea el guardado).
        if (item.image_url && item.image_url !== imageUrl) {
          try {
            await deleteMenuImageByUrl(item.image_url)
          } catch {
            // best-effort
          }
        }
        if (item.video_url && item.video_url !== videoUrl) {
          try {
            await deleteMenuVideoByUrl(item.video_url)
          } catch {
            // best-effort
          }
        }
        const updatedItem: MenuItem = {
          id: item.id,
          category_id: categoryId,
          name: name.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          price_cents: priceCents,
          points_override: pts,
          position: item.position,
          active,
          image_url: imageUrl,
          video_url: videoUrl,
          featured,
          tags: tagsLocal
            .filter((t) => selectedTagIds.includes(t.id))
            .map<ItemTag>((t) => ({
              id: t.id,
              tenant_id: tenantId,
              name: t.name,
              color: t.color,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
        onSaved?.(updatedItem)
        toast.success('Guardado.')
        router.refresh()
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
      toast.success(`Etiqueta «${trimmed}» creada.`)
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Editar ítem</DialogTitle>
          <DialogDescription>
            Nombre, precio, fotos, etiquetas y la configuración avanzada.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as EditTab)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList aria-label="Partes del ítem">
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="tags" count={selectedTagIds.length}>
              Etiquetas
            </TabsTrigger>
            <TabsTrigger value="advanced">Avanzado</TabsTrigger>
          </TabsList>

          <DialogBody>
            <TabsContent value="info" className="grid gap-4">
              <Field label="Nombre" required error={nameError}>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) setNameError(null)
                  }}
                  maxLength={80}
                />
              </Field>

              <Field label="Descripción" optional>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={300}
                  showCount
                  rows={3}
                  placeholder="Lo que lee el cliente: ingredientes, si pica, de dónde viene…"
                />
              </Field>

              <FieldRow>
                <Field label="Precio" required error={priceError} hint="En pesos, sin centavos.">
                  <MoneyField
                    decimals="auto"
                    cents={priceCents}
                    onCentsChange={(cents) => {
                      setPriceCents(cents)
                      if (priceError) setPriceError(null)
                    }}
                    placeholder="15.500"
                  />
                </Field>
                <Field label="Puntos extra" optional hint="Se suman cuando alguien pide este ítem.">
                  <NumberField
                    min={0}
                    steppers={false}
                    placeholder="—"
                    value={pointsOverride}
                    onValueChange={setPointsOverride}
                  />
                </Field>
              </FieldRow>

              <MenuImageUploader
                tenantId={tenantId}
                value={imageUrl}
                onChange={setImageUrl}
                label="Foto del ítem"
              />

              <MenuVideoUploader tenantId={tenantId} value={videoUrl} onChange={setVideoUrl} />
            </TabsContent>

            <TabsContent value="tags" className="grid gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="grid gap-0.5">
                  <p className="type-label text-foreground">Etiquetas del ítem</p>
                  <p className="type-small text-muted-foreground">
                    Marcá las que apliquen: se ven como chips en la carta.
                  </p>
                </div>
                <span className="type-caption type-amount text-muted-foreground">
                  {selectedTagIds.length} de {tagsLocal.length}
                </span>
              </div>

              {tagsLocal.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center type-small text-muted-foreground">
                  <Tag className="mx-auto mb-2 size-5" aria-hidden="true" />
                  Todavía no creaste etiquetas.
                </p>
              ) : (
                <ul
                  aria-label="Etiquetas"
                  className="grid gap-0.5 rounded-lg border border-border bg-card p-1"
                >
                  {tagsLocal.map((t) => {
                    const checked = selectedTagIds.includes(t.id)
                    const checkboxId = `item-${item.id}-tag-${t.id}`
                    return (
                      <li key={t.id}>
                        <label
                          htmlFor={checkboxId}
                          className={cn(
                            'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5',
                            checked ? 'bg-selected' : 'hover:bg-hover',
                          )}
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={() => toggleTagLocal(t.id)}
                          />
                          <TagDot color={t.color} className="size-3" />
                          <span className="flex-1 truncate type-body font-medium">{t.name}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              {showNewTagForm ? (
                <div className="grid gap-2 rounded-lg border border-border p-3">
                  <p className="type-label text-foreground">Nueva etiqueta</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      aria-label="Color de la etiqueta"
                      className="size-(--control-md) shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5 outline-offset-2 outline-(--ring) focus-visible:outline-2"
                    />
                    <Input
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      maxLength={40}
                      placeholder="Vegano, Sin TACC, Picante…"
                      aria-label="Nombre de la etiqueta"
                      invalid={newTagError !== null}
                      className="min-w-40 flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={onCreateInlineTag}
                      loading={creatingTag}
                    >
                      <Plus aria-hidden="true" />
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
                  {newTagError ? (
                    <p role="alert" className="type-caption text-destructive-text">
                      {newTagError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowNewTagForm(true)}
                  className="w-fit"
                >
                  <Plus aria-hidden="true" />
                  Crear una etiqueta nueva
                </Button>
              )}
            </TabsContent>

            <TabsContent value="advanced" className="grid gap-5">
              <Field label="Categoría" hint="Mové el ítem a otra categoría sin perder sus datos.">
                <CategoryTreePicker
                  categories={categories}
                  value={categoryId}
                  onChange={(id) => id && setCategoryId(id)}
                  aria-label="Categoría del ítem"
                />
              </Field>

              <Field
                label="Disponible"
                layout="toggle"
                hint="Si está apagado, el ítem se oculta del cliente."
              >
                <Switch checked={active} onCheckedChange={setActive} />
              </Field>

              <Field
                label={
                  <>
                    <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                    Destacado
                  </>
                }
                layout="toggle"
                hint="Aparece en la sección «Destacados», arriba de la carta."
              >
                <Switch checked={featured} onCheckedChange={setFeatured} />
              </Field>

              <Callout
                tone="danger"
                title="Borrar el ítem"
                action={
                  <ConfirmDialog
                    tone="danger"
                    title={`¿Borrar «${item.name}»?`}
                    description="Sale de la carta para siempre. No se puede deshacer."
                    confirmLabel="Borrar ítem"
                    pendingLabel="Borrando…"
                    trigger={
                      <Button variant="danger-ghost" size="sm">
                        <Trash2 aria-hidden="true" />
                        Borrar ítem
                      </Button>
                    }
                    onConfirm={async () => {
                      const r = await deleteMenuItem(tenantSlug, item.id)
                      if (!r.ok) return r
                      onDeleted?.(item.id)
                      toast.success('Ítem borrado.')
                      router.refresh()
                      onClose()
                    }}
                  />
                }
              >
                Si el ítem aparece en visitas pasadas no se va a poder borrar: pausalo en su lugar.
              </Callout>
            </TabsContent>
          </DialogBody>
        </Tabs>

        <DialogFooter className="sm:justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link
              href={`/${tenantSlug}/mensajeria/difusiones/nueva?prefillName=${encodeURIComponent(
                `Novedad: ${name}`,
              )}`}
              target="_blank"
              rel="noopener"
            >
              <Megaphone aria-hidden="true" />
              Anunciar este ítem
            </Link>
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onSave} loading={pending} loadingText="Guardando…">
              Guardar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
