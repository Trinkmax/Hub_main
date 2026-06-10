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
  GripVertical,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import Image from 'next/image'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import { deleteMenuItem, reorderItems, toggleFeatured, updateMenuItem } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
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
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [toDelete, setToDelete] = useState<MenuItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)

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

  return (
    <>
      <div className="space-y-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
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
                    onEdit={() => setEditingItem(it)}
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
          onClose={() => setEditingItem(null)}
        />
      ) : null}

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
  onEdit,
  onToggleActive,
  onToggleFeatured,
  onDelete,
}: {
  item: MenuItem
  onEdit: () => void
  onToggleActive: () => void
  onToggleFeatured: () => void
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

  // Mostramos hasta 3 tags inline en la card. El resto va detrás de "+N".
  const visibleTags = item.tags.slice(0, 3)
  const hiddenCount = item.tags.length - visibleTags.length

  return (
    <article
      ref={setNodeRef}
      style={style}
      className="card-hairline group relative flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-foreground/20"
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Mover ${item.name}`}
        className="absolute right-2 top-2 cursor-grab rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground active:cursor-grabbing group-hover:opacity-100 focus:opacity-100"
      >
        <GripVertical className="size-3.5" />
      </button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar ${item.name}`}
        className="flex items-start gap-3 text-left"
      >
        <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-secondary/60">
          {item.image_url ? (
            <Image
              src={item.image_url}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
              unoptimized
            />
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
      </div>
    </article>
  )
}
