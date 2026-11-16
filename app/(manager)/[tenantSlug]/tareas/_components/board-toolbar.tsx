'use client'

import { CircleAlert, ListChecks, Plus, Search, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { normalizeText, type TeamMember } from '@/lib/marketing/board'
import type { TaskView } from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'
import { NewTaskPopover } from './new-task-popover'
import { PersonAvatar } from './person-avatar'

/**
 * La única barra del tablero: el resumen («12 abiertas · 3 vencidas», el número
 * filtra), «Mis tareas» (lo que pidió Nacho Badra: «filtrar todo lo que me
 * corresponde a mí»), las demás personas, el buscador, Tablero / Rutina y
 * «Nueva tarea».
 */
export function BoardToolbar({
  view,
  onView,
  counts,
  routineProgress,
  team,
  openByPerson,
  currentUserId,
  person,
  onPerson,
  onlyOverdue,
  onOnlyOverdue,
  query,
  onQuery,
  onNewRoutine,
  canEditRoutine,
}: {
  view: TaskView
  onView: (view: TaskView) => void
  counts: { open: number; overdue: number; done: number }
  routineProgress: { done: number; total: number }
  team: TeamMember[]
  openByPerson: ReadonlyMap<string, number>
  currentUserId: string
  person: string | null
  onPerson: (personId: string | null) => void
  onlyOverdue: boolean
  onOnlyOverdue: (value: boolean) => void
  query: string
  onQuery: (value: string) => void
  onNewRoutine: () => void
  canEditRoutine: boolean
}) {
  const me = team.find((member) => member.id === currentUserId)
  const mine = person === currentUserId
  const other = person && !mine ? team.find((member) => member.id === person) : undefined
  const isBoard = view === 'tablero'

  return (
    <div className="flex flex-col gap-3 pb-4 pt-1 @min-[50rem]:flex-row @min-[50rem]:items-center @min-[50rem]:gap-4">
      <div className="flex min-w-0 items-end justify-between gap-3 @min-[50rem]:shrink-0 @min-[50rem]:justify-start">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">
            Tareas
          </h1>
          <p className="mt-0.5 whitespace-nowrap text-sm text-muted-foreground" aria-live="polite">
            {isBoard ? (
              <>
                <span className="tabular-nums">
                  {counts.open} {counts.open === 1 ? 'abierta' : 'abiertas'}
                </span>
                {counts.overdue > 0 ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => onOnlyOverdue(!onlyOverdue)}
                      aria-pressed={onlyOverdue}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm font-semibold text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
                        onlyOverdue && 'underline',
                      )}
                    >
                      <CircleAlert className="size-3.5" aria-hidden />
                      <span className="tabular-nums">
                        {counts.overdue} {counts.overdue === 1 ? 'vencida' : 'vencidas'}
                      </span>
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <span className="tabular-nums">
                {routineProgress.total === 0
                  ? 'Lo que se repite todas las semanas'
                  : `${routineProgress.done} de ${routineProgress.total} esta semana`}
              </span>
            )}
          </p>
        </div>
        <div className="@min-[50rem]:hidden">
          {isBoard ? (
            <NewTaskPopover compact />
          ) : canEditRoutine ? (
            <Button size="sm" onClick={onNewRoutine}>
              <Plus className="size-4" aria-hidden />
              Nueva
            </Button>
          ) : null}
        </div>
      </div>

      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 @min-[50rem]:mx-0 @min-[50rem]:ml-auto @min-[50rem]:overflow-visible @min-[50rem]:px-0">
        {isBoard ? (
          <>
            {me ? (
              <button
                type="button"
                onClick={() => onPerson(mine ? null : currentUserId)}
                aria-pressed={mine}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  mine
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-accent',
                )}
              >
                <PersonAvatar person={me} size="md" />
                Mis tareas
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    mine ? 'bg-primary-foreground/20' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {openByPerson.get(currentUserId) ?? 0}
                </span>
              </button>
            ) : null}

            <PersonFilter
              team={team}
              openByPerson={openByPerson}
              currentUserId={currentUserId}
              selected={other ?? null}
              onPerson={onPerson}
            />

            <SearchBox value={query} onChange={onQuery} />
          </>
        ) : null}

        <ViewSwitch view={view} onView={onView} routineProgress={routineProgress} />

        <div className="hidden @min-[50rem]:block">
          {isBoard ? (
            <NewTaskPopover />
          ) : canEditRoutine ? (
            <Button onClick={onNewRoutine}>
              <Plus className="size-4" aria-hidden />
              Nueva rutina
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Tablero / Rutina de la semana (el «Orgánico» de antes), con el avance de la semana. */
function ViewSwitch({
  view,
  onView,
  routineProgress,
}: {
  view: TaskView
  onView: (view: TaskView) => void
  routineProgress: { done: number; total: number }
}) {
  return (
    <fieldset className="m-0 inline-flex h-9 min-w-0 shrink-0 items-center rounded-full border border-border bg-secondary/50 p-0.5">
      <legend className="sr-only">Vista</legend>
      {(
        [
          { value: 'tablero', label: 'Tablero' },
          { value: 'rutina', label: 'Rutina' },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={view === option.value}
          onClick={() => onView(option.value)}
          className={cn(
            'inline-flex h-full items-center gap-1.5 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            view === option.value
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.value === 'rutina' ? <ListChecks className="size-3.5" aria-hidden /> : null}
          {option.label}
          {option.value === 'rutina' && routineProgress.total > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {routineProgress.done}/{routineProgress.total}
            </span>
          ) : null}
        </button>
      ))}
    </fieldset>
  )
}

/** El buscador: chico hasta que se usa. */
function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative shrink-0">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('')
        }}
        placeholder="Buscar…"
        aria-label="Buscar tareas"
        className="h-9 w-32 rounded-full border border-input bg-background pl-9 pr-8 text-sm outline-none transition-[width] duration-200 focus:w-48 focus-visible:ring-2 focus-visible:ring-ring @5xl:w-40 @5xl:focus:w-56"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/** Las tareas de otra persona del equipo (las suyas como responsable o involucrada). */
function PersonFilter({
  team,
  openByPerson,
  currentUserId,
  selected,
  onPerson,
}: {
  team: TeamMember[]
  openByPerson: ReadonlyMap<string, number>
  currentUserId: string
  selected: TeamMember | null
  onPerson: (personId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Primero quien tiene más abiertas: es a quien más se busca.
  const ordered = useMemo(
    () =>
      team
        .filter((member) => member.id !== currentUserId)
        .sort(
          (a, b) =>
            (openByPerson.get(b.id) ?? 0) - (openByPerson.get(a.id) ?? 0) ||
            a.name.localeCompare(b.name, 'es'),
        ),
    [team, openByPerson, currentUserId],
  )
  const needle = normalizeText(query.trim())
  const visible = needle
    ? ordered.filter((member) => normalizeText(member.name).includes(needle))
    : ordered

  if (selected) {
    return (
      <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-primary bg-primary pl-1 pr-1 text-sm font-medium text-primary-foreground">
        <PersonAvatar person={selected} size="md" />
        <span className="max-w-32 truncate">{selected.name}</span>
        <button
          type="button"
          onClick={() => onPerson(null)}
          aria-label={`Sacar el filtro de ${selected.name}`}
          className="flex size-7 items-center justify-center rounded-full outline-none hover:bg-primary-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </span>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ver las tareas de otra persona"
          title="Ver las tareas de otra persona"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border bg-background px-2.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring @5xl:px-3"
        >
          <Users className="size-4 text-muted-foreground" aria-hidden />
          <span className="hidden @5xl:inline">Persona</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="border-b border-border/70 p-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: se abre para buscar a alguien.
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar a alguien…"
            aria-label="Buscar persona"
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">
              Nadie con ese nombre
            </li>
          ) : (
            visible.map((member) => (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onPerson(member.id)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <PersonAvatar person={member} size="md" />
                  <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {openByPerson.get(member.id) ?? 0}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
