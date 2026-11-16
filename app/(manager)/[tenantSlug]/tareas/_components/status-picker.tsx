'use client'

import { Check } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  STATUS_HINTS,
  STATUS_LABELS,
  STATUS_SHORT,
  STATUS_SOLID,
  TASK_STATUSES,
  type TaskStatus,
} from '@/lib/marketing/constants'
import { cn } from '@/lib/utils'

/**
 * El estado de una tarea: la celda sólida de Monday. Al tocarla, los seis
 * colores en columna (teclas 1 a 6). En el celular va como píldora angosta.
 */
export function StatusPicker({
  status,
  onChange,
  variant = 'cell',
  disabled = false,
}: {
  status: TaskStatus
  onChange: (status: TaskStatus) => void
  /** `cell`: llena la celda del tablero. `pill`: la del celular. `field`: la del panel. */
  variant?: 'cell' | 'pill' | 'field'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  function pick(next: TaskStatus) {
    setOpen(false)
    if (next !== status) onChange(next)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Estado: ${STATUS_LABELS[status]}. Cambiar estado`}
          title={STATUS_LABELS[status]}
          className={cn(
            'relative inline-flex select-none items-center justify-center font-semibold outline-none transition-[filter,box-shadow] duration-150',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'enabled:hover:brightness-[1.04] disabled:cursor-default',
            // La esquina doblada de Monday al pasar el mouse: «esto se toca».
            'after:pointer-events-none after:absolute after:right-0 after:top-0 after:size-2.5 after:bg-background/55 after:opacity-0 after:transition-opacity after:[clip-path:polygon(0_0,100%_0,100%_100%)] enabled:hover:after:opacity-100',
            variant === 'cell' && 'h-full w-full px-2 text-[12.5px] leading-tight',
            variant === 'pill' && 'h-7 shrink-0 rounded-full px-3 text-xs',
            variant === 'field' && 'h-9 w-full rounded-lg px-3 text-sm',
            STATUS_SOLID[status],
          )}
        >
          <span className="truncate">
            {variant === 'pill' ? STATUS_SHORT[status] : STATUS_LABELS[status]}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 p-1.5"
        align="center"
        onKeyDown={(event) => {
          const index = Number(event.key) - 1
          const next = TASK_STATUSES[index]
          if (next) {
            event.preventDefault()
            pick(next)
          }
        }}
      >
        <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0">
          <legend className="sr-only">Estados</legend>
          {TASK_STATUSES.map((option, index) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === status}
              onClick={() => pick(option)}
              className={cn(
                'flex h-9 items-center justify-between gap-2 rounded-md px-3 text-sm font-semibold outline-none transition-[filter]',
                'hover:brightness-[1.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                STATUS_SOLID[option],
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {option === status ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                <span className="truncate">{STATUS_LABELS[option]}</span>
              </span>
              <kbd className="font-sans text-[11px] font-medium opacity-70" aria-hidden>
                {index + 1}
              </kbd>
            </button>
          ))}
        </fieldset>
        <p className="px-1.5 pb-0.5 pt-2 text-[11px] leading-snug text-muted-foreground">
          {STATUS_HINTS[status]}
        </p>
      </PopoverContent>
    </Popover>
  )
}
