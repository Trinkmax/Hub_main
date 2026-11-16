'use client'

import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import {
  GripVertical,
  MessageCircle,
  NotebookPen,
  PanelRightOpen,
  Paperclip,
  UserRound,
} from 'lucide-react'
import { type CSSProperties, forwardRef, useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type BoardGroup, type BoardTask, peopleOf } from '@/lib/marketing/board'
import { GROUP_RAIL, GROUP_TEXT } from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'
import { isPendingTask, useBoard } from './board-context'
import { DuePicker } from './due-picker'
import { PeoplePicker } from './people-picker'
import { AvatarStack, PersonChip } from './person-avatar'
import { StatusPicker } from './status-picker'

/**
 * Las columnas del tablero en la compu (las comparten la cabecera de cada grupo
 * y sus filas): Tarea · actualizaciones · Responsable · Involucrados · Estado ·
 * Vencimiento · Notas (solo con lugar) · Archivos. Es por ancho del tablero
 * (container query), no de la ventana: con el menú abierto en una notebook
 * entra igual.
 */
// Solo las columnas: el `display` (oculto en el celular, grilla desde @3xl) lo pone cada uno.
export const ROW_GRID =
  'grid-cols-[minmax(0,1fr)_2.5rem_5.5rem_7.5rem_8rem_6rem_3.5rem] @6xl:grid-cols-[minmax(0,1fr)_2.5rem_5.5rem_7.5rem_8rem_6rem_10rem_3.5rem]'

export type DragHandle = {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  setActivatorNodeRef: (element: HTMLElement | null) => void
}

type TaskRowProps = {
  task: BoardTask
  group: BoardGroup
  /** Fila de «Terminadas»: lleva la ficha de su grupo. */
  done?: boolean
  /** Recién terminada: destella en verde antes de irse. */
  leaving?: boolean
  dragHandle?: DragHandle
  isDragging?: boolean
  style?: CSSProperties
}

export const TaskRow = forwardRef<HTMLDivElement, TaskRowProps>(function TaskRow(
  { task, group, done = false, leaving = false, dragHandle, isDragging = false, style },
  ref,
) {
  const board = useBoard()
  const pending = isPendingTask(task)
  const responsibles = peopleOf(task, 'responsible', board.team)
  const involved = peopleOf(task, 'involved', board.team)

  return (
    <div
      ref={ref}
      style={style}
      data-task-id={task.id}
      className={cn(
        'group/row relative border-b border-border/60 bg-card',
        leaving && 'task-row-leaving',
        pending && 'pointer-events-none opacity-60',
        isDragging && 'z-10 shadow-lg ring-1 ring-border',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', GROUP_RAIL[group.color])} />

      {/* ── Compu: la fila de Monday ─────────────────────────────── */}
      <div className={cn('hidden min-h-10 @3xl:grid', ROW_GRID)}>
        <div className="flex min-w-0 items-center gap-1 pl-2.5 pr-2">
          {dragHandle && board.dragEnabled ? (
            <button
              type="button"
              ref={dragHandle.setActivatorNodeRef}
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              aria-label={`Mover «${task.title}»`}
              className="-ml-1 flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/0 outline-none transition-colors group-hover/row:text-muted-foreground/70 hover:bg-accent focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="size-3.5" aria-hidden />
            </button>
          ) : (
            <span className="w-1 shrink-0" aria-hidden />
          )}
          <InlineTitle task={task} done={done} />
          {task.notes ? (
            <span
              className="shrink-0 text-muted-foreground/70 @6xl:hidden"
              title="Tiene notas"
              aria-hidden
            >
              <NotebookPen className="size-3.5" />
            </span>
          ) : null}
          {done ? (
            <span
              className={cn(
                'shrink-0 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold',
                GROUP_TEXT[group.color],
                'bg-secondary/80',
              )}
            >
              {group.name}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => board.openTask(task.id)}
            // En una tablet no hay «pasar el mouse»: ahí «Abrir» se ve siempre.
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-xs font-medium text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 pointer-coarse:opacity-100"
          >
            <PanelRightOpen className="size-3.5" aria-hidden />
            Abrir
          </button>
        </div>

        <Cell>
          <CountButton
            icon="updates"
            count={task.updatesCount}
            label={`${task.updatesCount} ${task.updatesCount === 1 ? 'actualización' : 'actualizaciones'} de «${task.title}»`}
            onClick={() => board.openTask(task.id, 'updates')}
          />
        </Cell>

        <Cell>
          <PeoplePicker
            label="Responsable"
            team={board.team}
            selected={task.responsibleIds}
            currentUserId={board.currentUserId}
            onCommit={(ids) => board.setPeople(task, 'responsible', ids)}
            triggerLabel={
              responsibles.length > 0
                ? `Responsable: ${responsibles.map((person) => person.name).join(', ')}. Cambiar`
                : 'Sin responsable. Elegir'
            }
            triggerClassName="flex h-full w-full items-center justify-center hover:bg-accent/50"
          >
            {responsibles.length > 0 ? (
              <AvatarStack people={responsibles} max={3} />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground/70">
                <UserRound className="size-3.5" aria-hidden />
              </span>
            )}
          </PeoplePicker>
        </Cell>

        <Cell>
          <PeoplePicker
            label="Involucrados"
            team={board.team}
            selected={task.involvedIds}
            currentUserId={board.currentUserId}
            onCommit={(ids) => board.setPeople(task, 'involved', ids)}
            triggerLabel={
              involved.length > 0
                ? `Involucrados: ${involved.map((person) => person.name).join(', ')}. Cambiar`
                : 'Sin involucrados. Sumar'
            }
            triggerClassName="flex h-full w-full items-center justify-center gap-1 px-1.5 hover:bg-accent/50"
          >
            {involved.length > 0 ? (
              <>
                {involved.slice(0, involved.length > 2 ? 1 : 2).map((person) => (
                  <PersonChip key={person.id} person={person} className="max-w-[5.5rem]" />
                ))}
                {involved.length > 2 ? (
                  <span className="text-xs font-semibold text-muted-foreground">
                    +{involved.length - 1}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground/60" aria-hidden>
                —
              </span>
            )}
          </PeoplePicker>
        </Cell>

        <Cell className="p-0.5">
          <StatusPicker
            status={task.status}
            onChange={(status) => board.changeStatus(task, status)}
          />
        </Cell>

        <Cell>
          <DuePicker
            value={task.dueDate}
            today={board.today}
            status={task.status}
            onChange={(date) => board.setDue(task, date)}
          />
        </Cell>

        <Cell className="hidden @6xl:flex">
          <NotesCell task={task} />
        </Cell>

        <Cell>
          <CountButton
            icon="files"
            count={task.filesCount}
            label={`${task.filesCount} ${task.filesCount === 1 ? 'archivo' : 'archivos'} de «${task.title}»`}
            onClick={() => board.openTask(task.id, 'files')}
          />
        </Cell>
      </div>

      {/* ── Celular: dos renglones ─────────────────────────────── */}
      <div className="relative flex items-start gap-3 py-2.5 pl-4 pr-3 @3xl:hidden">
        <button
          type="button"
          onClick={() => board.openTask(task.id)}
          className="absolute inset-0 z-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Abrir «${task.title}»`}
        />
        <div className="pointer-events-none relative min-w-0 flex-1">
          <p
            className={cn(
              'line-clamp-2 text-[15px] font-medium leading-snug text-foreground',
              done && 'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
          >
            {task.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            {responsibles.length + involved.length > 0 ? (
              <AvatarStack
                // Quien es responsable e involucrado a la vez va una sola vez.
                people={[...responsibles, ...involved].filter(
                  (person, index, all) =>
                    all.findIndex((other) => other.id === person.id) === index,
                )}
                max={4}
                size="xs"
              />
            ) : null}
            {/* Sin fecha no se dice nada (en una lista, «Sin vencimiento» en cada tarjeta es ruido):
                se pone desde el panel. */}
            {task.dueDate ? (
              <span className="pointer-events-auto relative z-10">
                <DuePicker
                  value={task.dueDate}
                  today={board.today}
                  status={task.status}
                  variant="compact"
                  onChange={(date) => board.setDue(task, date)}
                />
              </span>
            ) : null}
            {task.updatesCount > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <MessageCircle className="size-3.5" aria-hidden />
                {task.updatesCount}
              </span>
            ) : null}
            {task.filesCount > 0 ? (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="size-3.5" aria-hidden />
                {task.filesCount}
              </span>
            ) : null}
            {done ? (
              <span className={cn('font-semibold', GROUP_TEXT[group.color])}>{group.name}</span>
            ) : null}
          </div>
        </div>
        <span className="relative z-10">
          <StatusPicker
            status={task.status}
            variant="pill"
            onChange={(status) => board.changeStatus(task, status)}
          />
        </span>
      </div>
    </div>
  )
})

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-stretch justify-center border-l border-border/60',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** El globito de las actualizaciones y el clip de los archivos, con su número. */
function CountButton({
  icon,
  count,
  label,
  onClick,
}: {
  icon: 'updates' | 'files'
  count: number
  label: string
  onClick: () => void
}) {
  const Icon = icon === 'updates' ? MessageCircle : Paperclip
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative flex h-full w-full items-center justify-center outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        count > 0 ? 'text-foreground/80' : 'text-muted-foreground/40 hover:text-muted-foreground',
      )}
    >
      <Icon className="size-[18px]" aria-hidden strokeWidth={1.75} />
      {count > 0 ? (
        <span
          className={cn(
            'absolute bottom-1.5 right-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4',
            icon === 'updates'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground',
          )}
          aria-hidden
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

/** El título se escribe ahí mismo, como en Monday: clic, escribís, Enter. */
function InlineTitle({ task, done }: { task: BoardTask; done: boolean }) {
  const board = useBoard()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function save() {
    setEditing(false)
    const next = draft.trim()
    if (next.length > 0 && next !== task.title) board.rename(task, next)
    else setDraft(task.title)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={160}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(task.title)
            setEditing(false)
          }
        }}
        aria-label="Nombre de la tarea"
        className="h-8 min-w-0 flex-1 rounded-md border border-ring bg-background px-2 text-sm outline-none ring-2 ring-ring/30"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(task.title)
        setEditing(true)
      }}
      title={task.title}
      className={cn(
        'min-w-0 truncate rounded-sm px-1 py-1 text-left text-sm text-foreground outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
        done && 'text-muted-foreground line-through decoration-muted-foreground/50',
      )}
    >
      {task.title}
    </button>
  )
}

/** La columna «Notas»: una línea; al tocarla, el texto entero para escribir. */
function NotesCell({ task }: { task: BoardTask }) {
  const board = useBoard()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(task.notes ?? '')
  // Si no se pudo guardar, lo escrito se guarda acá para la próxima vez que se abra.
  const pending = useRef<string | null>(null)

  function onOpenChange(next: boolean) {
    if (next) setDraft(pending.current ?? task.notes ?? '')
    else {
      const clean = draft.trim()
      if ((clean || null) !== (task.notes ?? null)) {
        pending.current = draft
        void board.setNotes(task, clean || null).then((ok) => {
          if (ok) pending.current = null
        })
      }
    }
    setOpen(next)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            task.notes ? `Notas: ${task.notes.slice(0, 80)}. Editar` : 'Sin notas. Escribir'
          }
          className="flex h-full w-full min-w-0 items-center px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {task.notes ? (
            <span className="truncate">{task.notes}</span>
          ) : (
            <span className="text-muted-foreground/50" aria-hidden>
              —
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Notas
        </p>
        <textarea
          // biome-ignore lint/a11y/noAutofocus: se abre para escribir.
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              onOpenChange(false)
            }
          }}
          rows={6}
          maxLength={10000}
          placeholder="Lo que hay que saber para hacerla: medidas, textos, referencias…"
          aria-label="Notas de la tarea"
          className="block w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="px-1 pt-1.5 text-[11px] text-muted-foreground">
          Se guarda al cerrar (⌘ Enter).
        </p>
      </PopoverContent>
    </Popover>
  )
}
