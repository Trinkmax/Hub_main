import type { CSSProperties, ReactNode } from 'react'
import { eventInk } from '@/lib/salon/event-ink'
import { formatShortDate } from '@/lib/ticketing/dates'
import type { PublicFunction } from '@/lib/ticketing/types'
import { cn } from '@/lib/utils'
import { occupancyPercent, seatsText } from '../_lib/overview'

/**
 * Una función (fecha) con su barrita de lugares: lo vendido se pinta con la
 * tinta del formato y lo libre queda gris. La barrita es decorativa: el texto
 * de abajo («Quedan 32 de 40», «Agotado») dice lo mismo para el lector.
 */
export function FunctionChip({ fn, className }: { fn: PublicFunction; className?: string }) {
  const soldOut = fn.state === 'sold_out'
  return (
    <div
      className={cn(
        'w-[8.75rem] rounded-lg border px-2.5 py-2',
        soldOut ? 'border-destructive/30 bg-destructive/5' : 'border-border/70 bg-background/60',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{formatShortDate(fn.date)}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{fn.time}</span>
      </div>
      <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', soldOut ? 'bg-destructive' : 'bg-(--ev)')}
          style={{ width: `${occupancyPercent(fn)}%` }}
        />
      </div>
      {soldOut ? (
        <span className="mt-1.5 inline-flex rounded-full bg-destructive px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-destructive-foreground">
          Agotado
        </span>
      ) : (
        <div
          className={cn(
            'mt-1 text-[11px] leading-tight tabular-nums',
            fn.state === 'last' ? 'font-medium text-warning-text' : 'text-muted-foreground',
          )}
        >
          {seatsText(fn)}
        </div>
      )}
    </div>
  )
}

/**
 * Las funciones de una película en fila (se parten solas en el celular). Con
 * `limit`, las primeras y «y N más».
 */
export function FunctionsStrip({
  functions,
  color,
  limit,
  empty,
  label = 'Funciones a la venta',
}: {
  functions: PublicFunction[]
  /** Hex del formato: la tinta de las barritas. */
  color: string | null
  limit?: number
  empty?: ReactNode
  label?: string
}) {
  if (functions.length === 0) return empty ?? null
  const ink = eventInk(color)
  const shown = limit ? functions.slice(0, limit) : functions
  const rest = functions.length - shown.length
  return (
    <ul
      aria-label={label}
      style={ink ? ({ '--ev-l': ink.light, '--ev-d': ink.dark } as CSSProperties) : undefined}
      className="ev-ink flex flex-wrap gap-2"
    >
      {shown.map((fn) => (
        <li key={fn.eventId}>
          <FunctionChip fn={fn} />
        </li>
      ))}
      {rest > 0 ? (
        <li className="self-center px-1 text-xs text-muted-foreground">
          y {rest} {rest === 1 ? 'fecha más' : 'fechas más'}
        </li>
      ) : null}
    </ul>
  )
}
