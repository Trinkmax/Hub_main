'use client'

import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { GROUP_RAIL, GROUP_TEXT } from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'
import { useBoard } from './board-context'

/**
 * «Nueva tarea»: un cuadro para cargar de corrido sin bajar hasta el grupo.
 * Escribís, Enter, y queda listo para la próxima (arriba de todo del grupo
 * elegido, como el botón de Monday). Pegar una lista carga una por renglón.
 */
export function NewTaskPopover({ compact = false }: { compact?: boolean }) {
  const board = useBoard()
  const [open, setOpen] = useState(false)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [added, setAdded] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const target = board.groups.find((group) => group.id === groupId) ?? board.groups[0]

  function add(titles: string[]) {
    if (!target) return
    for (const title of titles) board.createTask(target.id, title.slice(0, 160), 'top')
    setAdded((count) => count + titles.length)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && board.groups.length === 0) {
          toast.info(
            board.canManage
              ? 'Primero armá un grupo (abajo de todo, «Nuevo grupo»).'
              : 'Primero un socio tiene que armar los grupos del tablero.',
          )
          return
        }
        setOpen(next)
        if (next) {
          setValue('')
          setAdded(0)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size={compact ? 'sm' : 'default'}>
          <Plus className="size-4" aria-hidden />
          {compact ? 'Nueva' : 'Nueva tarea'}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <label htmlFor="new-task-title" className="text-sm font-semibold">
          Nueva tarea
        </label>
        <input
          id="new-task-title"
          ref={inputRef}
          value={value}
          maxLength={160}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const title = value.trim()
              if (!title) return
              add([title])
              setValue('')
            }
          }}
          onPaste={(event) => {
            const lines = event.clipboardData
              .getData('text')
              .split(/\r?\n/)
              .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
              .filter((line) => line.length > 0)
            if (lines.length < 2) return
            event.preventDefault()
            add(lines.slice(0, 30))
          }}
          placeholder="¿Qué hay que hacer?"
          className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          En el grupo
        </p>
        <fieldset className="m-0 mt-1.5 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <legend className="sr-only">Grupo</legend>
          {board.groups.map((group) => {
            const selected = group.id === target?.id
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setGroupId(group.id)
                  inputRef.current?.focus()
                }}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-current bg-accent'
                    : 'border-border bg-background hover:bg-accent/60',
                  GROUP_TEXT[group.color],
                )}
              >
                <span aria-hidden className={cn('size-2 rounded-full', GROUP_RAIL[group.color])} />
                {group.name}
              </button>
            )
          })}
        </fieldset>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {added > 0
            ? `${added} ${added === 1 ? 'agregada' : 'agregadas'} arriba de «${target?.name ?? ''}». Seguí escribiendo o cerrá.`
            : 'Enter para agregar. Pegá una lista para cargar varias de una.'}
        </p>
      </PopoverContent>
    </Popover>
  )
}
