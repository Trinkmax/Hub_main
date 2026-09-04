/**
 * Los HITOS del día: lo que no es una mesa más.
 *
 * El moco que lo motivó, con nombre y fecha: el lunes 21/09 el HUB tiene "Pizza
 * libre" y adentro entró un cumple de 15 que, de casualidad, también come pizza
 * libre. Como la reserva colgaba del evento, la agenda del día mostraba "Pizza
 * libre" y el cumple quedaba como una fila más abajo — sin torta a la vista.
 * Y la torta la hace el bar.
 *
 * La corrección que pidió el dueño: "debería ser cumpleaños y eventos como si
 * fueran lo mismo, no el cumpleaños dentro del evento". Ojo: eso es una
 * corrección de LECTURA, no de datos. La reserva sigue colgada del evento
 * (consume su cupo y liquida su comisión); lo que cambia es que el cumple sube
 * al mismo renglón que el evento en vez de esconderse adentro.
 *
 * Módulo puro: lo usan igual el RSC de /reservas y el diálogo del calendario.
 */

import type {
  CakeOptionSummary,
  ReservationWithJoins,
  SalonReservationStatus,
  ZoneCapacityLabels,
} from './types'
import { ZONE_LABELS } from './types'

/** Lo mínimo de un evento programado para pintarlo como hito. */
export type HighlightEventInput = {
  id: string
  event_date: string
  starts_at_local: string
  capacity: number
  name_override: string | null
  template: { name: string; color_hex: string } | null
}

export type EventHighlight = {
  kind: 'event'
  /** Clave estable para React. */
  key: string
  id: string
  /** 'HH:MM' */
  time: string
  title: string
  colorHex: string
  used: number
  capacity: number
}

export type CelebrationHighlight = {
  kind: 'birthday' | 'special'
  key: string
  id: string
  time: string
  /** El nombre de quien reservó. Es el título: "Lourdes Roldan". */
  title: string
  guests: number
  /** "Planta Alta" — la zona real, aunque venga a un evento. */
  zoneLabel: string
  /** El evento al que viene, si viene a uno. Es el dato que se perdía. */
  eventName: string | null
  eventColorHex: string | null
  cakeCount: number
  cake: CakeOptionSummary | null
  champagneCount: number
  status: SalonReservationStatus
}

export type DayHighlight = EventHighlight | CelebrationHighlight

/** Un cumpleaños o una reserva especial merece subir al renglón de los hitos. */
export function isCelebration(r: Pick<ReservationWithJoins, 'kind'>): boolean {
  return r.kind === 'birthday' || r.kind === 'special'
}

/**
 * Mezcla eventos programados y celebraciones en una sola lista ordenada por
 * hora — que es exactamente cómo pasa la noche.
 *
 * Las canceladas y las que no vinieron quedan afuera: un hito es algo que hay
 * que preparar, y esas ya no hay que prepararlas.
 */
export function buildDayHighlights(opts: {
  events: HighlightEventInput[]
  reservations: ReservationWithJoins[]
  /** Cubiertos ya vendidos por evento (`event:<uuid>` del RPC de capacidad). */
  usedByEvent?: Map<string, number>
  zoneLabels?: ZoneCapacityLabels
}): DayHighlight[] {
  const zoneLabels = opts.zoneLabels ?? ZONE_LABELS

  const events: DayHighlight[] = opts.events.map((e) => ({
    kind: 'event',
    key: `event:${e.id}`,
    id: e.id,
    time: e.starts_at_local.slice(0, 5),
    title: e.name_override ?? e.template?.name ?? 'Evento',
    colorHex: e.template?.color_hex ?? 'var(--primary)',
    used: opts.usedByEvent?.get(e.id) ?? 0,
    capacity: e.capacity,
  }))

  const celebrations: DayHighlight[] = opts.reservations
    .filter((r) => isCelebration(r) && r.status !== 'cancelled' && r.status !== 'no_show')
    .map((r) => ({
      kind: r.kind === 'birthday' ? 'birthday' : 'special',
      key: `res:${r.id}`,
      id: r.id,
      time: r.reservation_time_local.slice(0, 5),
      title: r.guest_name,
      guests: r.actual_guests ?? r.estimated_guests,
      // La zona REAL, no "Evento": si el cumple se sienta en Planta Alta hay que
      // ir a armar Planta Alta, venga al evento que venga.
      zoneLabel:
        r.zone === 'event_floating'
          ? (r.scheduled_event?.template?.name ?? 'Evento')
          : zoneLabels[r.zone],
      eventName: r.scheduled_event?.template?.name ?? null,
      eventColorHex: r.scheduled_event?.template?.color_hex ?? null,
      cakeCount: r.cake_count,
      cake: r.cake_option ?? null,
      champagneCount: r.champagne_count,
      status: r.status,
    }))

  return [...events, ...celebrations].sort((a, b) => {
    if (a.time !== b.time) return a.time.localeCompare(b.time)
    // A igual hora el evento va primero: es el marco, la celebración pasa adentro.
    if (a.kind === 'event' && b.kind !== 'event') return -1
    if (b.kind === 'event' && a.kind !== 'event') return 1
    return a.title.localeCompare(b.title, 'es-AR')
  })
}

/** `event:<uuid>` → cubiertos usados. Sale de los buckets del RPC de capacidad. */
export function usedByEventMap(
  buckets: ReadonlyArray<{ bucket: string; used: number }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of buckets) {
    if (b.bucket.startsWith('event:')) map.set(b.bucket.slice('event:'.length), b.used)
  }
  return map
}
