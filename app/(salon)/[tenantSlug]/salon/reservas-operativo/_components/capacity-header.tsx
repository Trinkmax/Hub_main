'use client'

import { SegmentChip } from '@/components/reservations/segment-meter'
import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import { type DaySegments, SEGMENT_KEYS, type SegmentKey } from '@/lib/salon/segments'
import type { DayCapacityBucket } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * La capacidad del día en una tira de una línea.
 *
 * Antes eran cuatro tarjetas con barra animada, "lugares libres" y un
 * "¡Casi lleno!" parpadeando — 4 filas apiladas en un celular, que empujaban la
 * lista de reservas casi fuera de la pantalla. Al mozo le alcanza con saber si
 * hay lugar; el detalle es del dueño y vive en el manager.
 *
 * El cupo se lee POR SERVICIO ("Cena 119/120"), con la misma cuenta que el
 * calendario y el operativo. Se fueron el chip "Total" y los de Planta Alta /
 * Planta Baja: sumaban el almuerzo y la cena contra el tope físico del día y
 * decían "171/130" una noche sin sobrecupo. El servicio del reloj va primero y
 * destacado; después, los chips por evento (su propio cupo).
 */
export function CapacityHeader({
  segments,
  focus,
  capacity,
  events,
}: {
  segments: DaySegments
  /** El servicio del reloj (la cena si no es hoy). */
  focus: SegmentKey
  /** Solo para los chips por evento (bucket event:*). */
  capacity: DayCapacityBucket[]
  events: ScheduledEventWithTemplate[]
}) {
  // Solo los servicios con algo: el del reloj adelante, el resto en orden A/M/C.
  const services = [focus, ...SEGMENT_KEYS.filter((k) => k !== focus)]
    .map((k) => segments.segments[k])
    .filter((s) => s.hasActivity)

  const eventItems = events
    .map((e) => ({
      key: e.id,
      label: e.name_override ?? e.template?.name ?? 'Evento',
      bucket: capacity.find((b) => b.bucket === `event:${e.id}`),
      color: e.template?.color_hex ?? undefined,
    }))
    .filter((i): i is typeof i & { bucket: DayCapacityBucket } => i.bucket !== undefined)

  if (services.length === 0 && eventItems.length === 0) return null

  return (
    <ul
      aria-label="Ocupación del día"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {services.map((s) => (
        <li key={s.key} className="flex shrink-0 snap-start">
          <SegmentChip
            segment={s}
            label="short"
            emphasized={s.key === focus}
            // Mismo alto que los chips de evento de al lado.
            className="px-3 py-1.5 text-xs"
          />
        </li>
      ))}
      {eventItems.map((item) => {
        const b = item.bucket
        const over = b.used > b.capacity
        const full = !over && b.capacity > 0 && b.used >= b.capacity * 0.9
        return (
          <li
            key={item.key}
            className={cn(
              'flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5',
              over
                ? 'border-destructive/50 bg-destructive/10'
                : full
                  ? 'border-warning/50 bg-warning/10'
                  : 'border-border/70 bg-card',
            )}
          >
            {item.color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
            ) : null}
            <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
            <span
              className={cn(
                'font-mono text-xs font-semibold tabular-nums',
                over ? 'text-destructive' : 'text-foreground',
              )}
            >
              {b.used}/{b.capacity}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
