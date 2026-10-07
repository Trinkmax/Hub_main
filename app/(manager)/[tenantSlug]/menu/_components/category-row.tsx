'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import {
  Check,
  ListChecks,
  MoreHorizontal,
  Move,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatNumber } from '@/lib/format/number-kind'
import { addTagsToItems, createItemTag, removeTagsFromItems } from '@/lib/item-tags/actions'
import type { ItemTag, ItemTagRow } from '@/lib/item-tags/queries'
import {
  deleteMenuItem,
  moveItemsToCategory,
  reorderItems,
  toggleFeatured,
  updateMenuItem,
} from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { formatCents } from '@/lib/money/format'
import { cn } from '@/lib/utils'
import { CategoryTreePicker } from './category-tree-picker'
import { ItemEditDialog } from './item-edit-dialog'
import { ITEM_STATUS } from './menu-status'
import { DRAGGING_CLASSES, DragHandle, sortableStyle, TagBadge, TagDot } from './menu-ui'
import { NewItemForm } from './new-item-form'

const NEW_TAG_DEFAULT_COLOR = '#94a3b8'

type TagMode = 'add' | 'remove'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function CategoryRow({
  category,
  items: initialItems,
  tenantSlug,
  tenantId,
  allCategories,
  allTags,
  hideAddButton = false,
}: {
  category: MenuCategory
  items: MenuItem[]
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
  allTags: ItemTagRow[]
  hideAddButton?: boolean
}) {
  const [items, setItems] = useState(initialItems)
  // La lista más nueva, para revertir un borrado optimista que pidió confirmación.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  const confirm = useConfirm()
  const [, startTransition] = useTransition()
  const [bulkPending, startBulk] = useTransition()
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [editingTab, setEditingTab] = useState<'info' | 'tags' | 'advanced'>('info')
  const [addOpen, setAddOpen] = useState(false)
  const router = useRouter()

  // ── Modo selección múltiple ────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [tagOpen, setTagOpen] = useState(false)
  const [tagMode, setTagMode] = useState<TagMode>('add')
  const [tagPicks, setTagPicks] = useState<Set<string>>(new Set())
  // Lista local de etiquetas del tenant: arranca de allTags y crece si el dueño
  // crea una etiqueta inline desde este mismo diálogo (mismo patrón que el editor
  // de ítem). Así el flujo de un bar recién onboardeado no queda trabado.
  const [localTags, setLocalTags] = useState<ItemTagRow[]>(allTags)
  const [showNewTag, setShowNewTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(NEW_TAG_DEFAULT_COLOR)
  const [creatingTag, startCreatingTag] = useTransition()

  const selectedCount = selectedIds.size
  const selectedList = items.filter((i) => selectedIds.has(i.id))
  // Etiquetas realmente presentes en la selección (para el modo "Quitar": no
  // tiene sentido ofrecer quitar una etiqueta que ningún seleccionado tiene).
  const assignedInSelection = new Set(selectedList.flatMap((i) => i.tags.map((t) => t.id)))
  const visibleTags =
    tagMode === 'add' ? localTags : localTags.filter((t) => assignedInSelection.has(t.id))

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setMoveOpen(false)
    setTagOpen(false)
    setMoveTarget(null)
    setTagPicks(new Set())
    setShowNewTag(false)
    setNewTagName('')
    setNewTagColor(NEW_TAG_DEFAULT_COLOR)
  }

  const onCreateInlineTag = () => {
    const trimmed = newTagName.trim()
    if (trimmed.length === 0) {
      toast.error('Ponele un nombre a la etiqueta.')
      return
    }
    const fd = new FormData()
    fd.set('name', trimmed)
    fd.set('color', newTagColor)
    startCreatingTag(async () => {
      const r = await createItemTag(tenantSlug, { ok: false, message: '' }, fd)
      if (!r.ok || !r.tagId) {
        toast.error(r.ok ? 'No se pudo crear la etiqueta.' : r.message)
        return
      }
      const created: ItemTagRow = {
        id: r.tagId,
        name: trimmed,
        color: newTagColor,
        created_at: new Date().toISOString(),
        assignment_count: 0,
      }
      setLocalTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      // La dejamos tildada para que aplicar sea un solo paso.
      setTagPicks((prev) => new Set(prev).add(created.id))
      setNewTagName('')
      setNewTagColor(NEW_TAG_DEFAULT_COLOR)
      setShowNewTag(false)
      toast.success(`Etiqueta «${trimmed}» creada.`)
    })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePick = (id: string) => {
    setTagPicks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = items
    const next = arrayMove(items, oldIndex, newIndex)
    setItems(next)
    startTransition(async () => {
      const r = await reorderItems(
        tenantSlug,
        category.id,
        next.map((i) => i.id),
      )
      if (!r.ok) {
        toast.error(r.message)
        setItems(prev)
      }
    })
  }

  const onToggleActive = (item: MenuItem) => {
    const next = !item.active
    setItems(items.map((i) => (i.id === item.id ? { ...i, active: next } : i)))
    startTransition(async () => {
      const r = await updateMenuItem(tenantSlug, {
        id: item.id,
        category_id: item.category_id,
        name: item.name,
        description: item.description,
        price_cents: item.price_cents,
        points_override: item.points_override,
        image_url: item.image_url,
        active: next,
      })
      if (r.ok) {
        toast.success(next ? 'Ítem activado.' : 'Ítem pausado.')
      } else {
        toast.error(r.message)
        // Revertimos en caso de error.
        setItems(items.map((i) => (i.id === item.id ? { ...i, active: !next } : i)))
      }
    })
  }

  const onToggleFeatured = (item: MenuItem) => {
    const next = !item.featured
    setItems(items.map((i) => (i.id === item.id ? { ...i, featured: next } : i)))
    startTransition(async () => {
      const r = await toggleFeatured(tenantSlug, item.id)
      if (r.ok) {
        if (r.message) toast.success(r.message)
      } else {
        toast.error(r.message)
        setItems(items.map((i) => (i.id === item.id ? { ...i, featured: !next } : i)))
      }
    })
  }

  // Borrar: confirmación (desde el menú «⋯», con useConfirm) y después la
  // tarjeta sale al toque; si el server rechaza, vuelve.
  const onDelete = async (item: MenuItem) => {
    const ok = await confirm({
      title: `¿Borrar «${item.name}»?`,
      description:
        'Si el ítem aparece en visitas pasadas no se va a poder borrar: en ese caso pausalo y queda oculto para el cliente.',
      confirmLabel: 'Borrar ítem',
      tone: 'danger',
    })
    if (!ok) return
    const prev = itemsRef.current
    setItems((current) => current.filter((i) => i.id !== item.id))
    startTransition(async () => {
      const r = await deleteMenuItem(tenantSlug, item.id)
      if (r.ok) {
        toast.success('Ítem borrado.')
      } else {
        toast.error(r.message)
        setItems(prev)
      }
    })
  }

  // ── Acciones masivas ───────────────────────────────────────────────────
  const onConfirmMove = () => {
    if (!moveTarget || selectedCount === 0) return
    const ids = selectedList.map((i) => i.id)
    startBulk(async () => {
      const r = await moveItemsToCategory(tenantSlug, ids, moveTarget)
      if (r.ok) {
        // Los ítems movidos salen de esta categoría.
        setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)))
        toast.success(r.message ?? 'Ítems movidos.')
        exitSelection()
        router.refresh()
      } else {
        toast.error(r.message)
      }
    })
  }

  const onApplyTags = () => {
    if (tagPicks.size === 0 || selectedCount === 0) return
    const itemIds = selectedList.map((i) => i.id)
    const tagIds = Array.from(tagPicks)
    const mode = tagMode
    startBulk(async () => {
      const r =
        mode === 'add'
          ? await addTagsToItems(tenantSlug, { item_ids: itemIds, tag_ids: tagIds })
          : await removeTagsFromItems(tenantSlug, { item_ids: itemIds, tag_ids: tagIds })
      if (r.ok) {
        // Update optimista de los tags en las tarjetas seleccionadas.
        const pickedTags: ItemTag[] = localTags
          .filter((t) => tagPicks.has(t.id))
          .map((t) => ({ id: t.id, tenant_id: tenantId, name: t.name, color: t.color }))
        setItems((prev) =>
          prev.map((it) => {
            if (!selectedIds.has(it.id)) return it
            if (mode === 'add') {
              const byId = new Map(it.tags.map((t) => [t.id, t]))
              for (const t of pickedTags) byId.set(t.id, t)
              const merged = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
              return { ...it, tags: merged }
            }
            return { ...it, tags: it.tags.filter((t) => !tagPicks.has(t.id)) }
          }),
        )
        toast.success(r.message ?? 'Listo.')
        exitSelection()
        router.refresh()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Barra de selección del nivel */}
        {items.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectionMode ? (
              <>
                <span className="mr-auto type-label type-amount" aria-live="polite">
                  {selectedCount} {selectedCount === 1 ? 'seleccionado' : 'seleccionados'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set(items.map((i) => i.id)))}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={selectedCount === 0}
                >
                  Ninguno
                </Button>
                <Button size="sm" variant="secondary" onClick={exitSelection}>
                  <X aria-hidden="true" />
                  Salir
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setSelectionMode(true)}>
                <ListChecks aria-hidden="true" />
                Seleccionar varios
              </Button>
            )}
          </div>
        ) : null}

        <DndContext
          id={`menu-items-${category.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
            {items.length === 0 ? (
              <EmptyState
                size="sm"
                variant="dashed"
                icon={UtensilsCrossed}
                title="Sin ítems en esta categoría todavía"
                description="Tocá «Agregar ítem» para cargar el primero: nombre, precio y una foto que dé ganas."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <SortableItemCard
                    key={it.id}
                    item={it}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(it.id)}
                    onToggleSelect={() => toggleSelect(it.id)}
                    onEdit={() => {
                      setEditingTab('info')
                      setEditingItem(it)
                    }}
                    onEditTags={() => {
                      setEditingTab('tags')
                      setEditingItem(it)
                    }}
                    onToggleActive={() => onToggleActive(it)}
                    onToggleFeatured={() => onToggleFeatured(it)}
                    onDelete={() => onDelete(it)}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </DndContext>

        {hideAddButton ? null : (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" className="w-fit">
                <Plus aria-hidden="true" />
                Agregar ítem
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="flex w-[min(560px,calc(100vw-2rem))] flex-col gap-3"
            >
              <PopoverHeader>
                <PopoverTitle>Nuevo ítem en {category.name}</PopoverTitle>
              </PopoverHeader>
              <NewItemForm
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                categoryId={category.id}
                onCreated={() => setAddOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {editingItem ? (
        <ItemEditDialog
          item={editingItem}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          categories={allCategories}
          allTags={allTags}
          defaultTab={editingTab}
          onClose={() => setEditingItem(null)}
          onSaved={(updated) =>
            setItems((prev) =>
              updated.category_id !== category.id
                ? prev.filter((i) => i.id !== updated.id)
                : prev.map((i) => (i.id === updated.id ? updated : i)),
            )
          }
          onDeleted={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
        />
      ) : null}

      {/* Barra flotante de acciones masivas */}
      {selectionMode && selectedCount > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-popover px-3 py-2 shadow-float">
            <Badge className="type-amount">
              {selectedCount} {selectedCount === 1 ? 'seleccionado' : 'seleccionados'}
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                setMoveTarget(null)
                setMoveOpen(true)
              }}
            >
              <Move aria-hidden="true" />
              Mover a…
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setTagMode('add')
                setTagPicks(new Set())
                setShowNewTag(false)
                setNewTagName('')
                setTagOpen(true)
              }}
            >
              <Tag aria-hidden="true" />
              Etiquetar
            </Button>
            <Button size="sm" variant="ghost" onClick={exitSelection}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {/* Diálogo: mover seleccionados a otra categoría */}
      <Dialog open={moveOpen} onOpenChange={(o) => !bulkPending && setMoveOpen(o)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Mover {plural(selectedCount, 'ítem', 'ítems')} a…</DialogTitle>
            <DialogDescription>Elegí la categoría destino.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CategoryTreePicker
              categories={allCategories}
              value={moveTarget}
              onChange={setMoveTarget}
              excludeIds={[category.id]}
              aria-label="Categoría destino"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMoveOpen(false)} disabled={bulkPending}>
              Cancelar
            </Button>
            <Button
              onClick={onConfirmMove}
              disabled={!moveTarget}
              loading={bulkPending}
              loadingText="Moviendo…"
            >
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: etiquetar seleccionados */}
      <Dialog open={tagOpen} onOpenChange={(o) => !bulkPending && setTagOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Etiquetar {plural(selectedCount, 'ítem', 'ítems')}</DialogTitle>
            <DialogDescription>
              {tagMode === 'add'
                ? 'Las etiquetas elegidas se agregan a los ítems seleccionados.'
                : 'Las etiquetas elegidas se quitan de los ítems seleccionados.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            <SegmentedControl<TagMode>
              aria-label="Qué hacer con las etiquetas"
              items={[
                { value: 'add', label: 'Agregar' },
                { value: 'remove', label: 'Quitar' },
              ]}
              value={tagMode}
              onValueChange={(mode) => {
                setTagMode(mode)
                setTagPicks(new Set())
                if (mode === 'remove') setShowNewTag(false)
              }}
              className="w-fit"
            />

            {visibleTags.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong px-4 py-6 text-center type-small text-muted-foreground">
                {tagMode === 'remove'
                  ? 'Los ítems seleccionados no tienen etiquetas para quitar.'
                  : 'Todavía no tenés etiquetas. Creá la primera acá abajo.'}
              </p>
            ) : (
              <ul
                aria-label="Etiquetas"
                className="grid max-h-56 gap-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1"
              >
                {visibleTags.map((t) => {
                  const checked = tagPicks.has(t.id)
                  const checkboxId = `bulk-tag-${category.id}-${t.id}`
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
                          onCheckedChange={() => togglePick(t.id)}
                        />
                        <TagDot color={t.color} className="size-3" />
                        <span className="flex-1 truncate type-body font-medium">{t.name}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Crear etiqueta sin salir del flujo (solo tiene sentido al Agregar) */}
            {tagMode === 'add' ? (
              showNewTag || localTags.length === 0 ? (
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
                      className="min-w-40 flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          onCreateInlineTag()
                        }
                      }}
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
                    {localTags.length > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowNewTag(false)
                          setNewTagName('')
                        }}
                        disabled={creatingTag}
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowNewTag(true)}
                  className="w-fit"
                >
                  <Plus aria-hidden="true" />
                  Crear una etiqueta nueva
                </Button>
              )
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setTagOpen(false)} disabled={bulkPending}>
              Cancelar
            </Button>
            <Button
              onClick={onApplyTags}
              disabled={tagPicks.size === 0}
              loading={bulkPending}
              loadingText="Aplicando…"
            >
              {tagMode === 'add' ? `Agregar a ${selectedCount}` : `Quitar de ${selectedCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SortableItemCard({
  item,
  selectionMode,
  selected,
  onToggleSelect,
  onEdit,
  onEditTags,
  onToggleActive,
  onToggleFeatured,
  onDelete,
}: {
  item: MenuItem
  selectionMode: boolean
  selected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onEditTags: () => void
  onToggleActive: () => void
  onToggleFeatured: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: selectionMode,
  })
  const style = sortableStyle(transform, transition, isDragging)

  // Mostramos hasta 3 tags en la tarjeta. El resto va detrás de "+N".
  const visibleTags = item.tags.slice(0, 3)
  const hiddenCount = item.tags.length - visibleTags.length

  const cardClass = cn(
    'relative flex flex-col gap-3 rounded-xl border bg-card p-3',
    selected
      ? 'border-primary ring-1 ring-primary'
      : 'border-border transition-colors duration-(--duration-quick) hover:border-border-strong',
    isDragging && DRAGGING_CLASSES,
  )

  // Bloques compartidos entre modo normal y modo selección.
  const media = (
    <span className="relative shrink-0">
      <span className="relative block size-16 overflow-hidden rounded-lg bg-secondary">
        {item.image_url ? (
          <Image src={item.image_url} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-subtle-foreground">
            <UtensilsCrossed className="size-5" aria-hidden="true" />
          </span>
        )}
      </span>
      {item.featured ? (
        <span
          role="img"
          aria-label="Destacado"
          className="absolute -top-1.5 -left-1.5 inline-flex size-5 items-center justify-center rounded-full border-2 border-card bg-gold text-gold-foreground"
        >
          <Sparkles className="size-3" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  )

  const details = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span
        className={cn(
          'truncate type-body font-medium',
          !item.active && 'text-muted-foreground line-through',
        )}
      >
        {item.name}
      </span>
      <span className="mt-0.5 type-body type-amount font-semibold">
        {formatCents(item.price_cents, { decimals: 0 })}
      </span>
      {item.description ? (
        <span className="mt-1 line-clamp-2 type-caption text-muted-foreground">
          {item.description}
        </span>
      ) : null}
    </span>
  )

  const meta = (
    <>
      {!item.active ? <StatusBadge status="paused" map={ITEM_STATUS} /> : null}
      {item.points_override !== null ? (
        <Badge tone="gold" className="type-amount">
          +{formatNumber(item.points_override)} pts
        </Badge>
      ) : null}
      {visibleTags.map((t) => (
        <TagBadge key={t.id} name={t.name} color={t.color} />
      ))}
      {hiddenCount > 0 ? (
        <Badge appearance="outline" className="type-amount">
          +{hiddenCount}
        </Badge>
      ) : null}
    </>
  )

  // ── Modo selección: TODA la tarjeta es un botón que alterna (funciona igual
  // con mouse o dedo). Sin arrastre ni menú «⋯».
  if (selectionMode) {
    return (
      <button
        ref={setNodeRef}
        style={style}
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? 'Deseleccionar' : 'Seleccionar'} ${item.name}`}
        onClick={onToggleSelect}
        className={cn(
          cardClass,
          'w-full cursor-pointer text-left outline-offset-2 outline-(--ring) focus-visible:outline-2',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-2 left-2 z-10 flex size-5 items-center justify-center rounded-[4px] border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
          )}
        >
          {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>
        <span className="flex items-start gap-3">
          {media}
          {details}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">{meta}</span>
      </button>
    )
  }

  // ── Modo normal: tocar para editar, asa para reordenar y menú «⋯».
  return (
    <article ref={setNodeRef} style={style} aria-label={item.name} className={cardClass}>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar ${item.name}`}
        className="flex items-start gap-3 rounded-lg text-left outline-offset-2 outline-(--ring) focus-visible:outline-2"
      >
        {media}
        {details}
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        {meta}
        <div className="ms-auto flex items-center gap-0.5">
          <DragHandle label={`Mover ${item.name}`} attributes={attributes} listeners={listeners} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Más opciones de ${item.name}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden="true" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEditTags}>
                <Tag aria-hidden="true" />
                Etiquetas…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleFeatured}>
                <Sparkles aria-hidden="true" />
                {item.featured ? 'Quitar destacado' : 'Destacar'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleActive}>
                {item.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {item.active ? 'Pausar' : 'Activar'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 aria-hidden="true" />
                Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  )
}
