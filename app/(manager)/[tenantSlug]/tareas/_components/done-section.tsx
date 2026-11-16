'use client'

import { ChevronRight, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import type { BoardGroup, BoardTask } from '@/lib/marketing/board'
import { cn } from '@/lib/utils'
import { TaskRow } from './task-row'

const PAGE = 25

/**
 * «Terminadas»: el grupo de Monday al que se manda lo hecho para que no ensucie
 * el tablero. Va solo (al marcar Terminado) y arranca cerrado. Si a una se le
 * cambia el estado desde acá, vuelve a su grupo.
 */
export function DoneSection({
  tasks,
  total,
  groupsById,
  open,
  onToggle,
  bump,
}: {
  tasks: BoardTask[]
  /** Todas las terminadas del bar (la lista trae las últimas 300). */
  total: number
  groupsById: ReadonlyMap<string, BoardGroup>
  open: boolean
  onToggle: () => void
  /** Cambia cada vez que algo se termina: el contador da un saltito. */
  bump: number
}) {
  const [shown, setShown] = useState(PAGE)
  const fallback = groupsById.values().next().value as BoardGroup | undefined
  const visible = tasks.slice(0, shown)

  return (
    <section aria-labelledby="group-done" className="mb-6">
      <div
        className={cn(
          'relative border border-border/70 bg-background',
          open ? 'rounded-t-lg' : 'rounded-lg',
        )}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-(--task-done)" />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-1.5 rounded-lg pl-3 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-(--task-done) transition-transform duration-200',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <h2
            id="group-done"
            className="text-[15px] font-semibold tracking-tight text-(--task-done)"
          >
            Terminadas
          </h2>
          <span
            key={bump}
            className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground motion-safe:animate-[task-count-bump_420ms_ease-out]"
          >
            {total} {total === 1 ? 'tarea' : 'tareas'}
          </span>
          <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            <CircleCheck className="size-3.5 text-(--task-done)" aria-hidden />
            Lo que se termina viene solo acá
          </span>
        </button>
      </div>

      {open ? (
        <div className="overflow-hidden rounded-b-lg border-x border-b border-border/70">
          {visible.length === 0 ? (
            <p className="bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Todavía no hay nada terminado con este filtro.
            </p>
          ) : (
            visible.map((task) => {
              const group = groupsById.get(task.groupId) ?? fallback
              if (!group) return null
              return <TaskRow key={task.id} task={task} group={group} done />
            })
          )}
          {tasks.length > shown ? (
            <button
              type="button"
              onClick={() => setShown((value) => value + PAGE)}
              className="w-full bg-card/60 py-2.5 text-sm font-medium text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              Mostrar {Math.min(PAGE, tasks.length - shown)} más
            </button>
          ) : total > tasks.length && tasks.length > 0 ? (
            <p className="bg-card/60 py-2.5 text-center text-xs text-muted-foreground">
              Se muestran las últimas {tasks.length}.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
