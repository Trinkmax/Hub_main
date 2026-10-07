'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { SegmentChip } from '@/components/reservations/segment-meter'
import { Button } from '@/components/ui/button'
import { addDays } from '@/lib/dates/civil'
import { capitalizeFirst, formatDayMonth, weekdayName } from '@/lib/dates/format'
import type { SegmentLoad } from '@/lib/salon/segments'
import { segmentAriaLabel } from '@/lib/salon/segments-copy'
import { CommitDatePicker } from './commit-date-picker'

/** `'2026-09-10'` → `'Jueves 10/09'`. A mano, sin `Intl` (hidratación). */
function formatDayLong(day: string): string {
  return `${capitalizeFirst(weekdayName(day))} ${formatDayMonth(day)}`
}

/**
 * El día que se está viendo (flechas, fecha, Hoy) y cómo viene cada servicio.
 *
 * El contador es POR SERVICIO: un chip por almuerzo, merienda y cena con
 * actividad, cada uno con su gente contra SU cupo y el mismo semáforo que el
 * calendario ("Cena 46/120"). El viejo "Cubiertos 171/130" sumaba el día entero
 * contra PA + PB y pintaba de rojo un jueves sin sobrecupo; el dueño pidió que
 * no vuelva (22/09/2026). Los números llegan resueltos desde el server.
 *
 * Kit HUB: flechas de ícono, la fecha con el `DatePicker` (se tipea «15/9» o se
 * elige en el calendario; antes era el `type="date"` del navegador) y «Hoy»
 * solo cuando no se está en hoy.
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día anterior"
          disabled={pending}
          onClick={() => goTo(addDays(day, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <p aria-live="polite" className="min-w-36 text-center type-subtitle tabular-nums">
          {formatDayLong(day)}
          {isToday ? <span className="font-normal text-muted-foreground"> · hoy</span> : null}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Día siguiente"
          disabled={pending}
          onClick={() => goTo(addDays(day, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {/* `key`: al cambiar de día por las flechas, el campo arranca limpio
            con la fecha nueva (sin arrastrar un texto a medio tipear). */}
        <CommitDatePicker
          key={day}
          defaultValue={day}
          size="sm"
          aria-label="Ir a una fecha"
          today={today}
          disabled={pending}
          onCommit={(iso) => {
            if (iso && iso !== day) goTo(iso)
          }}
          className="w-36"
        />
        {!isToday ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => goTo(today)}>
            Hoy
          </Button>
        ) : null}
      </div>

      {segments.length > 0 ? (
        // En el celu envuelve a su propia fila; en la compu se va a la
        // derecha. El color nunca es la única señal: el chip dice el número y
        // el title/sr-only da la causa ("te pasaste por 13…").
        <ul
          aria-label="Cómo viene cada servicio"
          className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end"
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
