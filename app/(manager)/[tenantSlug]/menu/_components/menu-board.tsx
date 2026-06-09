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
import {
  ChevronRight,
  FolderTree,
  GripVertical,
  Home,
  MoreHorizontal,
  Move,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
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
  Dialog,
  DialogContent,
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import { deleteCategory, moveCategory, reorderCategories, updateCategory } from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { buildCategoryTree, categoryPath, type MenuTreeNode } from '@/lib/menu/tree'
import { CategoryEditDialog } from './category-edit-dialog'
import { CategoryRow } from './category-row'
import { CategoryTreePicker } from './category-tree-picker'
import { MenuSearch } from './menu-search'
import { NewCategoryForm } from './new-category-form'
import { NewItemForm } from './new-item-form'

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
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const router = useRouter()

  // Árbol completo en memoria. Se rearma si cambian categories/items (router.refresh).
  const tree = useMemo(() => buildCategoryTree(categories, items), [categories, items])
  const nodeById = useMemo(() => {
    const m = new Map<string, MenuTreeNode>()
    const walk = (ns: MenuTreeNode[]) => {
      for (const n of ns) {
        m.set(n.id, n)
        walk(n.children)
      }
    }
    walk(tree)
    return m
  }, [tree])

  const current = currentId ? (nodeById.get(currentId) ?? null) : null
  const levelNodes = current ? current.children : tree
  const levelItems = current ? current.items : []
  const breadcrumb = current ? categoryPath(categories, current.id) : []

  // Búsqueda global y plana: categorías que matchean por nombre, con su ruta.
  const searchHits = useMemo(() => {
    const q = search.trim()
    if (q.length === 0) return []
    const needle = norm(q)
    return categories
      .filter((c) => norm(c.name).includes(needle))
      .map((c) => ({ cat: c, path: categoryPath(categories, c.id) }))
  }, [categories, search])

  if (search.trim().length > 0) {
    return (
      <div className="space-y-5">
        <div className="sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
        {searchHits.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Sin resultados"
            description={`No encontramos categorías con "${search}".`}
          />
        ) : (
          <ul className="card-hairline divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
            {searchHits.map(({ cat, path }) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCurrentId(cat.id)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-secondary/40"
                >
                  <FolderTree className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm">
                    {path.map((c) => c.name).join(' › ')}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
      </div>

      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Ruta de categorías">
        <button
          type="button"
          onClick={() => setCurrentId(null)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        >
          <Home className="size-3.5" aria-hidden />
          Carta
        </button>
        {breadcrumb.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden />
            <button
              type="button"
              onClick={() => setCurrentId(c.id)}
              className="rounded-md px-1.5 py-1 font-medium hover:bg-secondary/50"
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Acciones del nivel */}
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="size-3.5" /> Agregar ítem
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(560px,calc(100vw-2rem))] p-3"
              sideOffset={6}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Nuevo ítem en {current.name}
              </p>
              <NewItemForm
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                categoryId={current.id}
                onCreated={() => router.refresh()}
              />
            </PopoverContent>
          </Popover>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" /> Agregar {current ? 'subcategoría' : 'categoría'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3" sideOffset={6}>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Nueva {current ? 'subcategoría' : 'categoría'}
            </p>
            <NewCategoryForm
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              parentId={current?.id ?? null}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Ítems directos del nivel actual */}
      {current ? (
        <div className="card-hairline rounded-xl border border-border/70 bg-card p-4 sm:p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Ítems de {current.name}
          </p>
          <CategoryRow
            category={current}
            items={levelItems}
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            allCategories={categories}
            allTags={tags}
            hideAddButton
          />
        </div>
      ) : null}

      {/* Subcategorías del nivel actual */}
      <SubcategoryList
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        parentId={current?.id ?? null}
        nodes={levelNodes}
        allCategories={categories}
        onEnter={setCurrentId}
      />

      {levelNodes.length === 0 && (!current || current.items.length === 0) ? (
        <EmptyState
          icon={FolderTree}
          title={current ? 'Categoría vacía' : 'Empezá creando una categoría'}
          description={
            current
              ? 'Agregá ítems o subcategorías con los botones de arriba.'
              : 'Las categorías agrupan tu carta. Podés anidar subcategorías dentro.'
          }
        />
      ) : null}
    </div>
  )
}

function SubcategoryList({
  tenantSlug,
  tenantId,
  parentId,
  nodes,
  allCategories,
  onEnter,
}: {
  tenantSlug: string
  tenantId: string
  parentId: string | null
  nodes: MenuTreeNode[]
  allCategories: MenuCategory[]
  onEnter: (id: string) => void
}) {
  const [order, setOrder] = useState(nodes)
  const [, startTransition] = useTransition()

  // Re-sincroniza si cambian los nodos (navegación de nivel o refresh).
  // Patrón de "ajustar estado al cambiar props" comparando por ids.
  const idsKey = nodes.map((n) => n.id).join(',')
  const orderIdsKey = order.map((n) => n.id).join(',')
  if (idsKey !== orderIdsKey) {
    setOrder(nodes)
  }

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
    const prev = order
    const next = arrayMove(order, oldIndex, newIndex)
    setOrder(next)
    startTransition(async () => {
      const r = await reorderCategories(
        tenantSlug,
        parentId,
        next.map((c) => c.id),
      )
      if (!r.ok) {
        toast.error(r.message)
        setOrder(prev)
      }
    })
  }

  if (order.length === 0) return null

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Subcategorías
          </p>
          {order.map((node) => (
            <SubcategoryRow
              key={node.id}
              node={node}
              tenantSlug={tenantSlug}
              tenantId={tenantId}
              allCategories={allCategories}
              onEnter={onEnter}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SubcategoryRow({
  node,
  tenantSlug,
  tenantId,
  allCategories,
  onEnter,
}: {
  node: MenuTreeNode
  tenantSlug: string
  tenantId: string
  allCategories: MenuCategory[]
  onEnter: (id: string) => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: node.id,
  })
  const [editing, setEditing] = useState(false)
  const [toDelete, setToDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(node.parent_id)
  const [, startTransition] = useTransition()

  const directItems = node.items.length
  const subcats = node.children.length

  const onToggle = () => {
    startTransition(async () => {
      const r = await updateCategory(tenantSlug, {
        id: node.id,
        name: node.name,
        active: !node.active,
        image_url: node.image_url,
      })
      if (r.ok) toast.success(node.active ? 'Categoría pausada.' : 'Categoría activada.')
      else toast.error(r.message)
    })
  }

  const onDelete = () => {
    setToDelete(false)
    startTransition(async () => {
      const r = await deleteCategory(tenantSlug, node.id)
      if (r.ok) toast.success(r.message ?? 'Categoría eliminada.')
      else toast.error(r.message)
    })
  }

  const onConfirmMove = () => {
    setMoving(false)
    startTransition(async () => {
      const r = await moveCategory(tenantSlug, { id: node.id, parent_id: moveTarget })
      if (r.ok) toast.success('Categoría movida.')
      else toast.error(r.message)
    })
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card-hairline flex items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5"
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Mover ${node.name}`}
        className="cursor-grab rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onEnter(node.id)}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <FolderTree className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-serif text-base font-semibold tracking-tight">{node.name}</span>
        {!node.active ? (
          <Badge variant="muted" className="text-[10px]">
            Pausada
          </Badge>
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">
          {subcats > 0 ? `${subcats} subcat · ` : ''}
          {directItems} ítem{directItems === 1 ? '' : 's'}
        </span>
      </button>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-foreground"
            aria-label={`Acciones de ${node.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <Move className="size-3.5" /> Mover a…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle}>
            {node.active ? (
              <>
                <Pause className="size-3.5" /> Pausar
              </>
            ) : (
              <>
                <Play className="size-3.5" /> Activar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(true)}>
            <Trash2 className="size-3.5" /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing ? (
        <CategoryEditDialog
          category={node}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {/* Mover a… */}
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover "{node.name}"</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Elegí la categoría que la va a contener.</p>
          <CategoryTreePicker
            categories={allCategories}
            value={moveTarget}
            onChange={setMoveTarget}
            excludeSubtreeOf={node.id}
            allowRoot
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancelar
            </Button>
            <Button onClick={onConfirmMove}>Mover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar en cascada */}
      <AlertDialog open={toDelete} onOpenChange={setToDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{node.name}" y todo su contenido?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran sus subcategorías e ítems. Los ítems que aparezcan en visitas o pedidos
              pasados quedan archivados (ocultos) para no romper el historial. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
