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
import { CSS } from '@dnd-kit/utilities'
import {
  Check,
  GripVertical,
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
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addTagsToItems, removeTagsFromItems } from '@/lib/item-tags/actions'
import type { ItemTag, ItemTagRow } from '@/lib/item-tags/queries'
import {
  deleteMenuItem,
  moveItemsToCategory,
  reorderItems,
  toggleFeatured,
  updateMenuItem,
} from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { CategoryTreePicker } from './category-tree-picker'
import { ItemEditDialog } from './item-edit-dialog'
import { NewItemForm } from './new-item-form'

function fmtARS(c: number): string {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
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
  const [, startTransition] = useTransition()
  const [bulkPending, startBulk] = useTransition()
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [editingTab, setEditingTab] = useState<'info' | 'tags' | 'advanced'>('info')
  const [toDelete, setToDelete] = useState<MenuItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const router = useRouter()

  // ── Modo selección múltiple ────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [tagOpen, setTagOpen] = useState(false)
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add')
  const [tagPicks, setTagPicks] = useState<Set<string>>(new Set())

  const selectedCount = selectedIds.size
  const selectedList = items.filter((i) => selectedIds.has(i.id))

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setMoveOpen(false)
    setTagOpen(false)
    setMoveTarget(null)
    setTagPicks(new Set())
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
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

  const onDeleteConfirmed = () => {
    if (!toDelete) return
    const target = toDelete
    const prev = items
    setItems(items.filter((i) => i.id !== target.id))
    setToDelete(null)
    startTransition(async () => {
      const r = await deleteMenuItem(tenantSlug, target.id)
      if (r.ok) {
        toast.success('Ítem eliminado.')
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
        // Update optimista de los pills en las cards seleccionadas.
        const pickedTags: ItemTag[] = allTags
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
      <div className="space-y-4">
        {/* Barra de selección del nivel */}
        {items.length > 0 ? (
          <div className="flex items-center justify-end gap-1.5">
            {selectionMode ? (
              <>
                <span className="mr-auto text-sm font-medium tabular-nums">
                  {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}
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
                <Button size="sm" variant="outline" className="gap-1.5" onClick={exitSelection}>
                  <X className="size-3.5" />
                  Salir
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSelectionMode(true)}
              >
                <ListChecks className="size-3.5" />
                Seleccionar
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
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-background/30 px-6 py-10 text-center">
                <UtensilsCrossed className="size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Sin ítems en esta categoría todavía.
                </p>
              </div>
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
                    onDelete={() => setToDelete(it)}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </DndContext>

        {hideAddButton ? null : (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="size-3.5" />
                Agregar ítem
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(560px,calc(100vw-2rem))] p-3"
              sideOffset={6}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Nuevo ítem en {category.name}
              </p>
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
        />
      ) : null}

      {/* Barra flotante de acciones masivas */}
      {selectionMode && selectedCount > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/95 px-3 py-2 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <span className="inline-flex h-7 items-center rounded-full bg-secondary px-2.5 text-xs font-medium tabular-nums text-secondary-foreground">
              {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}
            </span>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setMoveTarget(null)
                setMoveOpen(true)
              }}
            >
              <Move className="size-3.5" />
              Mover a…
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setTagMode('add')
                setTagPicks(new Set())
                setTagOpen(true)
              }}
            >
              <Tag className="size-3.5" />
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Mover {selectedCount} ítem{selectedCount === 1 ? '' : 's'} a…
            </DialogTitle>
            <DialogDescription>Elegí la categoría destino.</DialogDescription>
          </DialogHeader>
          <CategoryTreePicker
            categories={allCategories}
            value={moveTarget}
            onChange={setMoveTarget}
            excludeIds={[category.id]}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)} disabled={bulkPending}>
              Cancelar
            </Button>
            <Button onClick={onConfirmMove} disabled={bulkPending || !moveTarget}>
              {bulkPending ? 'Moviendo…' : 'Mover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: etiquetar seleccionados */}
      <Dialog open={tagOpen} onOpenChange={(o) => !bulkPending && setTagOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Etiquetar {selectedCount} ítem{selectedCount === 1 ? '' : 's'}
            </DialogTitle>
            <DialogDescription>
              {tagMode === 'add'
                ? 'Las etiquetas elegidas se agregan a los ítems seleccionados.'
                : 'Las etiquetas elegidas se quitan de los ítems seleccionados.'}
            </DialogDescription>
          </DialogHeader>

          <div className="inline-flex w-fit rounded-lg border border-border/70 bg-secondary/30 p-0.5">
            <button
              type="button"
              onClick={() => setTagMode('add')}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tagMode === 'add' ? 'bg-card shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={() => setTagMode('remove')}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tagMode === 'remove' ? 'bg-card shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Quitar
            </button>
          </div>

          {allTags.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/30 p-6 text-center">
              <Tag className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Todavía no creaste etiquetas. Creá una desde “Gestionar etiquetas”.
              </p>
            </div>
          ) : (
            <ul className="card-hairline grid max-h-64 gap-1 overflow-y-auto rounded-lg border bg-card p-1.5">
              {allTags.map((t) => {
                const checked = tagPicks.has(t.id)
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setTagPicks((prev) => {
                          const next = new Set(prev)
                          if (next.has(t.id)) next.delete(t.id)
                          else next.add(t.id)
                          return next
                        })
                      }
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setTagOpen(false)} disabled={bulkPending}>
              Cancelar
            </Button>
            <Button onClick={onApplyTags} disabled={bulkPending || tagPicks.size === 0}>
              {bulkPending
                ? 'Aplicando…'
                : tagMode === 'add'
                  ? `Agregar a ${selectedCount}`
                  : `Quitar de ${selectedCount}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{toDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Si el ítem aparece en visitas pasadas no se podrá eliminar. En ese caso podés pausarlo
              y queda oculto al cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onDeleteConfirmed()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Mostramos hasta 3 tags inline en la card. El resto va detrás de "+N".
  const visibleTags = item.tags.slice(0, 3)
  const hiddenCount = item.tags.length - visibleTags.length

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`card-hairline group relative flex flex-col gap-3 rounded-xl border bg-card p-3 transition-colors ${
        selected
          ? 'border-primary ring-2 ring-primary/60'
          : 'border-border/70 hover:border-foreground/20'
      }`}
    >
      {selectionMode ? (
        <span
          aria-hidden
          className={`absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-md border-2 shadow-sm transition-colors ${
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border/80 bg-card'
          }`}
        >
          {selected ? <Check className="size-3.5" /> : null}
        </span>
      ) : (
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label={`Mover ${item.name}`}
          className="absolute right-2 top-2 cursor-grab rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground active:cursor-grabbing group-hover:opacity-100 focus:opacity-100"
        >
          <GripVertical className="size-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={selectionMode ? onToggleSelect : onEdit}
        aria-label={selectionMode ? `Seleccionar ${item.name}` : `Editar ${item.name}`}
        aria-pressed={selectionMode ? selected : undefined}
        className="flex items-start gap-3 text-left"
      >
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
          {item.image_url ? (
            <Image src={item.image_url} alt="" fill sizes="64px" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <UtensilsCrossed className="size-5" aria-hidden />
            </div>
          )}
          {item.featured ? (
            <span
              role="img"
              aria-label="Destacado"
              className="absolute -top-1 -left-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
            >
              <Sparkles className="size-3" aria-hidden />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h4
            className={`truncate text-sm font-medium ${!item.active ? 'text-muted-foreground line-through' : ''}`}
          >
            {item.name}
          </h4>
          <p className="mt-0.5 font-serif text-base font-semibold tabular-nums tracking-tight">
            {fmtARS(item.price_cents)}
          </p>
          {item.description ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        {!item.active ? (
          <Badge variant="muted" className="text-[10px]">
            Pausado
          </Badge>
        ) : null}
        {item.points_override !== null ? (
          <Badge variant="success" className="text-[10px] tabular-nums">
            +{item.points_override} pts
          </Badge>
        ) : null}
        {visibleTags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: `${t.color}66`,
              backgroundColor: `${t.color}1f`,
              color: t.color,
            }}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            {t.name}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <Badge variant="outline" className="text-[10px] tabular-nums">
            +{hiddenCount}
          </Badge>
        ) : null}
        {selectionMode ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="ml-auto size-7 text-muted-foreground hover:text-foreground"
                aria-label={`Más opciones de ${item.name}`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="size-3.5" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEditTags}>
                <Tag className="size-3.5" />
                Etiquetas…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleFeatured}>
                <Sparkles className="size-3.5" />
                {item.featured ? 'Quitar destacado' : 'Destacar'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggleActive}>
                {item.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {item.active ? 'Pausar' : 'Activar'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 className="size-3.5" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </article>
  )
}
