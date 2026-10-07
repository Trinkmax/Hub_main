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
import {
  ChevronRight,
  FolderInput,
  FolderTree,
  House,
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
import { PhotoButton } from '@/components/media/photo-button'
import { Button } from '@/components/ui/button'
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
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import type { ItemTagRow } from '@/lib/item-tags/queries'
import {
  deleteCategory,
  moveCategory,
  moveItemsToCategory,
  reorderCategories,
  updateCategory,
} from '@/lib/menu/actions'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import { buildCategoryTree, categoryPath, type MenuTreeNode } from '@/lib/menu/tree'
import { cn } from '@/lib/utils'
import { CategoryEditDialog } from './category-edit-dialog'
import { CategoryRow } from './category-row'
import { CategoryTreePicker } from './category-tree-picker'
import { MenuSearch } from './menu-search'
import { CATEGORY_STATUS } from './menu-status'
import { DRAGGING_CLASSES, DragHandle, ROW_LIST_CLASSES, sortableStyle } from './menu-ui'
import { NewCategoryForm } from './new-category-form'
import { NewItemForm } from './new-item-form'

/** Ítems propios + de todo el subárbol (para el contador de categorías-madre). */
function totalItemsOf(node: MenuTreeNode): number {
  return node.items.length + node.children.reduce((sum, child) => sum + totalItemsOf(child), 0)
}

// Normaliza texto para búsqueda insensible a acentos y mayúsculas.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
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
      <div className="flex flex-col gap-6">
        <div className="sm:max-w-md">
          <MenuSearch value={search} onChange={setSearch} />
        </div>
        {searchHits.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Sin resultados"
            description={`No encontramos categorías con «${search.trim()}».`}
            action={
              <Button variant="secondary" onClick={() => setSearch('')}>
                Limpiar la búsqueda
              </Button>
            }
          />
        ) : (
          <ul className={ROW_LIST_CLASSES} aria-label="Categorías encontradas">
            {searchHits.map(({ cat, path }) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setCurrentId(cat.id)
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left -outline-offset-2 outline-(--ring) hover:bg-hover focus-visible:outline-2 active:bg-active"
                >
                  <FolderTree
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate type-body">
                    {path.map((c) => c.name).join(' › ')}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="sm:max-w-md">
        <MenuSearch value={search} onChange={setSearch} />
      </div>

      {/* Dónde estoy: Carta › Comida › Pizzas */}
      <nav aria-label="Ruta de categorías">
        <ol className="flex flex-wrap items-center gap-1 type-small">
          <li>
            {current ? (
              <button
                type="button"
                onClick={() => setCurrentId(null)}
                className="relative hit-area inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2"
              >
                <House className="size-3.5" aria-hidden="true" />
                Carta
              </button>
            ) : (
              <span
                aria-current="location"
                className="inline-flex items-center gap-1 px-1.5 py-1 font-medium text-foreground"
              >
                <House className="size-3.5" aria-hidden="true" />
                Carta
              </span>
            )}
          </li>
          {breadcrumb.map((c, index) => {
            const isLast = index === breadcrumb.length - 1
            return (
              <li key={c.id} className="inline-flex items-center gap-1">
                <ChevronRight className="size-3.5 text-subtle-foreground" aria-hidden="true" />
                {isLast ? (
                  <span aria-current="location" className="px-1.5 py-1 font-medium text-foreground">
                    {c.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCurrentId(c.id)}
                    className="relative hit-area rounded-md px-1.5 py-1 text-muted-foreground outline-offset-2 outline-(--ring) hover:bg-hover hover:text-foreground focus-visible:outline-2"
                  >
                    {c.name}
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Acciones del nivel: adentro de una categoría se carga un ítem o una
          subcategoría (en la raíz, la categoría nueva está arriba, en el encabezado). */}
      {current ? (
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button data-tour="menu-agregar-item">
                <Plus aria-hidden="true" />
                Agregar ítem
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="flex w-[min(560px,calc(100vw-2rem))] flex-col gap-3"
            >
              <PopoverHeader>
                <PopoverTitle>Nuevo ítem en {current.name}</PopoverTitle>
              </PopoverHeader>
              <NewItemForm
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                categoryId={current.id}
                onCreated={() => router.refresh()}
              />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">
                <Plus aria-hidden="true" />
                Agregar subcategoría
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-80 flex-col gap-3">
              <PopoverHeader>
                <PopoverTitle>Nueva subcategoría</PopoverTitle>
                <PopoverDescription>
                  Adentro de {current.name}. Ej: Comida → Pizzas.
                </PopoverDescription>
              </PopoverHeader>
              <NewCategoryForm tenantId={tenantId} tenantSlug={tenantSlug} parentId={current.id} />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {/* Subcategorías primero: en una categoría contenedora SON el contenido.
          El bloque de ítems directos solo aparece cuando hay ítems (o cuando la
          categoría es hoja, para invitar a cargar el primero). */}
      <SubcategoryList
        key={current?.id ?? 'root'}
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        parentId={current?.id ?? null}
        heading={current ? `Dentro de ${current.name}` : 'Categorías'}
        nodes={levelNodes}
        allCategories={categories}
        onEnter={setCurrentId}
      />

      {current && (levelItems.length > 0 || current.children.length === 0) ? (
        <Section
          title={`Ítems de ${current.name}`}
          description={
            levelItems.length > 1
              ? 'Tocá un ítem para editarlo. Arrastrá desde el asa para cambiar el orden.'
              : undefined
          }
        >
          {/* key por categoría: CategoryRow tiene estado optimista propio (useState
              de items) y sin remount arrastraría los ítems del nivel anterior. */}
          <CategoryRow
            key={current.id}
            category={current}
            items={levelItems}
            tenantSlug={tenantSlug}
            tenantId={tenantId}
            allCategories={categories}
            allTags={tags}
            hideAddButton
          />
        </Section>
      ) : null}

      {/* Dentro de una categoría, el vacío ya lo comunica la sección de ítems. */}
      {!current && levelNodes.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="Empezá creando una categoría"
          description="Las categorías agrupan la carta. Podés anidar subcategorías adentro."
        />
      ) : null}
    </div>
  )
}

function SubcategoryList({
  tenantSlug,
  tenantId,
  parentId,
  heading,
  nodes,
  allCategories,
  onEnter,
}: {
  tenantSlug: string
  tenantId: string
  parentId: string | null
  heading: string
  nodes: MenuTreeNode[]
  allCategories: MenuCategory[]
  onEnter: (id: string) => void
}) {
  const [order, setOrder] = useState(nodes)
  const [, startTransition] = useTransition()

  // Re-sincroniza si cambia el CONTENIDO de los nodos (membresía, nombre,
  // activo o conteo de ítems), pero NO su orden. Comparamos una firma ordenada
  // que ignora `position`/orden del array — así un reorder optimista no se pisa,
  // mientras que un move de ítems (que cambia los conteos) sí refresca los
  // números sin esperar a un remount.
  const sigOf = (ns: MenuTreeNode[]) =>
    [...ns]
      .map((n) => `${n.id}:${n.name}:${n.active ? 1 : 0}:${n.items.length}:${totalItemsOf(n)}`)
      .sort()
      .join('|')
  if (sigOf(nodes) !== sigOf(order)) {
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
    <Section
      title={heading}
      description={
        order.length > 1
          ? 'El orden es el de la carta: arrastrá desde el asa lo que más querés vender primero.'
          : undefined
      }
      data-tour="menu-categorias"
    >
      <DndContext
        id="menu-subcategorias"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className={ROW_LIST_CLASSES}>
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
          </ul>
        </SortableContext>
      </DndContext>
    </Section>
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
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(node.parent_id)
  const [movingItems, setMovingItems] = useState(false)
  const [itemsTarget, setItemsTarget] = useState<string | null>(null)
  const [movePending, startMove] = useTransition()
  const [, startTransition] = useTransition()
  const router = useRouter()

  const directItems = node.items.length
  const subcats = node.children.length
  const totalItems = totalItemsOf(node)

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

  const onDelete = async () => {
    await confirm({
      title: `¿Borrar «${node.name}» y todo su contenido?`,
      description:
        'Se borran sus subcategorías e ítems. Los ítems que aparecen en visitas o pedidos pasados quedan archivados (ocultos) para no romper el historial. No se puede deshacer.',
      confirmLabel: 'Borrar todo',
      pendingLabel: 'Borrando…',
      tone: 'danger',
      onConfirm: async () => {
        const r = await deleteCategory(tenantSlug, node.id)
        if (!r.ok) return r
        toast.success(r.message ?? 'Categoría borrada.')
      },
    })
  }

  const onConfirmMove = () => {
    startMove(async () => {
      const r = await moveCategory(tenantSlug, { id: node.id, parent_id: moveTarget })
      if (r.ok) {
        toast.success('Categoría movida.')
        setMoving(false)
      } else {
        toast.error(r.message)
      }
    })
  }

  const onConfirmMoveItems = () => {
    if (!itemsTarget || directItems === 0) return
    const ids = node.items.map((i) => i.id)
    startMove(async () => {
      const r = await moveItemsToCategory(tenantSlug, ids, itemsTarget)
      if (r.ok) {
        toast.success(r.message ?? 'Ítems movidos.')
        setMovingItems(false)
        router.refresh()
      } else {
        toast.error(r.message)
      }
    })
  }

  return (
    <li
      ref={setNodeRef}
      style={sortableStyle(transform, transition, isDragging)}
      className={cn('flex items-center gap-2 bg-card px-2 py-2', isDragging && DRAGGING_CLASSES)}
    >
      <DragHandle label={`Mover ${node.name}`} attributes={attributes} listeners={listeners} />
      <PhotoButton
        src={node.image_url}
        sizes="48px"
        fallbackIcon={FolderTree}
        label={`Cambiar el nombre y la foto de ${node.name}`}
        onClick={() => setEditing(true)}
      />
      <button
        type="button"
        onClick={() => onEnter(node.id)}
        className="group/entrar ms-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left outline-offset-2 outline-(--ring) focus-visible:outline-2"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'truncate type-body font-medium',
                node.active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {node.name}
            </span>
            {node.active ? null : <StatusBadge status="paused" map={CATEGORY_STATUS} />}
          </span>
          <span className="type-caption type-amount text-muted-foreground">
            {subcats > 0
              ? `${plural(subcats, 'subcategoría', 'subcategorías')} · ${plural(totalItems, 'ítem', 'ítems')} en total`
              : plural(directItems, 'ítem', 'ítems')}
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 type-label text-muted-foreground group-hover/entrar:text-foreground sm:inline-flex">
          Entrar
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground group-hover/entrar:text-foreground"
          aria-hidden="true"
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Acciones de ${node.name}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden="true" /> Editar (nombre y foto)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <Move aria-hidden="true" /> Mover a…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={directItems === 0}
            onSelect={() => {
              setItemsTarget(null)
              setMovingItems(true)
            }}
          >
            <FolderInput aria-hidden="true" /> Mover los ítems a…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggle}>
            {node.active ? (
              <>
                <Pause aria-hidden="true" /> Pausar
              </>
            ) : (
              <>
                <Play aria-hidden="true" /> Activar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 aria-hidden="true" /> Borrar
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
      <Dialog
        open={moving}
        onOpenChange={(o) => {
          if (movePending) return
          if (!o) setMoveTarget(node.parent_id)
          setMoving(o)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Mover «{node.name}»</DialogTitle>
            <DialogDescription>Elegí la categoría que la va a contener.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CategoryTreePicker
              categories={allCategories}
              value={moveTarget}
              onChange={setMoveTarget}
              excludeSubtreeOf={node.id}
              allowRoot
              aria-label="Categoría destino"
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={movePending}
              onClick={() => {
                setMoving(false)
                setMoveTarget(node.parent_id)
              }}
            >
              Cancelar
            </Button>
            <Button onClick={onConfirmMove} loading={movePending} loadingText="Moviendo…">
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mover TODOS los ítems de esta categoría a otra (atajo masivo) */}
      <Dialog
        open={movingItems}
        onOpenChange={(o) => {
          if (movePending) return
          if (!o) setItemsTarget(null)
          setMovingItems(o)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              Mover {plural(directItems, 'ítem', 'ítems')} de «{node.name}»
            </DialogTitle>
            <DialogDescription>
              Todos los ítems de esta categoría pasan a la que elijas. Las subcategorías quedan como
              están.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CategoryTreePicker
              categories={allCategories}
              value={itemsTarget}
              onChange={setItemsTarget}
              excludeIds={[node.id]}
              aria-label="Categoría destino"
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={movePending}
              onClick={() => {
                setMovingItems(false)
                setItemsTarget(null)
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={onConfirmMoveItems}
              disabled={!itemsTarget}
              loading={movePending}
              loadingText="Moviendo…"
            >
              Mover los ítems
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
