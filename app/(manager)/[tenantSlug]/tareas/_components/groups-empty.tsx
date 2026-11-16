'use client'

import { Check, LayoutList, Plus } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { seedGroups } from '@/lib/marketing/actions'
import {
  GROUP_COLOR_LABELS,
  GROUP_COLORS,
  GROUP_RAIL,
  GROUP_TEXT,
  type GroupColor,
  SUGGESTED_GROUPS,
} from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'
import { useBoard } from './board-context'
import { guard } from './guard'

/**
 * Sin grupos todavía: en vez de una pantalla en blanco, los grupos de siempre
 * para tocar y crear de una. Quien no es dueño ve qué falta y a quién pedírselo.
 */
export function GroupsEmpty() {
  const board = useBoard()
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(SUGGESTED_GROUPS.slice(0, 3).map((group) => group.name)),
  )
  const [pending, startTransition] = useTransition()

  if (!board.canManage) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <LayoutList className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-serif text-xl font-semibold">Todavía no hay tablero</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Un socio tiene que armar los grupos (Eventos, Impresiones…). Después vas a ver acá tus
          tareas.
        </p>
      </div>
    )
  }

  function create() {
    const groups = SUGGESTED_GROUPS.filter((group) => picked.has(group.name))
    if (groups.length === 0) return
    startTransition(() =>
      guard(async () => {
        const result = await seedGroups(board.tenantSlug, [...groups])
        if (result.ok) toast.success('Listo, ya tenés el tablero. Cargá la primera tarea.')
        else toast.error(result.message)
      }),
    )
  }

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <LayoutList className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 font-serif text-2xl font-semibold tracking-tight">Armá el tablero</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Las tareas se ordenan en grupos, como en Monday: uno por tema. Elegí con cuáles arrancás;
        después se cambian, se suman o se borran.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTED_GROUPS.map((group) => {
          const on = picked.has(group.name)
          return (
            <button
              key={group.name}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (next.has(group.name)) next.delete(group.name)
                  else next.add(group.name)
                  return next
                })
              }
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? 'border-current bg-accent'
                  : 'border-border bg-background opacity-70 hover:opacity-100',
                GROUP_TEXT[group.color],
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 items-center justify-center rounded-full',
                  on ? GROUP_RAIL[group.color] : 'border border-current',
                )}
              >
                {on ? <Check className="size-3 text-white" /> : null}
              </span>
              {group.name}
            </button>
          )
        })}
      </div>
      <Button className="mt-5" onClick={create} disabled={pending || picked.size === 0}>
        {pending ? 'Creando…' : `Crear ${picked.size} ${picked.size === 1 ? 'grupo' : 'grupos'}`}
      </Button>
    </div>
  )
}

/** «+ Nuevo grupo» al final del tablero: nombre y color, Enter. */
export function NewGroupInline() {
  const board = useBoard()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const used = new Set(board.groups.map((group) => group.color))
  const [color, setColor] = useState<GroupColor>(
    () => GROUP_COLORS.find((option) => !used.has(option)) ?? 'forest',
  )

  if (!board.canManage) return null

  function submit() {
    const clean = name.trim()
    if (!clean) return
    board.createGroup(clean.slice(0, 60), color)
    setName('')
    setOpen(false)
    const nextUsed = new Set([...used, color])
    setColor(GROUP_COLORS.find((option) => !nextUsed.has(option)) ?? 'forest')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-sm font-medium text-muted-foreground outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" aria-hidden />
        Nuevo grupo
      </button>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: se abre para escribir el nombre.
        autoFocus
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        placeholder="Nombre del grupo"
        aria-label="Nombre del grupo"
        className={cn(
          'h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring',
          GROUP_TEXT[color],
        )}
      />
      <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
        <legend className="sr-only">Color</legend>
        {GROUP_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === color}
            aria-label={GROUP_COLOR_LABELS[option]}
            onClick={() => setColor(option)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-ring',
              GROUP_RAIL[option],
            )}
          >
            {option === color ? <Check className="size-3.5 text-white" aria-hidden /> : null}
          </button>
        ))}
      </fieldset>
      <Button type="submit" size="sm" disabled={!name.trim()}>
        Crear
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </form>
  )
}
