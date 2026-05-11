'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { reorderCategories } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { CategoryRow } from './category-row'

export function MenuBoard({
  tenantSlug,
  tenantId,
  categories,
  items,
}: {
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  items: MenuItem[]
}) {
  const [order, setOrder] = useState(categories)
  const [, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex((c) => c.id === active.id)
    const newIndex = order.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startTransition(async () => {
      const result = await reorderCategories(
        tenantSlug,
        next.map((c) => c.id),
      )
      if (!result.ok) {
        toast.error(result.message)
        setOrder(order)
      }
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {order.map((cat) => (
            <SortableCategory
              key={cat.id}
              category={cat}
              items={items.filter((i) => i.category_id === cat.id)}
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              allCategories={order}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableCategory({
  category,
  items,
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
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: category.id,
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
      className="card-hairline overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex items-center gap-3 border-b border-border/60 bg-secondary/20 px-4 py-3">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Mover ${category.name}`}
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
          type="button"
        >
          <GripVertical className="size-4" />
        </button>
        <h3 className="font-display text-base font-semibold tracking-tight">{category.name}</h3>
        {!category.active ? <Badge variant="outline">Pausada</Badge> : null}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="p-4">
        <CategoryRow
          category={category}
          items={items}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          allCategories={allCategories}
        />
      </div>
    </div>
  )
}
