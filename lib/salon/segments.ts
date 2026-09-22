/**
 * Cupo POR SERVICIO: almuerzo, merienda y cena.
 *
 * POR QUÉ: el jueves 10/09 el calendario decía "171 de 130" en rojo y no había
 * sobrecupo: eran 19 al mediodía, 33 en la merienda y 119 en la cena, todo
 * sumado contra PA + PB. El salón se llena por servicio, no por día, así que
 * cada servicio se mide contra SU cupo y el número del día desaparece.
 *
 * Este archivo es la ÚNICA cuenta. La usan el mes, la vista del día, el alta y
 * la edición de reservas, la vista rápida, el operativo y el salón del staff:
 * si una pantalla mostrara un número distinto para lo mismo, el dueño deja de
 * creerle a todas. Por eso es TS puro (sin supabase, next ni react): corre
 * igual en un RSC, en un componente cliente sobre filas que llegan por
 * Realtime y en Vitest. La capa server solo junta filas y llama a esto; no hay
 * RPC SQL que duplique la regla.
 */

import type { MealType, ReservationKind, SalonReservationStatus, SalonZone } from './types'

export const SEGMENT_KEYS = ['lunch', 'tea_time', 'dinner'] as const
export type SegmentKey = (typeof SEGMENT_KEYS)[number]
export type IsoDow = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Cortes en minutos desde 00:00 (R2). Salen de los datos: con la merienda
 * arrancando en (14:30, 15:00] y la cena en (18:30, 19:00] hay 0
 * contradicciones sobre las 504 reservas del HUB. Antes de las 05:00 es la
 * cena de esa noche (la gente que llega pasada la medianoche no es un
 * "almuerzo de madrugada").
 */
export const SEGMENT_CUTS = {
  nightRolloverMin: 5 * 60,
  teaStartMin: 15 * 60,
  dinnerStartMin: 19 * 60,
} as const

/** Hora que precarga el alta cuando el bar no configuró la suya. */
export const DEFAULT_SEGMENT_TIMES: Readonly<Record<SegmentKey, string>> = {
  lunch: '13:00',
  tea_time: '15:30',
  dinner: '21:00',
}

/**
 * Id del evento sintético de la proyección: una reserva especial que pide un
 * formato que ese día no está programado. Al guardar, el server lo programa
 * (ensure_scheduled_event_for_template); acá se simula para que el medidor y la
 * confirmación ya descuenten su cupo.
 */
export const VIRTUAL_EVENT_ID = 'virtual:requested-template'

/** Id de la candidata nueva (sin id todavía) dentro de la proyección. */
const CANDIDATE_ID = 'candidate:new'

/** Cupo de un formato sin `default_capacity`: el mismo 30 que usa el server. */
const VIRTUAL_EVENT_DEFAULT_CAPACITY = 30

export function isSegmentKey(value: unknown): value is SegmentKey {
  return typeof value === 'string' && (SEGMENT_KEYS as ReadonlyArray<string>).includes(value)
}

/** 'HH:MM' | 'HH:MM:SS' → minutos desde 00:00, o null si no se puede leer. */
function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** A qué servicio pertenece un minuto del día. Misma regla para horas y reloj. */
function segmentOfMinutes(minutes: number): SegmentKey {
  if (minutes < SEGMENT_CUTS.nightRolloverMin) return 'dinner'
  if (minutes < SEGMENT_CUTS.teaStartMin) return 'lunch'
  if (minutes < SEGMENT_CUTS.dinnerStartMin) return 'tea_time'
  return 'dinner'
}

/**
 * Servicio de una hora 'HH:MM' o 'HH:MM:SS'. Una hora ilegible cuenta como
 * cena: es el servicio con más reservas y el que el dueño mira primero, así
 * que un dato roto se nota ahí en lugar de esconderse en un servicio vacío.
 */
export function segmentOfTime(time: string): SegmentKey {
  const minutes = minutesOf(time)
  return minutes === null ? 'dinner' : segmentOfMinutes(minutes)
}

/**
 * Servicio de un evento: SIEMPRE por su hora de inicio (R2). Se ignora
 * `scheduled_events.meal_type` a propósito: hay 25 eventos con 'hub_event' y
 * Ramen figura como 'lunch' a las 21:00, así que el enum miente y la hora no.
 */
export function segmentOfEventStart(startsAtLocal: string): SegmentKey {
  return segmentOfTime(startsAtLocal)
}

/**
 * El desayuno cuenta como almuerzo (hubo 2 en toda la historia) y el
 * 'hub_event' legacy como cena: ninguno de los dos es un servicio con cupo
 * propio.
 */
const MEAL_TYPE_SEGMENT: Readonly<Record<MealType, SegmentKey>> = {
  breakfast: 'lunch',
  lunch: 'lunch',
  tea_time: 'tea_time',
  dinner: 'dinner',
  hub_event: 'dinner',
}

/**
 * Servicio de una reserva SIN evento (R3). Un valor que no esté en el enum
 * (fila vieja o cast desde la DB) cae en la cena, igual que una hora ilegible.
 */
export function segmentOfMealType(meal: MealType): SegmentKey {
  return MEAL_TYPE_SEGMENT[meal] ?? 'dinner'
}

/**
 * Lo que se guarda en `meal_type` cuando el form o la vista rápida derivan el
 * servicio. Nunca 'hub_event': no tiene tarifa de comisión y dejaba la reserva
 * en 0.
 */
export function mealTypeForSegment(
  segment: SegmentKey,
): Extract<MealType, 'lunch' | 'tea_time' | 'dinner'> {
  return segment
}

/** Servicio en curso según el reloj del bar: a las 02:00 todavía es la cena. */
export function currentSegment(nowMinutes: number): SegmentKey {
  return segmentOfMinutes(nowMinutes)
}

/**
 * Día de la semana ISO (1 = lunes … 7 = domingo) de un 'YYYY-MM-DD'.
 *
 * Con `Date.UTC` + `getUTCDay` a propósito: `new Date('2026-09-21')` es la
 * medianoche UTC, que en Córdoba todavía es el domingo 20 a las 21:00. Con la
 * TZ del server el lunes pasaba a domingo y se aplicaba el cupo equivocado.
 */
export function isoDowOf(date: string): IsoDow {
  const [y, m, d] = date.split('-').map(Number)
  const utcDay = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return (utcDay === 0 ? 7 : utcDay) as IsoDow
}

// ──────────────────────────────────────────────────────────
// Filas de entrada
// ──────────────────────────────────────────────────────────

export type SegmentReservationInput = {
  id: string
  reservation_date: string
  meal_type: MealType
  reservation_time_local: string
  scheduled_event_id: string | null
  zone: SalonZone
  status: SalonReservationStatus
  estimated_guests: number
  actual_guests: number | null
  kind: ReservationKind
  cake_count: number
}

/** ScheduledEventWithTemplate y HighlightEventInput la satisfacen estructuralmente. */
export type SegmentEventInput = {
  id: string
  event_date: string
  starts_at_local: string
  capacity: number
  name_override: string | null
  template: { name: string; color_hex: string } | null
}

/**
 * Nombre visible de un evento. Normaliza los espacios de más que hay en los
 * datos reales ("Tapeo  y Malbec"), igual que `eventTitle` del reporte.
 */
export function eventDisplayName(e: Pick<SegmentEventInput, 'name_override' | 'template'>): string {
  const raw = e.name_override ?? e.template?.name ?? 'Evento'
  return raw.replace(/\s+/g, ' ').trim() || 'Evento'
}

/** id del evento → servicio por su hora de inicio. */
export function eventSegmentMap(
  events: ReadonlyArray<Pick<SegmentEventInput, 'id' | 'starts_at_local'>>,
): Map<string, SegmentKey> {
  const map = new Map<string, SegmentKey>()
  for (const e of events) map.set(e.id, segmentOfEventStart(e.starts_at_local))
  return map
}

/**
 * Servicio de una reserva (R3): si está colgada de un evento del día, el del
 * evento; si no, su `meal_type`. Si el evento no vino en la lista (otro día o
 * borrado), se cae al `meal_type` en vez de inventar un servicio.
 */
export function segmentOfReservation(
  r: Pick<SegmentReservationInput, 'scheduled_event_id' | 'meal_type'>,
  eventSegments: ReadonlyMap<string, SegmentKey>,
): SegmentKey {
  if (r.scheduled_event_id) {
    const fromEvent = eventSegments.get(r.scheduled_event_id)
    if (fromEvent) return fromEvent
  }
  return segmentOfMealType(r.meal_type)
}

function emptyBySegment<T>(make: () => T): Record<SegmentKey, T> {
  return { lunch: make(), tea_time: make(), dinner: make() }
}

/**
 * Reparte filas por servicio. Siempre devuelve las 3 claves (la vista del día
 * dibuja un servicio vacío con su "Nueva reserva") y conserva el orden de
 * entrada, que ya viene por hora.
 */
export function groupReservationsBySegment<
  T extends Pick<SegmentReservationInput, 'scheduled_event_id' | 'meal_type'>,
>(
  rows: ReadonlyArray<T>,
  events: ReadonlyArray<Pick<SegmentEventInput, 'id' | 'starts_at_local'>>,
): Record<SegmentKey, T[]> {
  const map = eventSegmentMap(events)
  const out = emptyBySegment<T[]>(() => [])
  for (const row of rows) out[segmentOfReservation(row, map)].push(row)
  return out
}

// ──────────────────────────────────────────────────────────
// Plantas: el filtro del calendario (decisión del dueño, 22/09/2026)
// ──────────────────────────────────────────────────────────

/** Las plantas físicas. `event_floating` no es un lugar: es "todavía sin planta". */
export type FloorZone = Exclude<SalonZone, 'event_floating'>

/**
 * Cupo de cada planta, de `tenants.settings.salon_capacities` (el «Cupo
 * general por planta» de Configuración: en el HUB, PA 60 y PB 70). 0 = el bar
 * no lo cargó: esa planta se muestra sin tope, nunca "cerrada".
 */
export type ZoneCaps = Record<FloorZone, number>

export const NO_ZONE_CAPS: Readonly<ZoneCaps> = { planta_alta: 0, planta_baja: 0 }

/**
 * Valores de `?planta=` en la URL del calendario. Cortos y en castellano para
 * que el link se pueda leer y dictar; «sin» es la zona flotante (reservas de
 * evento que todavía no tienen planta). Sin param = «Todo».
 */
export const ZONE_FILTERS = ['alta', 'baja', 'sin'] as const
export type ZoneFilter = (typeof ZONE_FILTERS)[number]

const ZONE_OF_FILTER: Readonly<Record<ZoneFilter, SalonZone>> = {
  alta: 'planta_alta',
  baja: 'planta_baja',
  sin: 'event_floating',
}

export function zoneOfFilter(filter: ZoneFilter): SalonZone {
  return ZONE_OF_FILTER[filter]
}

export function isZoneFilter(value: unknown): value is ZoneFilter {
  return typeof value === 'string' && (ZONE_FILTERS as ReadonlyArray<string>).includes(value)
}

/**
 * Tope de una zona, o null = sin tope. La zona flotante nunca tiene: no es un
 * lugar del salón. Un cupo de planta 0, negativo o ilegible también es sin
 * tope (el bar no lo cargó), a diferencia del cupo 0 de un servicio, que es
 * "cerrado": una planta cerrada se maneja con el cupo del servicio.
 */
export function zoneCapacity(zone: SalonZone, caps: Readonly<ZoneCaps>): number | null {
  if (zone === 'event_floating') return null
  const cap = caps[zone]
  return Number.isFinite(cap) && cap > 0 ? cap : null
}

// ──────────────────────────────────────────────────────────
// Config: cupo por servicio × día de la semana, especiales por fecha
// ──────────────────────────────────────────────────────────

export type SegmentWeeklyCapRow = {
  segment: SegmentKey
  iso_dow: IsoDow
  capacity: number
  warn_at: number | null
}
export type SegmentOverrideRow = {
  segment: SegmentKey
  override_date: string
  capacity: number
  warn_at: number | null
  reason: string | null
}
export type SegmentSettingRow = {
  segment: SegmentKey
  default_time: string
  warn_note: string | null
}
export type SegmentConfig = {
  weekly: SegmentWeeklyCapRow[]
  overrides: SegmentOverrideRow[]
  settings: SegmentSettingRow[]
  /** cap(PA) + cap(PB) de tenants.settings.salon_capacities (sin overrides por zona). */
  fallbackTotal: number
  /**
   * Los mismos dos números por separado: el cupo de cada planta para el
   * filtro de planta del calendario. Opcional porque el editor de cupos
   * especiales arma una config parcial solo para resolver el cupo del día;
   * sin él, cada planta es "sin tope".
   */
  zoneCaps?: ZoneCaps
}
export type SegmentCapSource = 'override' | 'weekly' | 'fallback' | 'none'
export type ResolvedSegmentCap = {
  capacity: number | null // null = sin tope; 0 = cerrado
  warnAt: number | null
  warnNote: string | null
  source: SegmentCapSource
  overrideReason: string | null
}
export type DaySegmentCaps = Record<SegmentKey, ResolvedSegmentCap>
export type SegmentSettingsResolved = Record<
  SegmentKey,
  { defaultTime: string; warnNote: string | null }
>

/** '13:00:00' (lo que devuelve una columna `time`) → '13:00'; basura → null. */
function toHhmm(time: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(time)
  return match ? `${match[1]}:${match[2]}` : null
}

function cleanText(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

/**
 * Hora sugerida y nota del aviso por servicio. Sin fila (o con una hora
 * ilegible) valen 13:00 / 15:30 / 21:00 y sin nota: un bar recién creado ya
 * reserva con horas razonables.
 */
export function resolveSegmentSettings(
  rows: ReadonlyArray<SegmentSettingRow>,
): SegmentSettingsResolved {
  const out = {} as SegmentSettingsResolved
  for (const key of SEGMENT_KEYS) {
    const row = rows.find((r) => r.segment === key)
    out[key] = {
      defaultTime: (row && toHhmm(row.default_time)) ?? DEFAULT_SEGMENT_TIMES[key],
      warnNote: cleanText(row?.warn_note),
    }
  }
  return out
}

/**
 * Cupo de cada servicio en una fecha (R7). Gana la primera regla que aplica:
 *
 * a) Cupo especial por fecha. NO hereda el aviso semanal: si se abrió la
 *    terraza, "avisame en 50" deja de tener sentido.
 * b) Fila semanal (servicio, día de la semana).
 * c) Cupo general = PA + PB del salón. Así un bar que todavía no cargó nada
 *    (el HUB antes del rollout) ve 130 por servicio en vez de un tope inventado.
 * d) Sin cupo general tampoco: `capacity: null` = sin tope (no se pinta
 *    semáforo). Un 0 explícito, en cambio, es "cerrado ese día".
 */
export function resolveDaySegmentCaps(date: string, config: SegmentConfig): DaySegmentCaps {
  const isoDow = isoDowOf(date)
  const settings = resolveSegmentSettings(config.settings)
  const out = {} as DaySegmentCaps

  for (const key of SEGMENT_KEYS) {
    const warnNote = settings[key].warnNote
    const override = config.overrides.find((o) => o.segment === key && o.override_date === date)
    if (override) {
      out[key] = {
        capacity: override.capacity,
        warnAt: override.warn_at,
        warnNote,
        source: 'override',
        overrideReason: cleanText(override.reason),
      }
      continue
    }
    const weekly = config.weekly.find((w) => w.segment === key && w.iso_dow === isoDow)
    if (weekly) {
      out[key] = {
        capacity: weekly.capacity,
        warnAt: weekly.warn_at,
        warnNote,
        source: 'weekly',
        overrideReason: null,
      }
      continue
    }
    out[key] =
      config.fallbackTotal > 0
        ? {
            capacity: config.fallbackTotal,
            warnAt: null,
            warnNote,
            source: 'fallback',
            overrideReason: null,
          }
        : { capacity: null, warnAt: null, warnNote, source: 'none', overrideReason: null }
  }
  return out
}

/**
 * A cuánto conviene subir el cupo de un servicio en un día puntual: el cupo
 * semanal más alto de ese servicio, si supera al actual. En el HUB el almuerzo
 * de un jueves (70) sugiere 120, que es lo que entra con la terraza abierta.
 */
export function suggestedCapacityRaise(
  config: Pick<SegmentConfig, 'weekly'>,
  segment: SegmentKey,
  current: number | null,
): number | null {
  if (current === null) return null
  let best: number | null = null
  for (const row of config.weekly) {
    if (row.segment !== segment) continue
    if (best === null || row.capacity > best) best = row.capacity
  }
  return best !== null && best > current ? best : null
}

/** Hay al menos una fila semanal: si no, el mes avisa que usa el cupo general. */
export function isSegmentConfigured(config: Pick<SegmentConfig, 'weekly'>): boolean {
  return config.weekly.length > 0
}

// ──────────────────────────────────────────────────────────
// Resultado del día
// ──────────────────────────────────────────────────────────

export type SegmentStatus = 'ok' | 'warn' | 'over'
export type SegmentCause = 'none' | 'people_over' | 'normals_over' | 'warn_threshold' | 'near_full'
export type SegmentEventLoad = {
  id: string
  name: string
  colorHex: string | null
  startsAt: string // 'HH:MM'
  capacity: number
  used: number
  over: boolean // used > capacity
  reservations: number
  birthdays: number
  cakes: number
  /**
   * Personas del evento por zona real: cuántos de Pizza libre van en Planta
   * Alta, cuántos en Planta Baja y cuántos todavía sin planta. La tarjeta del
   * evento lo muestra cuando el día está filtrado por planta.
   */
  byZone: Record<SalonZone, number>
}

/** Lo que hay en una zona dentro de un servicio (solo reservas activas). */
export type ZoneTally = {
  people: number
  reservations: number
  birthdays: number
  cakes: number
}

export type SegmentLoad = {
  key: SegmentKey
  capacity: number | null
  capSource: SegmentCapSource
  capReason: string | null
  warnAt: number | null
  warnNote: string | null
  events: SegmentEventLoad[] // por hora de inicio
  eventCapSum: number
  reservedForEvents: number // min(C, eventCapSum); sin tope: eventCapSum
  eventUsed: number
  eventSeats: number // max(reservedForEvents, eventUsed)
  normalUsed: number // reservas SIN scheduled_event_id
  normalCap: number | null // C − reservedForEvents
  people: number // eventUsed + normalUsed ← NÚMERO PRINCIPAL
  occupied: number // eventSeats + normalUsed ← decide el estado
  freeForNormal: number | null // max(0, C − eventSeats − normalUsed)
  status: SegmentStatus
  cause: SegmentCause
  eventExceedsSegment: boolean // C > 0 && eventCapSum > C (cerrado nunca)
  birthdays: { total: number; inEvents: number }
  cakes: { total: number; inEvents: number }
  byZone: Record<SalonZone, number> // = zones[z].people (lo leen el form y el operativo)
  /**
   * Cada zona por separado, con la zona REAL de la reserva: una de Pizza
   * libre sentada en Planta Alta cuenta en Planta Alta (y en el evento). La
   * flotante son las de evento que todavía no tienen planta.
   */
  zones: Record<SalonZone, ZoneTally>
  activeReservations: number
  hasActivity: boolean // people > 0 || events.length > 0
}
export type EventSegmentMismatch = {
  eventId: string
  eventName: string
  startsAt: string // 'HH:MM'
  eventSegment: SegmentKey
  reservationsSegment: SegmentKey
  reservations: number
  people: number
}
export type DaySegments = {
  date: string
  isoDow: IsoDow
  segments: Record<SegmentKey, SegmentLoad> // SIEMPRE los 3
  mismatches: EventSegmentMismatch[]
}
export type DaySegmentsInput = {
  date: string
  reservations: ReadonlyArray<SegmentReservationInput>
  events: ReadonlyArray<SegmentEventInput>
  caps: DaySegmentCaps
}

/** Una reserva cancelada o que no vino no ocupa lugar (mismo criterio que el salón). */
function isActive(r: Pick<SegmentReservationInput, 'status'>): boolean {
  return r.status !== 'cancelled' && r.status !== 'no_show'
}

/** Cubiertos que cuentan (R4): los reales apenas se cargan, si no los estimados. */
function guestsOf(r: Pick<SegmentReservationInput, 'actual_guests' | 'estimated_guests'>): number {
  const n = r.actual_guests ?? r.estimated_guests
  return Number.isFinite(n) ? n : 0
}

type SegmentTally = {
  events: SegmentEventLoad[]
  eventUsed: number
  normalUsed: number
  birthdays: { total: number; inEvents: number }
  cakes: { total: number; inEvents: number }
  byZone: Record<SalonZone, number>
  zones: Record<SalonZone, ZoneTally>
  activeReservations: number
}

function emptyZoneTally(): ZoneTally {
  return { people: 0, reservations: 0, birthdays: 0, cakes: 0 }
}

function emptyTally(): SegmentTally {
  return {
    events: [],
    eventUsed: 0,
    normalUsed: 0,
    birthdays: { total: 0, inEvents: 0 },
    cakes: { total: 0, inEvents: 0 },
    byZone: { planta_alta: 0, planta_baja: 0, event_floating: 0 },
    zones: {
      planta_alta: emptyZoneTally(),
      planta_baja: emptyZoneTally(),
      event_floating: emptyZoneTally(),
    },
    activeReservations: 0,
  }
}

/**
 * Semáforo (R5) y su causa, para el copy.
 *
 * - over: lo ocupado pasa el cupo. `people_over` si ya hay más PERSONAS que
 *   cupo; si no, `normals_over`: las normales pisan lo que apartó un evento.
 * - warn: llegó al aviso propio del servicio, o está al 90 %. El 90 % va en
 *   enteros (occupied × 10 ≥ C × 9) para que 108/120 no dependa de un float.
 * - Cupo 0 = cerrado: rojo si hay alguien, si no ok. Nunca ámbar por el 90 %
 *   de 0 (todo número es ≥ 0 × 0,9).
 */
function statusOf(
  C: number | null,
  warnAt: number | null,
  people: number,
  occupied: number,
): { status: SegmentStatus; cause: SegmentCause } {
  if (C === null) return { status: 'ok', cause: 'none' }
  if (occupied > C) {
    return { status: 'over', cause: people > C ? 'people_over' : 'normals_over' }
  }
  if (C === 0) return { status: 'ok', cause: 'none' }
  if (warnAt !== null && people >= warnAt) return { status: 'warn', cause: 'warn_threshold' }
  if (occupied * 10 >= C * 9) return { status: 'warn', cause: 'near_full' }
  return { status: 'ok', cause: 'none' }
}

function finishSegment(key: SegmentKey, cap: ResolvedSegmentCap, t: SegmentTally): SegmentLoad {
  const C = cap.capacity
  const eventCapSum = t.events.reduce((sum, e) => sum + e.capacity, 0)
  const reservedForEvents = C === null ? eventCapSum : Math.min(C, eventCapSum)
  // Un evento que se pasa de su cupo ocupa lo que realmente vendió; uno que
  // todavía tiene lugar igual se lleva lo apartado (esas mesas no se venden
  // como normales).
  const eventSeats = Math.max(reservedForEvents, t.eventUsed)
  const people = t.eventUsed + t.normalUsed
  const occupied = eventSeats + t.normalUsed
  const { status, cause } = statusOf(C, cap.warnAt, people, occupied)

  return {
    key,
    capacity: C,
    capSource: cap.source,
    capReason: cap.overrideReason,
    warnAt: cap.warnAt,
    warnNote: cap.warnNote,
    events: t.events,
    eventCapSum,
    reservedForEvents,
    eventUsed: t.eventUsed,
    eventSeats,
    normalUsed: t.normalUsed,
    normalCap: C === null ? null : C - reservedForEvents,
    people,
    occupied,
    freeForNormal: C === null ? null : Math.max(0, C - eventSeats - t.normalUsed),
    status,
    cause,
    // Solo informativo: Pizza libre de 140 en una cena de 120 no es un rojo,
    // es un evento que se lleva todo el servicio. Un servicio cerrado (cupo 0,
    // el «cerrado por evento privado» del cupo del día) no tiene nada que el
    // evento se lleve: ya lo dicen «Cerrado» o el rojo, y la nota diría «se
    // lleva toda la cena de 0».
    eventExceedsSegment: C !== null && C > 0 && eventCapSum > C,
    birthdays: t.birthdays,
    cakes: t.cakes,
    byZone: t.byZone,
    zones: t.zones,
    activeReservations: t.activeReservations,
    hasActivity: people > 0 || t.events.length > 0,
  }
}

function compareEvents(a: SegmentEventInput, b: SegmentEventInput): number {
  if (a.starts_at_local !== b.starts_at_local) return a.starts_at_local < b.starts_at_local ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Detector de horas mal cargadas: un evento cuyas reservas atadas caen, por su
 * hora, en OTRO servicio que el evento. Merienda Libre del 03/10 figura a las
 * 21:00 y su reserva es de las 16:30: le resta 33 a la cena y deja la merienda
 * vacía. Solo se avisa; el dato lo corrige el dueño con "Editar evento".
 */
function findMismatches(
  dayEvents: ReadonlyArray<SegmentEventInput>,
  eventSegments: ReadonlyMap<string, SegmentKey>,
  active: ReadonlyArray<SegmentReservationInput>,
): EventSegmentMismatch[] {
  const out: EventSegmentMismatch[] = []
  for (const e of dayEvents) {
    const eventSegment = eventSegments.get(e.id) ?? segmentOfEventStart(e.starts_at_local)
    const counts = emptyBySegment(() => ({ reservations: 0, people: 0 }))
    let reservations = 0
    let people = 0
    for (const r of active) {
      if (r.scheduled_event_id !== e.id) continue
      const bySeg = segmentOfTime(r.reservation_time_local)
      if (bySeg === eventSegment) continue
      const guests = guestsOf(r)
      counts[bySeg].reservations += 1
      counts[bySeg].people += guests
      reservations += 1
      people += guests
    }
    if (reservations === 0) continue
    // El servicio "de las reservas" es el más frecuente; a igual cantidad, el
    // de más gente, y si sigue empatado, el primero del día.
    let reservationsSegment: SegmentKey | null = null
    for (const key of SEGMENT_KEYS) {
      const c = counts[key]
      if (c.reservations === 0) continue
      if (reservationsSegment === null) {
        reservationsSegment = key
        continue
      }
      const best = counts[reservationsSegment]
      if (
        c.reservations > best.reservations ||
        (c.reservations === best.reservations && c.people > best.people)
      ) {
        reservationsSegment = key
      }
    }
    if (reservationsSegment === null) continue
    out.push({
      eventId: e.id,
      eventName: eventDisplayName(e),
      startsAt: e.starts_at_local.slice(0, 5),
      eventSegment,
      reservationsSegment,
      reservations,
      people,
    })
  }
  return out
}

/**
 * La cuenta de un día: SIEMPRE los 3 servicios, cada uno contra su cupo.
 *
 * - Cuentan las reservas de esa fecha que no están canceladas ni "no vino".
 * - Reserva colgada de un evento del día → suma al evento, aunque la zona sea
 *   Planta Alta (el 21/09 hay 29 personas en PA dentro de Pizza libre). Normal
 *   = sin `scheduled_event_id`; la zona dice dónde se sienta, no si es normal.
 * - Cada evento aparta su cupo dentro de su servicio (hasta el cupo del
 *   servicio). Lo apartado y vacío ocupa lugar para el semáforo, pero el
 *   número principal son PERSONAS: con lo ocupado, el 19/09 diría "253 de
 *   120", el mismo número absurdo que motivó el cambio.
 */
export function computeDaySegments(input: DaySegmentsInput): DaySegments {
  const { date, caps } = input
  const dayEvents = input.events.filter((e) => e.event_date === date).sort(compareEvents)
  const eventSegments = eventSegmentMap(dayEvents)
  const tallies = emptyBySegment(emptyTally)

  const loads = new Map<string, SegmentEventLoad>()
  for (const e of dayEvents) {
    const load: SegmentEventLoad = {
      id: e.id,
      name: eventDisplayName(e),
      colorHex: e.template?.color_hex ?? null,
      startsAt: e.starts_at_local.slice(0, 5),
      capacity: e.capacity,
      used: 0,
      over: false,
      reservations: 0,
      birthdays: 0,
      cakes: 0,
      byZone: { planta_alta: 0, planta_baja: 0, event_floating: 0 },
    }
    loads.set(e.id, load)
    tallies[eventSegments.get(e.id) ?? 'dinner'].events.push(load)
  }

  const active = input.reservations.filter((r) => r.reservation_date === date && isActive(r))
  for (const r of active) {
    const guests = guestsOf(r)
    const isBirthday = r.kind === 'birthday'
    const cakes = r.cake_count ?? 0
    const t = tallies[segmentOfReservation(r, eventSegments)]
    const load = r.scheduled_event_id ? loads.get(r.scheduled_event_id) : undefined

    t.activeReservations += 1
    t.byZone[r.zone] = (t.byZone[r.zone] ?? 0) + guests
    if (isBirthday) t.birthdays.total += 1
    t.cakes.total += cakes

    // La zona llega de la DB como texto: una que no está en el enum no suma a
    // ninguna planta (ni rompe la cuenta del servicio, que no depende de ella).
    const zone = t.zones[r.zone] as ZoneTally | undefined
    if (zone) {
      zone.people += guests
      zone.reservations += 1
      if (isBirthday) zone.birthdays += 1
      zone.cakes += cakes
    }

    if (load) {
      t.eventUsed += guests
      load.used += guests
      load.reservations += 1
      load.byZone[r.zone] = (load.byZone[r.zone] ?? 0) + guests
      if (isBirthday) {
        load.birthdays += 1
        t.birthdays.inEvents += 1
      }
      load.cakes += cakes
      t.cakes.inEvents += cakes
    } else {
      t.normalUsed += guests
    }
  }
  for (const load of loads.values()) load.over = load.used > load.capacity

  return {
    date,
    isoDow: isoDowOf(date),
    segments: {
      lunch: finishSegment('lunch', caps.lunch, tallies.lunch),
      tea_time: finishSegment('tea_time', caps.tea_time, tallies.tea_time),
      dinner: finishSegment('dinner', caps.dinner, tallies.dinner),
    },
    mismatches: findMismatches(dayEvents, eventSegments, active),
  }
}

// ──────────────────────────────────────────────────────────
// Mes
// ──────────────────────────────────────────────────────────

export type MonthSegments = {
  ym: string
  days: Record<string, DaySegments> // todas las fechas del mes
  configured: boolean
  fallbackTotal: number
  /** Cupo de cada planta: el denominador del filtro de planta. */
  zoneCaps: ZoneCaps
  settings: SegmentSettingsResolved
}

/** 'YYYY-MM' → todas sus fechas 'YYYY-MM-DD' (28 a 31); basura → []. */
function datesOfMonth(ym: string): string[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!match) return []
  const y = Number(match[1])
  const m = Number(match[2])
  // Día 0 del mes siguiente = último día de este (cubre bisiestos).
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: string[] = []
  for (let d = 1; d <= last; d++) out.push(`${ym}-${String(d).padStart(2, '0')}`)
  return out
}

/**
 * El mes entero, día por día, con la MISMA cuenta que la vista del día. Las
 * filas de otros meses se ignoran (la query pagina por rango y puede traer de
 * más en los bordes).
 */
export function computeMonthSegments(input: {
  ym: string
  reservations: ReadonlyArray<SegmentReservationInput>
  events: ReadonlyArray<SegmentEventInput>
  config: SegmentConfig
}): MonthSegments {
  const dates = datesOfMonth(input.ym)
  const inMonth = new Set(dates)

  const resByDate = new Map<string, SegmentReservationInput[]>()
  for (const r of input.reservations) {
    if (!inMonth.has(r.reservation_date)) continue
    const list = resByDate.get(r.reservation_date)
    if (list) list.push(r)
    else resByDate.set(r.reservation_date, [r])
  }
  const eventsByDate = new Map<string, SegmentEventInput[]>()
  for (const e of input.events) {
    if (!inMonth.has(e.event_date)) continue
    const list = eventsByDate.get(e.event_date)
    if (list) list.push(e)
    else eventsByDate.set(e.event_date, [e])
  }

  const days: Record<string, DaySegments> = {}
  for (const date of dates) {
    days[date] = computeDaySegments({
      date,
      reservations: resByDate.get(date) ?? [],
      events: eventsByDate.get(date) ?? [],
      caps: resolveDaySegmentCaps(date, input.config),
    })
  }

  return {
    ym: input.ym,
    days,
    configured: isSegmentConfigured(input.config),
    fallbackTotal: input.config.fallbackTotal,
    zoneCaps: { ...(input.config.zoneCaps ?? NO_ZONE_CAPS) },
    settings: resolveSegmentSettings(input.config.settings),
  }
}

/** Carga de cada evento del mes por id (la usan los chips de evento de la grilla). */
export function eventLoadsById(
  days: Readonly<Record<string, DaySegments>>,
): Record<string, SegmentEventLoad> {
  const out: Record<string, SegmentEventLoad> = {}
  for (const day of Object.values(days)) {
    for (const key of SEGMENT_KEYS) {
      for (const load of day.segments[key].events) out[load.id] = load
    }
  }
  return out
}

/**
 * Cumples y tortas del día entero (el badge de festejos de la celda). Con
 * `zone`, solo los de esa zona: con el calendario filtrado por planta, el badge
 * no puede decir 3 tortas cuando la celda de Planta Alta dice 1.
 */
export function dayCelebrations(
  day: DaySegments,
  zone?: SalonZone | null,
): { birthdays: number; cakes: number } {
  let birthdays = 0
  let cakes = 0
  for (const key of SEGMENT_KEYS) {
    const s = day.segments[key]
    if (zone) {
      birthdays += s.zones[zone]?.birthdays ?? 0
      cakes += s.zones[zone]?.cakes ?? 0
    } else {
      birthdays += s.birthdays.total
      cakes += s.cakes.total
    }
  }
  return { birthdays, cakes }
}

// ──────────────────────────────────────────────────────────
// Una zona dentro de un servicio (el filtro de planta del calendario)
// ──────────────────────────────────────────────────────────

export type ZoneLoad = {
  segment: SegmentKey
  zone: SalonZone
  people: number
  capacity: number | null // null = sin tope (zona flotante o planta sin cupo cargado)
  status: SegmentStatus
  reservations: number
  birthdays: number
  cakes: number
  hasActivity: boolean // people > 0
}

/**
 * Cómo viene UNA zona en un servicio, contra el cupo de esa planta: «Cena PA
 * 46/60». Personas de la zona real de cada reserva, también las de evento
 * sentadas en esa planta: es la gente que el mozo de Planta Alta tiene que
 * atender, sea del evento o no.
 *
 * El semáforo es el del servicio reducido a personas: rojo si pasa el cupo,
 * ámbar desde el 90 % (en enteros: people × 10 ≥ cupo × 9, igual que el
 * servicio). No hay apartado de eventos por planta: el evento no dice en qué
 * planta va, así que la planta solo cuenta gente. Sin tope → siempre ok.
 *
 * El cupo del servicio NO cambia por esto: una reserva cuenta en el evento por
 * `scheduled_event_id`, no por zona.
 */
export function zoneLoad(s: SegmentLoad, zone: SalonZone, caps: Readonly<ZoneCaps>): ZoneLoad {
  const tally = s.zones[zone] ?? emptyZoneTally()
  const capacity = zoneCapacity(zone, caps)
  const people = tally.people
  let status: SegmentStatus = 'ok'
  if (capacity !== null) {
    if (people > capacity) status = 'over'
    else if (people * 10 >= capacity * 9) status = 'warn'
  }
  return {
    segment: s.key,
    zone,
    people,
    capacity,
    status,
    reservations: tally.reservations,
    birthdays: tally.birthdays,
    cakes: tally.cakes,
    hasActivity: people > 0,
  }
}

/** ¿Hay alguien en esa zona en algún servicio del día? (la agenda compacta los días vacíos). */
export function dayHasZoneActivity(day: DaySegments, zone: SalonZone): boolean {
  return SEGMENT_KEYS.some((key) => (day.segments[key].zones[zone]?.people ?? 0) > 0)
}

/**
 * Servicio en foco: con reloj (el día es hoy), el que está en curso; sin reloj,
 * la cena, que es el servicio que más se reserva y el que se consulta primero.
 */
export function focusSegment(_day: DaySegments, nowMinutes: number | null): SegmentKey {
  return nowMinutes === null ? 'dinner' : currentSegment(nowMinutes)
}

// ──────────────────────────────────────────────────────────
// Proyección: cómo queda el servicio si se guarda esta reserva
// ──────────────────────────────────────────────────────────

export type DaySegmentsSnapshot = {
  date: string
  caps: DaySegmentCaps
  settings: SegmentSettingsResolved
  reservations: SegmentReservationInput[] // activas, SIN PII
  events: SegmentEventInput[]
}
export type ReservationCandidate = {
  id?: string // edición: reemplaza esa fila
  reservation_date: string
  meal_type: MealType
  reservation_time_local: string
  scheduled_event_id: string | null
  zone: SalonZone
  guests: number // lo que va a contar (actual ?? estimated)
  kind: ReservationKind
  cake_count: number
  virtualEvent?: { name: string; capacity: number; starts_at_local: string } | null
}
export type SegmentProjection = {
  segment: SegmentKey
  before: SegmentLoad
  after: SegmentLoad
  addedPeople: number
  needsConfirm: boolean // after.status === 'over' && after.occupied > before.occupied
  event: SegmentEventLoad | null
}

/**
 * Proyecta una reserva (alta o edición) sobre el día y dice si hay que pedir
 * confirmación (D3). Devuelve null si el snapshot es de otra fecha: quedó
 * viejo y el caller tiene que volver a pedirlo.
 *
 * Se pregunta solo cuando el servicio queda pasado Y esta reserva empeora lo
 * ocupado. Así una edición que no suma (cambiar el comentario de una cena ya
 * pasada) no molesta, y reservar ADENTRO de un evento que todavía tiene lugar
 * apartado tampoco: ese lugar ya estaba descontado.
 */
export function projectReservation(
  snapshot: DaySegmentsSnapshot,
  candidate: ReservationCandidate,
): SegmentProjection | null {
  if (snapshot.date !== candidate.reservation_date) return null
  const date = snapshot.date

  const before = computeDaySegments({
    date,
    reservations: snapshot.reservations,
    events: snapshot.events,
    caps: snapshot.caps,
  })

  const events: SegmentEventInput[] = [...snapshot.events]
  let scheduledEventId = candidate.scheduled_event_id
  if (candidate.virtualEvent) {
    // Mismo evento que va a crear ensure_scheduled_event_for_template al
    // guardar: el cupo del formato (o 30) a la hora de la reserva.
    events.push({
      id: VIRTUAL_EVENT_ID,
      event_date: date,
      starts_at_local: candidate.virtualEvent.starts_at_local,
      capacity: Number.isFinite(candidate.virtualEvent.capacity)
        ? candidate.virtualEvent.capacity
        : VIRTUAL_EVENT_DEFAULT_CAPACITY,
      name_override: candidate.virtualEvent.name,
      template: null,
    })
    scheduledEventId = VIRTUAL_EVENT_ID
  }

  const candidateRow: SegmentReservationInput = {
    id: candidate.id ?? CANDIDATE_ID,
    reservation_date: date,
    meal_type: candidate.meal_type,
    reservation_time_local: candidate.reservation_time_local,
    scheduled_event_id: scheduledEventId,
    zone: candidate.zone,
    status: 'pending',
    estimated_guests: candidate.guests,
    actual_guests: null,
    kind: candidate.kind,
    cake_count: candidate.cake_count,
  }
  const reservations = snapshot.reservations.filter(
    (r) => candidate.id === undefined || r.id !== candidate.id,
  )
  reservations.push(candidateRow)

  const after = computeDaySegments({ date, reservations, events, caps: snapshot.caps })
  const segment = segmentOfReservation(
    candidateRow,
    eventSegmentMap(events.filter((e) => e.event_date === date)),
  )
  const beforeLoad = before.segments[segment]
  const afterLoad = after.segments[segment]
  const event = scheduledEventId
    ? (afterLoad.events.find((e) => e.id === scheduledEventId) ?? null)
    : null

  return {
    segment,
    before: beforeLoad,
    after: afterLoad,
    addedPeople: afterLoad.people - beforeLoad.people,
    needsConfirm: afterLoad.status === 'over' && afterLoad.occupied > beforeLoad.occupied,
    event,
  }
}
