'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BoardGroup, BoardTask, StatusBreakdown } from '@/lib/marketing/board'
import {
  GROUP_COLOR_LABELS,
  GROUP_COLORS,
  GROUP_RAIL,
  GROUP_TEXT,
  isGroupColor,
  STATUS_FILL,
  STATUS_LABELS,
} from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'
import { isPendingTask, useBoard } from './board-context'
import { ROW_GRID, TaskRow } from './task-row'

/**
 * Un grupo del tablero, como en Monday: cabecera con el nombre en su color, la
 * cantidad y la barrita del reparto de estados (cuenta el grupo entero, también
 * lo terminado: así se ve cuánto falta), las filas en su orden, y al pie
 * «+ Agregar tarea» para cargar de corrido.
 */
export function GroupSection({
  group,
  tasks,
  breakdown,
  totalInGroup,
  collapsed,
  onToggle,
  leaving,
  isFirst,
  isLast,
}: {
  group: BoardGroup
  /** Las abiertas que se ven (con el filtro aplicado), en orden. */
  tasks: BoardTask[]
  breakdown: StatusBreakdown
  /** Cuántas tareas tiene el grupo en total (para el aviso de borrar). */
  totalInGroup: number
  collapsed: boolean
  onToggle: () => void
  leaving: ReadonlySet<string>
  isFirst: boolean
  isLast: boolean
}) {
  const board = useBoard()
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.id}` })
  const openCount = tasks.length

  return (
    <section id={`group-${group.id}`} aria-label={group.name} className="mb-6 scroll-mt-16">
      <GroupHeader
        group={group}
        count={openCount}
        breakdown={breakdown}
        totalInGroup={totalInGroup}
        collapsed={collapsed}
        onToggle={onToggle}
        isFirst={isFirst}
        isLast={isLast}
      />

      {collapsed ? null : (
        <div
          ref={setNodeRef}
          className={cn(
            'overflow-hidden rounded-b-lg border-x border-b border-border/70 transition-colors',
            isOver && board.dragEnabled && 'ring-2 ring-ring/40',
          )}
        >
          <SortableContext
            id={group.id}
            items={tasks.map((task) => task.id)}
            strategy={verticalListSortingStrategy}
          >
            {/* Sin animación de entrada ni de salida: la tarea recién cargada se cambia por la de la
                base sin parpadear. La única que se va animada es la que se termina (CSS). */}
            {tasks.map((task) => (
              <SortableTaskRow
                key={task.id}
                task={task}
                group={group}
                leaving={leaving.has(task.id)}
              />
            ))}
          </SortableContext>
          {isPendingTask(group) ? null : <AddTaskRow group={group} />}
        </div>
      )}
    </section>
  )
}

function SortableTaskRow({
  task,
  group,
  leaving,
}: {
  task: BoardTask
  group: BoardGroup
  leaving: boolean
}) {
  const board = useBoard()
  const sortable = useSortable({
    id: task.id,
    data: { groupId: group.id },
    disabled: !board.dragEnabled || isPendingTask(task),
  })
  return (
    <TaskRow
      ref={sortable.setNodeRef}
      // Recién terminada: se queda un instante en su grupo, ya en verde, antes de irse.
      task={leaving ? { ...task, status: 'done' } : task}
      group={group}
      leaving={leaving}
      isDragging={sortable.isDragging}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      dragHandle={{
        attributes: sortable.attributes,
        listeners: sortable.listeners,
        setActivatorNodeRef: sortable.setActivatorNodeRef,
      }}
    />
  )
}

/** La barrita del reparto de estados (Monday la pone al pie del grupo). */
export function StatusBar({
  breakdown,
  className,
}: {
  breakdown: StatusBreakdown
  className?: string
}) {
  if (breakdown.total === 0) {
    return <span className={cn('block h-2 rounded-full bg-muted', className)} aria-hidden />
  }
  const summary = breakdown.parts
    .map((part) => `${part.count} ${STATUS_LABELS[part.status].toLowerCase()}`)
    .join(', ')
  return (
    <span
      role="img"
      aria-label={`Estados: ${summary}`}
      title={summary}
      className={cn('flex h-2 overflow-hidden rounded-full bg-muted', className)}
    >
      {breakdown.parts.map((part) => (
        <span
          key={part.status}
          className={cn('h-full', STATUS_FILL[part.status])}
          style={{ flexGrow: part.count, flexBasis: 0 }}
        />
      ))}
    </span>
  )
}

function GroupHeader({
  group,
  count,
  breakdown,
  totalInGroup,
  collapsed,
  onToggle,
  isFirst,
  isLast,
}: {
  group: BoardGroup
  count: number
  breakdown: StatusBreakdown
  totalInGroup: number
  collapsed: boolean
  onToggle: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const board = useBoard()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function saveName() {
    setRenaming(false)
    const next = draft.trim()
    if (next && next !== group.name) board.renameGroup(group, next)
    else setDraft(group.name)
  }

  const nameNode = renaming ? (
    <input
      // biome-ignore lint/a11y/noAutofocus: se abre para escribir el nombre.
      autoFocus
      value={draft}
      maxLength={60}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={saveName}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          saveName()
        }
        if (event.key === 'Escape') {
          setDraft(group.name)
          setRenaming(false)
        }
      }}
      aria-label="Nombre del grupo"
      className={cn(
        'h-8 min-w-0 flex-1 rounded-md border border-ring bg-background px-2 text-[15px] font-semibold outline-none',
        GROUP_TEXT[group.color],
      )}
    />
  ) : (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronRight
        className={cn(
          'size-4 shrink-0 transition-transform duration-200',
          GROUP_TEXT[group.color],
          !collapsed && 'rotate-90',
        )}
        aria-hidden
      />
      <h2
        className={cn('truncate text-[15px] font-semibold tracking-tight', GROUP_TEXT[group.color])}
        onDoubleClick={(event) => {
          if (!board.canManage) return
          event.stopPropagation()
          setDraft(group.name)
          setRenaming(true)
        }}
      >
        {group.name}
      </h2>
      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {count} {count === 1 ? 'tarea' : 'tareas'}
      </span>
    </button>
  )

  const menu = board.canManage ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Opciones del grupo ${group.name}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onSelect={() => {
            setDraft(group.name)
            setRenaming(true)
          }}
        >
          <Pencil aria-hidden />
          Cambiar el nombre
        </DropdownMenuItem>
        {/* Un submenú con ítems de verdad: se recorre con las flechas (botones sueltos
            adentro de un menú no se alcanzan con el teclado). */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <span aria-hidden className={cn('size-3.5 rounded-full', GROUP_RAIL[group.color])} />
            Cambiar el color
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup
              value={group.color}
              onValueChange={(value) => {
                if (isGroupColor(value) && value !== group.color) board.recolorGroup(group, value)
              }}
            >
              {GROUP_COLORS.map((color) => (
                <DropdownMenuRadioItem key={color} value={color} className="gap-2">
                  <span aria-hidden className={cn('size-3.5 rounded-full', GROUP_RAIL[color])} />
                  {GROUP_COLOR_LABELS[color]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isFirst} onSelect={() => board.moveGroup(group, -1)}>
          <ArrowUp aria-hidden />
          Subir el grupo
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isLast} onSelect={() => board.moveGroup(group, 1)}>
          <ArrowDown aria-hidden />
          Bajar el grupo
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden />
          Borrar el grupo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <>
      <div
        className={cn(
          // Debajo de la barra del panel (h-14), que también queda fija.
          'sticky top-14 z-10 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85',
          collapsed ? 'rounded-lg border' : 'rounded-t-lg border-x border-t',
        )}
      >
        <span
          aria-hidden
          className={cn('absolute inset-y-0 left-0 w-1 rounded-l-lg', GROUP_RAIL[group.color])}
        />

        {/* Compu: alineada con las columnas de las filas. */}
        <div className={cn('hidden min-h-11 items-center @3xl:grid', ROW_GRID)}>
          <div className="flex min-w-0 items-center gap-1 pl-3 pr-2">
            {nameNode}
            {menu}
          </div>
          <ColumnLabel />
          <ColumnLabel>Responsable</ColumnLabel>
          <ColumnLabel>Involucrados</ColumnLabel>
          <div className="flex h-full items-center border-l border-transparent px-2">
            <StatusBar breakdown={breakdown} className="w-full" />
          </div>
          <ColumnLabel>Vencimiento</ColumnLabel>
          <ColumnLabel className="hidden @6xl:flex">Notas</ColumnLabel>
          <ColumnLabel>Archivos</ColumnLabel>
        </div>

        {/* Celular */}
        <div className="flex min-h-11 items-center gap-2 pl-3 pr-2 @3xl:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-1">{nameNode}</div>
          <StatusBar breakdown={breakdown} className="w-20 shrink-0" />
          {menu}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{group.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {totalInGroup === 0
                ? 'El grupo está vacío.'
                : `Se borran también sus ${totalInGroup} ${totalInGroup === 1 ? 'tarea' : 'tareas'} (las terminadas incluidas), con sus actualizaciones y archivos. No se puede deshacer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => board.removeGroup(group)}
            >
              Borrar el grupo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ColumnLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-full items-center justify-center border-l border-transparent px-1 text-center text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * «+ Agregar tarea»: escribís, Enter, y queda listo para la próxima. Pegar una
 * lista (una por renglón) carga todas de una.
 */
function AddTaskRow({ group }: { group: BoardGroup }) {
  const board = useBoard()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function submit() {
    const title = value.trim()
    if (!title) return
    board.createTask(group.id, title.slice(0, 160))
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="relative flex items-center bg-card/60">
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1 opacity-35', GROUP_RAIL[group.color])}
      />
      <Plus className="ml-3 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        data-add-task={group.id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
          if (event.key === 'Escape') {
            setValue('')
            event.currentTarget.blur()
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text')
          const lines = text
            .split(/\r?\n/)
            .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
            .filter((line) => line.length > 0)
          if (lines.length < 2) return
          event.preventDefault()
          for (const line of lines.slice(0, 30)) board.createTask(group.id, line.slice(0, 160))
        }}
        maxLength={160}
        placeholder="Agregar tarea"
        aria-label={`Agregar tarea a ${group.name}`}
        className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/80 focus:placeholder:text-muted-foreground/50"
      />
      {value.trim() ? (
        <span className="mr-3 hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
          Enter para agregar
        </span>
      ) : null}
    </div>
  )
}
