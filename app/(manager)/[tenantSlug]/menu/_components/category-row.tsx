'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  deleteCategory,
  deleteMenuItem,
  reorderItems,
  updateCategory,
  updateMenuItem,
} from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { CategoryEditDialog } from './category-edit-dialog'
import { ItemEditDialog } from './item-edit-dialog'
import { NewItemForm } from './new-item-form'

function fmt(c: number) {
  return `$${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

export function CategoryRow({
  category,
  items: initialItems,
  tenantSlug,
  tenantId,
  allCategories,
}: {
  category: MenuCategory
  items: MenuItem[]
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
}) {
  const [items, setItems] = useState(initialItems)
  const [, startTransition] = useTransition()
  const [editingCat, setEditingCat] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
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
        setItems(items)
      }
    })
  }

  const onToggleItem = (id: string, active: boolean) => {
    const item = items.find((i) => i.id === id)
    if (!item) return
    setItems(items.map((i) => (i.id === id ? { ...i, active } : i)))
    startTransition(async () => {
      const r = await updateMenuItem(tenantSlug, { ...item, active })
      if (!r.ok) toast.error(r.message)
    })
  }

  const onDeleteItem = (id: string) => {
    if (!confirm('¿Borrar este ítem?')) return
    const previous = items
    setItems(items.filter((i) => i.id !== id))
    startTransition(async () => {
      const r = await deleteMenuItem(tenantSlug, id)
      if (!r.ok) {
        toast.error(r.message)
        setItems(previous)
      }
    })
  }

  const onDeleteCat = () => {
    if (!confirm(`¿Borrar la categoría "${category.name}"? Sus ítems deben moverse antes.`)) return
    startTransition(async () => {
      const r = await deleteCategory(tenantSlug, category.id)
      if (!r.ok) toast.error(r.message)
    })
  }

  const onToggleCat = () => {
    startTransition(async () => {
      const r = await updateCategory(tenantSlug, {
        id: category.id,
        name: category.name,
        active: !category.active,
      })
      if (!r.ok) toast.error(r.message)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditingCat(true)} className="gap-1.5">
          <Pencil className="size-3.5" />
          Editar
        </Button>
        <Button size="sm" variant="outline" onClick={onToggleCat} className="gap-1.5">
          {category.active ? (
            <>
              <Pause className="size-3.5" />
              Pausar
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              Activar
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDeleteCat}
          className="gap-1.5 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Borrar
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="overflow-hidden rounded-lg border border-border/60 bg-background/30">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                Sin ítems en esta categoría todavía.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {items.map((it) => (
                  <SortableItem
                    key={it.id}
                    item={it}
                    onEdit={() => setEditingItem(it)}
                    onToggle={() => onToggleItem(it.id, !it.active)}
                    onDelete={() => onDeleteItem(it.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <NewItemForm tenantSlug={tenantSlug} tenantId={tenantId} categoryId={category.id} />

      {editingCat ? (
        <CategoryEditDialog
          category={category}
          tenantSlug={tenantSlug}
          onClose={() => setEditingCat(false)}
        />
      ) : null}
      {editingItem ? (
        <ItemEditDialog
          item={editingItem}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          categories={allCategories}
          onClose={() => setEditingItem(null)}
        />
      ) : null}
    </div>
  )
}

function SortableItem({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: MenuItem
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/30"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Mover ${item.name}`}
        className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
        type="button"
      >
        <GripVertical className="size-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm font-medium ${!item.active ? 'opacity-60' : ''}`}>
            {item.name}
          </span>
          {!item.active ? (
            <Badge variant="outline" className="text-[10px]">
              Pausado
            </Badge>
          ) : null}
        </div>
        {item.description ? (
          <p className="truncate text-[11px] text-muted-foreground">{item.description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-semibold tabular-nums">
          {fmt(item.price_cents)}
        </span>
        {item.points_override !== null ? (
          <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
            +{item.points_override} pts
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label="Editar"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          aria-label={item.active ? 'Pausar' : 'Activar'}
        >
          {item.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Borrar"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
