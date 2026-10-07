'use client'

import { useState } from 'react'
import { formatARS } from '@/lib/commissions/calculate'
import { formatDayLabel } from '@/lib/salon/date-presets'
import type { DepositDay } from '@/lib/salon/deposits'
import { cn } from '@/lib/utils'

/**
 * Barras apiladas de señas por día, hechas con divs.
 *
 * Sin recharts a propósito: son dos segmentos apilados sobre un eje de días
 * que ya viene denso desde el agregador, y el valor exacto se lee en la línea
 * de arriba al pasar el mouse. Recharts obligaría a un contenedor de altura
 * fija y a un tooltip flotante para mostrar menos.
 *
 * Escala LINEAL a propósito: el día de $499.000 tiene que verse cinco veces más
 * alto que el de $100.000, porque eso es lo que pasó. Lo que evita que el resto
 * "parezca cero" es la línea punteada de la mediana, no una escala logarítmica
 * que le mentiría al ojo.
 */

const MONTH_FMT = new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' })

function monthTick(iso: string): string {
  return MONTH_FMT.format(new Date(`${iso}T00:00:00Z`)).replace('.', '')
}

/**
 * Qué se escribe abajo de cada barra. Con un mes a la vista, el número del día
 * cada tantas barras; con el histórico entero, el mes en su primer día (un
 * "01 08 15 22" repetido seis veces no ubica a nadie).
 */
function ticksFor(days: ReadonlyArray<DepositDay>): Array<string | null> {
  if (days.length > 45) {
    return days.map((d, i) => (i === 0 || d.day.slice(8) === '01' ? monthTick(d.day) : null))
  }
  const every = days.length > 16 ? 5 : 2
  return days.map((d, i) => (i % every === 0 ? d.day.slice(8) : null))
}

export function DepositsBarChart({
  days,
  median,
  avg,
  daysWithDeposit,
}: {
  days: DepositDay[]
  median: number
  avg: number
  daysWithDeposit: number
}) {
  const [active, setActive] = useState<string | null>(null)

  const max = Math.max(1, ...days.map((d) => d.total_cents))
  const pct = (cents: number): number => (cents / max) * 100
  const ticks = ticksFor(days)
  const hovered = active ? days.find((d) => d.day === active) : undefined

  return (
    <figure
      className="m-0"
      onMouseLeave={() => setActive(null)}
      role="img"
      aria-label={`Señas por día: ${daysWithDeposit} días con seña, mediana diaria ${formatARS(median)}.`}
    >
      {/* Una sola línea que cambia de contenido: sin hover cuenta cómo se lee
          el gráfico, con hover dice el día exacto. Alto fijo para que la barra
          no salte cuando el mouse entra. */}
      <figcaption className="flex h-9 items-center text-xs">
        {hovered ? (
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-foreground">{formatDayLabel(hovered.day)}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatARS(hovered.total_cents)}
            </span>
            {hovered.fallen_cents > 0 ? (
              <span className="text-muted-foreground">
                vigente {formatARS(hovered.active_cents)} · caídas{' '}
                <span className="text-destructive">{formatARS(hovered.fallen_cents)}</span>
              </span>
            ) : null}
            <span className="text-muted-foreground">
              {hovered.reservations === 0
                ? 'sin reservas'
                : `${hovered.reservations} ${hovered.reservations === 1 ? 'reserva' : 'reservas'}`}
              {hovered.reservations > 0 && hovered.with_deposit === 0 ? ', ninguna con seña' : ''}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            Mediana diaria{' '}
            <strong className="font-medium text-foreground">{formatARS(median)}</strong> · promedio{' '}
            {formatARS(avg)} · {daysWithDeposit}{' '}
            {daysWithDeposit === 1 ? 'día con seña' : 'días con seña'}
          </span>
        )}
      </figcaption>

      <div className="relative h-44">
        {/* Referencia de mediana: el promedio está corrido por los días de
            cumpleaños, así que la línea del "día típico" es la mediana. */}
        {median > 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${pct(median)}%` }}
          />
        ) : null}

        <div className="absolute inset-0 flex items-end gap-px">
          {days.map((d) => (
            // Botón y no div: la barra reacciona al mouse y al teclado, así que
            // con Tab también se puede recorrer el mes y leer cada día.
            <button
              key={d.day}
              type="button"
              aria-label={`${formatDayLabel(d.day)}: ${formatARS(d.total_cents)}`}
              onMouseEnter={() => setActive(d.day)}
              onFocus={() => setActive(d.day)}
              onBlur={() => setActive(null)}
              className={cn(
                'flex h-full flex-1 cursor-default flex-col justify-end overflow-hidden rounded-t-sm transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active === d.day ? 'bg-secondary/70' : 'hover:bg-secondary/40',
              )}
            >
              {d.fallen_cents > 0 ? (
                <div
                  className="w-full rounded-t-sm bg-destructive/55"
                  style={{ height: `${Math.max(2, pct(d.fallen_cents))}%` }}
                />
              ) : null}
              {d.active_cents > 0 ? (
                <div
                  className={cn('w-full bg-primary', d.fallen_cents === 0 && 'rounded-t-sm')}
                  style={{ height: `${Math.max(2, pct(d.active_cents))}%` }}
                />
              ) : null}
              {/* Hubo reservas y ninguna dejó seña: una rayita, no un hueco.
                  Un día vacío y un día en cero no son la misma información. */}
              {d.total_cents === 0 && d.reservations > 0 ? (
                <div className="h-px w-full bg-border" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex gap-px font-mono text-[10px] tabular-nums text-muted-foreground">
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 overflow-visible whitespace-nowrap text-left">
            {ticks[i]}
          </span>
        ))}
      </div>
    </figure>
  )
}
