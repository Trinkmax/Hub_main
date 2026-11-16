'use client'

import { CalendarDays, CalendarX2, CircleAlert, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  type DueState,
  dueShortcuts,
  dueState,
  formatDayLong,
  formatDayWithWeekday,
  formatDue,
} from '@/lib/marketing/board'
import type { TaskStatus } from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'

const STATE_TEXT: Record<DueState, string> = {
  none: 'text-muted-foreground',
  done: 'text-muted-foreground line-through decoration-muted-foreground/60',
  overdue: 'font-semibold text-destructive',
  today: 'font-semibold text-(--warning-text)',
  soon: 'font-medium text-foreground',
  later: 'text-foreground/80',
}

/** Cómo se lee el vencimiento en voz alta (el ícono solo no alcanza). */
function spoken(value: string | null, state: DueState, today: string): string {
  if (!value) return 'Sin vencimiento'
  const date = formatDue(value, today)
  if (state === 'overdue') return `Vencida: ${date}`
  if (state === 'done') return `Vencía ${date}, ya terminada`
  return `Vence ${date}`
}

/**
 * El vencimiento: vencida en rojo con «!», hoy en ámbar, terminada en verde y
 * tachada (como Monday). Atajos para lo de siempre (hoy, mañana, el viernes de
 * los eventos, la semana que viene) y el calendario del sistema para el resto.
 */
export function DuePicker({
  value,
  today,
  status,
  onChange,
  variant = 'cell',
  disabled = false,
}: {
  value: string | null
  today: string
  status: TaskStatus
  onChange: (date: string | null) => void
  variant?: 'cell' | 'field' | 'compact'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const state = dueState(value, today, status)

  function pick(date: string | null) {
    setOpen(false)
    if (date !== value) onChange(date)
  }

  const icon =
    state === 'overdue' ? (
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
    ) : state === 'done' ? (
      <CircleCheck className="size-3.5 shrink-0 text-(--task-done)" aria-hidden />
    ) : variant !== 'cell' ? (
      <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    ) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`${spoken(value, state, today)}. Cambiar vencimiento`}
          className={cn(
            'group/due inline-flex min-w-0 items-center gap-1.5 text-[13px] outline-none disabled:cursor-default',
            'focus-visible:ring-2 focus-visible:ring-ring',
            variant === 'cell' && 'h-full w-full justify-center px-2 enabled:hover:bg-accent/50',
            variant === 'field' &&
              'h-9 w-full rounded-lg border border-input bg-background px-3 enabled:hover:bg-accent/40',
            variant === 'compact' && 'h-6 rounded-md px-1.5 enabled:hover:bg-accent/60',
            STATE_TEXT[state],
          )}
        >
          {icon}
          {value ? (
            <span className="truncate">{formatDue(value, today)}</span>
          ) : variant === 'cell' ? (
            <span className="text-muted-foreground/60 group-hover/due:text-muted-foreground">
              <span aria-hidden>—</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin vencimiento</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="center">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Vencimiento
        </p>
        <div className="grid grid-cols-2 gap-1">
          {dueShortcuts(today).map((shortcut) => (
            <button
              key={shortcut.key}
              type="button"
              onClick={() => pick(shortcut.date)}
              aria-pressed={shortcut.date === value}
              className={cn(
                'flex flex-col items-start rounded-md border border-border/70 px-2 py-1.5 text-left outline-none',
                'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                shortcut.date === value && 'border-primary bg-primary/10',
              )}
            >
              <span className="text-sm font-medium">{shortcut.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {formatDayWithWeekday(shortcut.date)}
              </span>
            </button>
          ))}
        </div>
        <label className="mt-2 block px-1 text-xs text-muted-foreground">
          Otra fecha
          <input
            type="date"
            value={value ?? ''}
            min="2020-01-01"
            max="2100-12-31"
            onChange={(event) => {
              if (event.target.value) pick(event.target.value)
            }}
            className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {value ? (
          <div className="mt-2 flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-muted-foreground">{formatDayLong(value)}</span>
            <button
              type="button"
              onClick={() => pick(null)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CalendarX2 className="size-3.5" aria-hidden />
              Sacar fecha
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
