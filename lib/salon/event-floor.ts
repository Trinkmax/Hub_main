/**
 * La planta dentro de un evento: "¿Dónde se sientan?" al reservar en Pizza
 * libre, Ratatuille, etc.
 *
 * El dueño pidió (22/09/2026) poder elegir, si hace falta, Planta Alta o
 * Planta Baja al reservar DENTRO de un evento. En datos es `zone = planta_*`
 * CON `scheduled_event_id`; sin elegir queda la zona flotante
 * (`event_floating`), como hasta ahora. El cupo por servicio no cambia: la
 * reserva cuenta en el evento por su `scheduled_event_id`, no por la zona.
 *
 * Por eso la regla de este módulo es una sola: "de evento" lo dice el id,
 * NUNCA la zona. Antes el alta decidía "tiene evento" con
 * `zone === 'event_floating'` y un efecto borraba el evento apenas la zona era
 * una planta: elegir la planta dentro del evento era imposible.
 *
 * Puro (sin supabase ni react): lo usan el alta, la edición rápida, el
 * operativo y la planilla, y se testea sin DB.
 */

import { type BranchRef, branchShortLabel } from '@/lib/branches/types'
import type { FloorZone } from './segments'
import { type SalonZone, ZONE_LABELS } from './types'

/**
 * Una planta de verdad (la zona flotante no es un lugar físico). El tipo vive
 * en segments.ts (el cupo por planta lo usa); se re-exporta para que el alta
 * no tenga que importar el motor del cupo solo por un tipo.
 */
export type { FloorZone }

/**
 * Reserva de evento sin planta elegida. Es el término del dueño: el mismo del
 * filtro de planta del calendario y del filtro de zona de la lista.
 */
export const UNPLACED_LABEL = 'Sin ubicar'

/** Una reserva de una sucursal sin plantas (el Cerro): se sienta en el salón, sin planta. */
export const NO_FLOOR_LABEL = 'Salón'

/**
 * La planta sola, para las pantallas que ya muestran el evento en otro lado
 * (la columna Zona de la planilla tiene al lado la columna Evento) o que
 * cuentan gente por planta (el pulso del operativo). Para decir dónde se
 * sienta una reserva en una sola etiqueta está `placeLabel`.
 *
 * `null` = una sucursal sin plantas: «Salón».
 */
export function floorLabel(zone: SalonZone | null): string {
  if (zone === null) return NO_FLOOR_LABEL
  return zone === 'event_floating' ? UNPLACED_LABEL : (ZONE_LABELS[zone] ?? NO_FLOOR_LABEL)
}

/** La pregunta del alta, debajo de las tarjetas, cuando hay un evento elegido. */
export const EVENT_FLOOR_QUESTION = '¿Dónde se sientan?'

export type ZoneChoice = { zone: SalonZone; label: string }

/**
 * Las respuestas a "¿Dónde se sientan?" de una reserva de evento, en el orden
 * en que se muestran. "Sin definir" primero y por default: la planta es
 * opcional ("si lo requiere", dijo el dueño) y la mayoría de las reservas de
 * evento se siguen cargando sin ella.
 */
export const EVENT_FLOOR_OPTIONS: ReadonlyArray<ZoneChoice> = [
  { zone: 'event_floating', label: 'Sin definir' },
  { zone: 'planta_alta', label: ZONE_LABELS.planta_alta },
  { zone: 'planta_baja', label: ZONE_LABELS.planta_baja },
]

const FLOOR_OPTIONS: ReadonlyArray<ZoneChoice> = [
  { zone: 'planta_alta', label: ZONE_LABELS.planta_alta },
  { zone: 'planta_baja', label: ZONE_LABELS.planta_baja },
]

export type PlaceValues = {
  /** `null` en una sucursal sin plantas. */
  zone: SalonZone | null
  scheduled_event_id?: string | null
}

/** ¿Es una reserva de evento? Lo dice el id; la zona solo dice dónde se sienta. */
export function isEventReservation(v: Pick<PlaceValues, 'scheduled_event_id'>): boolean {
  return Boolean(v.scheduled_event_id)
}

/**
 * Qué zonas ofrece el selector de la edición rápida. Con evento, las tres
 * respuestas (cambiar la planta no saca la reserva del evento); sin evento,
 * las dos plantas de siempre. Meter o sacar una reserva de un evento sigue
 * siendo cosa de la edición completa.
 */
export function zoneChoicesFor(
  v: Pick<PlaceValues, 'scheduled_event_id'>,
): ReadonlyArray<ZoneChoice> {
  return isEventReservation(v) ? EVENT_FLOOR_OPTIONS : FLOOR_OPTIONS
}

export type PlaceSelection = {
  /** Tarjeta de planta suelta activa (reserva normal), o null si hay evento (o no hay plantas). */
  floorTile: FloorZone | null
  /** Evento elegido, tenga o no planta. */
  eventId: string | null
  /** Respuesta a "¿Dónde se sientan?" (solo con evento). */
  eventFloor: SalonZone | null
}

/**
 * Qué se ve activo en "Dónde se sienta" del alta.
 *
 * - Las tarjetas Planta Alta / Planta Baja son la reserva NORMAL: se ven
 *   activas solo sin evento. Una reserva de Pizza libre en Planta Alta no es
 *   "Planta Alta suelta": se ve la tarjeta del evento y "Planta Alta" abajo.
 * - La tarjeta del evento se ve activa si el id coincide, con o sin planta.
 *
 * Una zona flotante sin evento no debería existir (el schema la rechaza); si
 * llega, no se ve ninguna tarjeta activa y el error del schema lo dice.
 */
export function placeSelection(v: PlaceValues): PlaceSelection {
  const eventId = v.scheduled_event_id || null
  if (eventId) return { floorTile: null, eventId, eventFloor: v.zone }
  return {
    floorTile: v.zone === 'event_floating' ? null : v.zone,
    eventId: null,
    eventFloor: null,
  }
}

/**
 * La planta con la que queda la reserva al cambiar de sucursal en el alta: sin plantas, ninguna; con plantas, la que
 * tenía si era una planta, o la de una reserva de evento («Sin definir») o Planta Alta (el default de siempre).
 */
export function zoneForBranch(v: PlaceValues, hasFloors: boolean): SalonZone | null {
  if (!hasFloors) return null
  if (v.zone) return v.zone
  return v.scheduled_event_id ? 'event_floating' : 'planta_alta'
}

/**
 * Tocar la tarjeta de una planta suelta: reserva normal, sin evento. Limpia el
 * evento acá, en el toque del usuario, y no en un efecto: el efecto era el que
 * borraba el evento de una reserva de evento con planta.
 */
export function pickFloorTile(zone: FloorZone): {
  zone: FloorZone
  scheduled_event_id: undefined
} {
  return { zone, scheduled_event_id: undefined }
}

/**
 * Tocar la tarjeta de un evento.
 *
 * - Si ya era ESE evento, la planta elegida se queda (volver a tocar la
 *   tarjeta no borra "Planta Alta").
 * - Si venía sin evento o de otro evento, arranca en "Sin definir": la planta
 *   con la que arranca el alta (Planta Alta, el default de una reserva normal)
 *   no es una decisión sobre dónde se sienta la gente del evento.
 */
export function pickEventTile(
  current: PlaceValues,
  eventId: string,
  /** Sin plantas (una sucursal como el Cerro) la reserva de evento tampoco lleva planta. */
  hasFloors = true,
): { zone: SalonZone | null; scheduled_event_id: string } {
  if (!hasFloors) return { zone: null, scheduled_event_id: eventId }
  const sameEvent = current.scheduled_event_id === eventId
  return {
    zone: sameEvent ? (current.zone ?? 'event_floating') : 'event_floating',
    scheduled_event_id: eventId,
  }
}

/**
 * "Planta Alta 44 · Planta Baja 26 · Sin ubicar 22": la gente de un servicio
 * por planta. Las dos plantas siempre (que abajo haya 0 también sirve para
 * sentar); "Sin ubicar" solo si hay alguien. La gente de un evento con planta
 * elegida ya cuenta en su planta: por eso el tercer grupo ya no es "En
 * eventos" (se leía como el total de los eventos, y no lo es).
 */
export function zoneBreakdown(byZone: Record<SalonZone, number>): string {
  const zones: SalonZone[] = ['planta_alta', 'planta_baja']
  if ((byZone.event_floating ?? 0) > 0) zones.push('event_floating')
  return zones.map((z) => `${floorLabel(z)} ${byZone[z] ?? 0}`).join(' · ')
}

/**
 * «En la cena: …» del operativo, según dónde se mira:
 * - una sucursal con plantas: las plantas (aunque estén en 0) y «Sin ubicar» (`zoneBreakdown`);
 * - una sin plantas (el Cerro): «Salón» y «Sin ubicar»: nombrar plantas que no tiene confunde;
 * - «Todas»: cada sucursal, porque las plantas de una mezcladas con el salón de otra no dicen nada.
 */
export function placeBreakdown(
  load: { people: number; byZone: Record<SalonZone, number>; byBranch?: Record<string, number> },
  where: {
    hasFloors: boolean
    branches?: ReadonlyArray<Pick<BranchRef, 'id' | 'name' | 'shortName'>>
  },
): string {
  if (where.branches && where.branches.length > 1 && load.byBranch) {
    const byBranch = load.byBranch
    const parts = where.branches.flatMap((branch) => {
      const people = byBranch[branch.id] ?? 0
      return people > 0 ? [`${branchShortLabel(branch)} ${people}`] : []
    })
    if (parts.length > 0) return parts.join(' · ')
  }
  if (where.hasFloors) return zoneBreakdown(load.byZone)
  const unplaced = load.byZone.event_floating ?? 0
  const inFloors = (load.byZone.planta_alta ?? 0) + (load.byZone.planta_baja ?? 0)
  const salon = Math.max(0, load.people - inFloors - unplaced)
  return [
    salon > 0 ? `${NO_FLOOR_LABEL} ${salon}` : null,
    unplaced > 0 ? `${UNPLACED_LABEL} ${unplaced}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}
