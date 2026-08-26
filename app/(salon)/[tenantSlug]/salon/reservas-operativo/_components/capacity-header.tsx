'use client'

import type { ScheduledEventWithTemplate } from '@/lib/salon/queries'
import type { DayCapacityBucket } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * La capacidad del día en una tira de una línea.
 *
 * Antes eran cuatro tarjetas con barra animada, "lugares libres" y un
 * "¡Casi lleno!" parpadeando — 4 filas apiladas en un celular, que empujaban la
 * lista de reservas casi fuera de la pantalla. Al mozo le alcanza con saber si
 * hay lugar; el detalle es del dueño y vive en el manager.
 */
export function CapacityHeader({
  capacity,
  events,
}: {
  capacity: DayCapacityBucket[]
  events: ScheduledEventWithTemplate[]
}) {
  const items: Array<{ key: string; label: string; bucket?: DayCapacityBucket; color?: string }> = [
    {
      key: 'pa',
      label: 'Planta alta',
      bucket: capacity.find((b) => b.bucket === 'zone:planta_alta'),
    },
    {
      key: 'pb',
      label: 'Planta baja',
      bucket: capacity.find((b) => b.bucket === 'zone:planta_baja'),
    },
    ...events.map((e) => ({
      key: e.id,
      label: e.name_override ?? e.template?.name ?? 'Evento',
      bucket: capacity.find((b) => b.bucket === `event:${e.id}`),
      color: e.template?.color_hex ?? undefined,
    })),
  ]

  const visible = items.filter((i) => i.bucket)
  if (visible.length === 0) return null

  return (
    <ul
      aria-label="Ocupación del día"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {visible.map((item) => {
        const b = item.bucket as DayCapacityBucket
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
