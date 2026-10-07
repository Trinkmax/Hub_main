'use client'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { SegmentChip } from '@/components/reservations/segment-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SegmentLoad } from '@/lib/salon/segments'
import { segmentAriaLabel } from '@/lib/salon/segments-copy'

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

function formatDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(dt)
}

/**
 * El día que se está viendo (flechas, fecha, Hoy) y cómo viene cada servicio.
 *
 * El contador es POR SERVICIO: un chip por almuerzo, merienda y cena con
 * actividad, cada uno con su gente contra SU cupo y el mismo semáforo que el
 * calendario ("Cena 46/120"). El viejo "Cubiertos 171/130" sumaba el día entero
 * contra PA + PB y pintaba de rojo un jueves sin sobrecupo; el dueño pidió que
 * no vuelva (22/09/2026). Los números llegan resueltos desde el server.
 */
export function DayNavigator({
  tenantSlug,
  day,
  today,
  segments,
  dayLabel,
}: {
  tenantSlug: string
  day: string
  today: string
  /** Los servicios del día con actividad, en orden (ver `activeDaySegments`). */
  segments: SegmentLoad[]
  /** 'jue 10/09', para la etiqueta completa de cada chip. */
  dayLabel: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function goTo(nextDay: string) {
    const next = new URLSearchParams(sp?.toString() ?? '')
    next.set('day', nextDay)
    next.delete('from')
    next.delete('to')
    next.delete('page')
    startTransition(() => router.push(`/${tenantSlug}/reservas?${next.toString()}`))
  }

  const isToday = day === today

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 p-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día anterior"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2 px-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="min-w-[150px] text-center text-sm font-medium capitalize tabular-nums">
            {formatDayLong(day)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día siguiente"
          disabled={pending}
          onClick={() => goTo(shiftDay(day, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <Input
        type="date"
        value={day}
        aria-label="Elegir fecha"
        onChange={(e) => {
          if (e.target.value) goTo(e.target.value)
        }}
        className="h-9 w-[150px]"
      />

      {!isToday ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => goTo(today)}>
          Hoy
        </Button>
      ) : null}

      {segments.length > 0 ? (
        // En el celu envuelve a su propia fila; en la compu se va a la
        // derecha. El color nunca es la única señal: el chip dice el número y
        // el title/sr-only da la causa ("te pasaste por 13…").
        <ul
          aria-label="Cómo viene cada servicio"
          className="flex w-full flex-wrap items-center gap-1.5 sm:ml-auto sm:w-auto sm:justify-end"
        >
          {segments.map((s) => (
            <li key={s.key}>
              <SegmentChip segment={s} label="short" ariaLabel={segmentAriaLabel(s, dayLabel)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
