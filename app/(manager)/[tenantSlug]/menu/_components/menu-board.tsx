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
import { GripVertical, MoreHorizontal, Pause, Pencil, Play, Search, Trash2 } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
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
import { EmptyState } from '@/components/ui/empty-state'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import { deleteCategory, reorderCategories, updateCategory } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { CategoryEditDialog } from './category-edit-dialog'
import { CategoryRow } from './category-row'
import { MenuSearch } from './menu-search'

// Normaliza texto para búsqueda insensible a acentos y mayúsculas.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function MenuBoard({
  tenantSlug,
  tenantId,
  categories,
  items,
  tags,
}: {
  tenantSlug: string
  tenantId: string
  categories: MenuCategory[]
  items: MenuItem[]
  tags: ItemTagRow[]
}) {
  const [order, setOrder] = useState(categories)
  const [search, setSearch] = useState('')
  const [, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Filtrado en memoria. Si la query matchea el nombre de categoría, mostramos
  // todos los ítems de esa categoría aunque sus nombres no coincidan, para que
  // el dueño pueda saltar rápido a "Tragos" tipeando "trago".
  const { filteredCategories, filteredItems, totalShownItems } = useMemo(() => {
    const q = search.trim()
    if (q.length === 0) {
      return {
        filteredCategories: order,
        filteredItems: items,
        totalShownItems: items.length,
      }
    }
    const needle = norm(q)
    const itemMatch = (it: MenuItem) => {
      if (norm(it.name).includes(needle)) return true
      if (it.description && norm(it.description).includes(needle)) return true
      if (it.tags.some((t) => norm(t.name).includes(needle))) return true
      return false
    }
    const catMatchIds = new Set(order.filter((c) => norm(c.name).includes(needle)).map((c) => c.id))

    const visibleItems = items.filter((it) => catMatchIds.has(it.category_id) || itemMatch(it))
    const visibleCatIds = new Set([...catMatchIds, ...visibleItems.map((it) => it.category_id)])
    const visibleCategories = order.filter((c) => visibleCatIds.has(c.id))
    return {
      filteredCategories: visibleCategories,
      filteredItems: visibleItems,
      totalShownItems: visibleItems.length,
    }
  }, [order, items, search])

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex((c) => c.id === active.id)
    const newIndex = order.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = order
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startTransition(async () => {
      const result = await reorderCategories(
        tenantSlug,
        null,
        next.map((c) => c.id),
      )
      if (!result.ok) {
        toast.error(result.message)
        setOrder(prev)
      }
    })
  }

  const hasResults = filteredCategories.length > 0

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
        {search.length > 0 ? (
          <p className="text-xs tabular-nums text-muted-foreground">
            {totalShownItems} resultado{totalShownItems === 1 ? '' : 's'} en{' '}
            {filteredCategories.length} categoría
            {filteredCategories.length === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      {/* La búsqueda no afecta el orden ni el drag de categorías; en modo búsqueda
          renderizamos sin DnD para evitar mover lo que el usuario no está viendo. */}
      {search.length === 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={filteredCategories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {filteredCategories.map((cat) => (
                <SortableCategory
                  key={cat.id}
                  category={cat}
                  items={filteredItems.filter((i) => i.category_id === cat.id)}
                  tenantSlug={tenantSlug}
                  tenantId={tenantId}
                  allCategories={order}
                  allTags={tags}
                  draggable
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : hasResults ? (
        <div className="space-y-4">
          {filteredCategories.map((cat) => (
            <SortableCategory
              key={cat.id}
              category={cat}
              items={filteredItems.filter((i) => i.category_id === cat.id)}
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              allCategories={order}
              allTags={tags}
              draggable={false}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="Sin resultados"
          description={`No encontramos nada con "${search}". Probá con otro término.`}
        />
      )}
    </div>
  )
}

function SortableCategory({
  category,
  items,
  tenantSlug,
  tenantId,
  allCategories,
  allTags,
  draggable,
}: {
  category: MenuCategory
  items: MenuItem[]
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
  allTags: ItemTagRow[]
  draggable: boolean
}) {
  // useSortable se llama siempre; el handle se oculta cuando draggable=false
  // para evitar que el usuario crea que puede reordenar mientras filtra.
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: !draggable,
  })

  const [editingCat, setEditingCat] = useState(false)
  const [toDeleteCat, setToDeleteCat] = useState(false)
  const [, startTransition] = useTransition()

  const onToggleCat = () => {
    startTransition(async () => {
      const r = await updateCategory(tenantSlug, {
        id: category.id,
        name: category.name,
        active: !category.active,
        image_url: category.image_url,
      })
      if (r.ok) {
        toast.success(category.active ? 'Categoría pausada.' : 'Categoría activada.')
      } else {
        toast.error(r.message)
      }
    })
  }

  const onDeleteCat = () => {
    setToDeleteCat(false)
    startTransition(async () => {
      const r = await deleteCategory(tenantSlug, category.id)
      if (r.ok) {
        toast.success(`Categoría "${category.name}" eliminada.`)
      } else {
        toast.error(r.message)
      }
    })
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      className="card-hairline overflow-hidden rounded-xl border border-border/70 bg-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-secondary/30 px-4 py-3">
        {draggable ? (
          <button
            {...attributes}
            {...listeners}
            type="button"
            aria-label={`Mover ${category.name}`}
            className="cursor-grab rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <h3 className="font-serif text-lg font-semibold tracking-tight text-foreground">
          {category.name}
        </h3>
        {!category.active ? (
          <Badge variant="muted" className="text-[10px]">
            Pausada
          </Badge>
        ) : null}
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto size-8 text-muted-foreground hover:text-foreground"
              aria-label={`Acciones de ${category.name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => setEditingCat(true)}>
              <Pencil className="size-3.5" />
              Renombrar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleCat}>
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
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setToDeleteCat(true)}>
              <Trash2 className="size-3.5" />
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="p-4 sm:p-5">
        <CategoryRow
          category={category}
          items={items}
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          allCategories={allCategories}
          allTags={allTags}
        />
      </div>

      {editingCat ? (
        <CategoryEditDialog
          category={category}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          onClose={() => setEditingCat(false)}
        />
      ) : null}

      <AlertDialog open={toDeleteCat} onOpenChange={setToDeleteCat}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la categoría "{category.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Si la categoría tiene ítems, primero hay que pasarlos a otra. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onDeleteCat()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
