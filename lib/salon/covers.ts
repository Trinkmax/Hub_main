import type { DayCapacityBucket } from './types'

/**
 * Cubiertos de un día, con el desglose que el dueño necesita ver.
 *
 * `used` es el TOTAL de gente que se sienta en el bar ese día: las mesas a la
 * carta más las que vinieron por un evento. Antes el contador de /reservas
 * sumaba solo las zonas físicas y dejaba afuera a las reservas de evento
 * (`zone='event_floating'`), así que un día con 30 a la carta + 12 de Sushi
 * Libre mostraba 30 — mientras la misma pantalla en modo "Este mes" mostraba 42.
 *
 * `total` es el tope FÍSICO del salón (PA + PB, con override del día aplicado).
 * Los cubiertos de evento no traen tope propio: ocupan el mismo salón, así que
 * el semáforo (ámbar/rojo) se calcula con el total contra ese tope.
 *
 * El cupo de cada evento es otro control distinto y vive en los buckets
 * `event:<uuid>` (calendario y detalle del evento).
 */
export type DayCovers = {
  /** Cubiertos totales del día: `salon + eventos`. */
  used: number
  /** Tope físico del salón: cap(PA) + cap(PB). */
  total: number
  /** Cubiertos de reservas con zona física (Planta Alta + Planta Baja). */
  salon: number
  /** Cubiertos de reservas atadas a un evento programado. */
  eventos: number
}

/**
 * Resume los buckets del RPC `evaluate_day_capacity` en el contador de cubiertos.
 *
 * Suma los tres buckets `zone:*` — que son una partición completa de las
 * reservas activas del día (cada reserva tiene exactamente una zona), así que
 * no hay doble conteo. Los buckets `event:<uuid>` se ignoran a propósito: una
 * reserva con zona física atada a un evento aparece en los dos ejes, y sumarlos
 * la contaría dos veces.
 */
export function summarizeDayCovers(buckets: DayCapacityBucket[]): DayCovers {
  const at = (key: string) => buckets.find((b) => b.bucket === key)
  const pa = at('zone:planta_alta')
  const pb = at('zone:planta_baja')
  const floating = at('zone:event_floating')

  const salon = (pa?.used ?? 0) + (pb?.used ?? 0)
  const eventos = floating?.used ?? 0

  return {
    used: salon + eventos,
    total: (pa?.capacity ?? 0) + (pb?.capacity ?? 0),
    salon,
    eventos,
  }
}
