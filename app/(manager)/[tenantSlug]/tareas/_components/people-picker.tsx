'use client'

import { Check, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { normalizeText, type TeamMember } from '@/lib/marketing/board'
import { ROLE_LABELS } from '@/lib/tenant/roles'
import { cn } from '@/lib/utils'
import { PersonAvatar } from './person-avatar'

/**
 * Elegir responsables o involucrados. Se marca y desmarca adentro y el cambio se
 * guarda al cerrar (un solo viaje aunque toques cinco nombres). «Vos» arriba de
 * todo; el rol solo aparece si no es dueño (en HUB son 18 socios: decir «Dueño»
 * en cada fila es ruido).
 */
export function PeoplePicker({
  label,
  team,
  selected,
  currentUserId,
  onCommit,
  children,
  triggerClassName,
  triggerLabel,
  disabled = false,
  align = 'center',
}: {
  label: string
  team: ReadonlyArray<TeamMember>
  selected: ReadonlyArray<string>
  currentUserId: string
  onCommit: (userIds: string[]) => void
  children: React.ReactNode
  triggerClassName?: string
  /** Nombre accesible del botón (lo que hay adentro suelen ser iniciales). */
  triggerLabel: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected))
  const [query, setQuery] = useState('')

  const ordered = useMemo(
    () =>
      [...team].sort((a, b) => {
        if (a.id === currentUserId) return -1
        if (b.id === currentUserId) return 1
        return a.name.localeCompare(b.name, 'es')
      }),
    [team, currentUserId],
  )

  // Quien está en la tarea pero ya no en el equipo: aparece arriba, para poder sacarlo.
  const former = selected
    .filter((id) => !team.some((member) => member.id === id))
    .map((id) => ({ id, name: 'Ya no está en el equipo', role: 'owner' as const, inTeam: false }))

  const needle = normalizeText(query.trim())
  const visible = [
    ...(needle ? [] : former),
    ...(needle ? ordered.filter((member) => normalizeText(member.name).includes(needle)) : ordered),
  ]

  function commit(next: Set<string>) {
    const before = new Set(selected)
    const changed = next.size !== before.size || [...next].some((id) => !before.has(id))
    if (changed) onCommit([...next])
  }

  function onOpenChange(next: boolean) {
    if (next) {
      setDraft(new Set(selected))
      setQuery('')
    } else {
      commit(draft)
    }
    setOpen(next)
  }

  function toggle(id: string) {
    setDraft((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={triggerLabel}
          className={cn(
            'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
            triggerClassName,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align={align}>
        <div className="border-b border-border/70 p-2">
          <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              // biome-ignore lint/a11y/noAutofocus: el popover se abre para buscar a alguien.
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const only = visible.length === 1 ? visible[0] : undefined
                  if (only) toggle(only.id)
                }
              }}
              placeholder="Buscar a alguien…"
              aria-label="Buscar persona"
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">
              Nadie con ese nombre
            </li>
          ) : (
            visible.map((member) => {
              const checked = draft.has(member.id)
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggle(member.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none',
                      'hover:bg-accent focus-visible:bg-accent',
                      checked && 'bg-accent/60',
                    )}
                  >
                    <PersonAvatar person={member} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {member.name}
                        {member.id === currentUserId ? (
                          <span className="font-normal text-muted-foreground"> (vos)</span>
                        ) : null}
                      </span>
                      {member.role !== 'owner' ? (
                        <span className="block text-xs text-muted-foreground">
                          {ROLE_LABELS[member.role]}
                        </span>
                      ) : null}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background',
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t border-border/70 p-2">
          <span className="px-1 text-xs text-muted-foreground">
            {draft.size === 0
              ? 'Nadie'
              : `${draft.size} ${draft.size === 1 ? 'persona' : 'personas'}`}
          </span>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Listo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
