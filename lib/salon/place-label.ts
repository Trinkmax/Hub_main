/**
 * Dónde se sienta una reserva, en palabras: la planta, el evento, o los dos.
 *
 * Una reserva de evento puede ir a la zona flotante ("Pizza libre", todavía
 * sin planta) o a una planta concreta ("Pizza libre · Planta Alta"): el dueño
 * pidió poder elegir la planta al reservar dentro de un evento (22/09/2026),
 * y ya había datos así (el 21/09, 29 personas de Pizza libre en Planta Alta).
 * Antes cada pantalla armaba su propia versión y la mayoría mostraba solo el
 * evento, escondiendo la planta. Una sola función para que todas digan lo
 * mismo. Puro: sin supabase ni react.
 */

import { type SalonZone, ZONE_LABELS } from './types'

export type PlaceInput = {
  zone: SalonZone
  scheduled_event_id: string | null
}

/**
 * - con evento y sin planta → "Pizza libre"
 * - con evento y planta     → "Pizza libre · Planta Alta"
 * - sin evento              → "Planta Baja"
 *
 * `eventName` null con `scheduled_event_id` puesto (el join no vino) cae en
 * "Evento". Una zona flotante sin evento no debería existir (el schema la
 * rechaza), pero si aparece se muestra como "Evento" y no rompe.
 */
export function placeLabel(r: PlaceInput, eventName: string | null): string {
  const hasEvent = r.scheduled_event_id !== null
  const name = eventName?.trim() || 'Evento'
  if (r.zone === 'event_floating') return name
  const zone = ZONE_LABELS[r.zone]
  return hasEvent ? `${name} · ${zone}` : zone
}

/** El nombre del evento tal como viene en el join de `RESERVATION_JOIN_SELECT`. */
export function joinedEventName(r: {
  scheduled_event?: { template?: { name: string } | null } | null
}): string | null {
  return r.scheduled_event?.template?.name ?? null
}
