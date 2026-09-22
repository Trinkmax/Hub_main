/**
 * Filas de la DB → entradas del cálculo por servicio. PURO (sin supabase, next
 * ni react): la capa server (`segment-queries.ts`) trae las filas y esto las
 * normaliza, así el mapeo y la paginación se testean sin base.
 *
 * Por qué hace falta mapear en vez de castear: `lib/salon` habla con Supabase
 * como `any`, así que un número que llega como string, un join que PostgREST
 * devuelve como array o un `segment` fuera de los tres servicios pasarían
 * callados hasta la cuenta del cupo. Acá se corta en el borde.
 */

import {
  eventDisplayName,
  type IsoDow,
  isSegmentKey,
  NO_ZONE_CAPS,
  type SegmentEventInput,
  type SegmentKey,
  type SegmentOverrideRow,
  type SegmentReservationInput,
  type SegmentSettingRow,
  type SegmentWeeklyCapRow,
  segmentOfEventStart,
  segmentOfMealType,
  type ZoneCaps,
} from './segments'
import type { MealType, ReservationKind, SalonReservationStatus, SalonZone } from './types'

/**
 * Las columnas que necesita la cuenta y nada más: sin nombre, teléfono ni
 * comentarios. El snapshot del día viaja al navegador de la anfitriona para
 * proyectar la reserva antes de guardar, y no tiene por qué llevar la agenda
 * del bar con datos personales.
 */
export const SEGMENT_RES_SELECT =
  'id, reservation_date, meal_type, reservation_time_local, scheduled_event_id, zone, status, estimated_guests, actual_guests, kind, cake_count'

/** Lo que devuelve un `.range()` de supabase-js, reducido a lo que se usa. */
type PageResult<T> = { data: T[] | null; error: { message: string; code?: string } | null }

/**
 * Trae TODAS las filas de a páginas. PostgREST corta cada respuesta en 1000
 * filas sin avisar: septiembre ya tiene 445 reservas y un mes de temporada
 * pasaría el tope, así que el mes contaría de menos y el semáforo mentiría en
 * verde.
 *
 * - Una página con menos filas que `pageSize` (o vacía) es la última.
 * - Un error corta todo con un `Error` que conserva el `code` de Postgres o de
 *   PostgREST (el caller decide qué hacer, por ejemplo con 42P01).
 * - Al llegar a `maxPages` páginas llenas se devuelve lo juntado y se avisa por
 *   consola (sin datos de nadie): es un tope de seguridad, no un límite de
 *   negocio. 20 × 1000 son 20.000 reservas en un mes.
 *
 * El caller tiene que ordenar por una clave única (fecha + id): sin orden
 * estable, dos páginas pueden repetir o saltearse filas.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<T[]> {
  const pageSize = Math.max(1, Math.floor(opts?.pageSize ?? 1000))
  const maxPages = Math.max(1, Math.floor(opts?.maxPages ?? 20))
  const out: T[] = []

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) {
      throw Object.assign(new Error(error.message), { code: error.code })
    }
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) return out
  }

  console.warn('[salon.collectPages] se llegó al tope de páginas; puede haber filas sin leer', {
    pageSize,
    maxPages,
    rows: out.length,
  })
  return out
}

/**
 * Tabla inexistente: 42P01 si el error sale de Postgres, PGRST205 si sale del
 * schema cache de PostgREST (lo que devuelve hoy la Data API). Pasa cuando el
 * código se despliega ANTES de aplicar la migración de cupos por servicio: en
 * ese caso se usa el cupo general en lugar de romper el calendario.
 */
export function isMissingTableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === '42P01' || code === 'PGRST205'
}

// ──────────────────────────────────────────────────────────
// Helpers de narrowing
// ──────────────────────────────────────────────────────────

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** int de Postgres → number. `bigint` o `numeric` pueden llegar como string. */
function asNumber(value: unknown, fallback = 0): number {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = asNumber(value, Number.NaN)
  return Number.isFinite(n) ? n : null
}

/** PostgREST devuelve un embed a-uno como objeto o como array según la FK. */
function firstOf(value: unknown): Record<string, unknown> | null {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

function isIsoDow(value: number): value is IsoDow {
  return Number.isInteger(value) && value >= 1 && value <= 7
}

// ──────────────────────────────────────────────────────────
// Reservas y eventos
// ──────────────────────────────────────────────────────────

/**
 * Una fila de `SEGMENT_RES_SELECT` → entrada del cálculo. Las columnas ya
 * vienen con esos nombres; esto solo asegura tipos (un `cake_count` null de
 * una fila vieja cuenta como 0 tortas, no como NaN).
 */
export function toSegmentReservationInput(row: Record<string, unknown>): SegmentReservationInput {
  return {
    id: asString(row.id),
    reservation_date: asString(row.reservation_date),
    meal_type: asString(row.meal_type, 'dinner') as MealType,
    reservation_time_local: asString(row.reservation_time_local),
    scheduled_event_id: asNullableString(row.scheduled_event_id),
    zone: asString(row.zone, 'planta_alta') as SalonZone,
    status: asString(row.status, 'pending') as SalonReservationStatus,
    estimated_guests: asNumber(row.estimated_guests),
    actual_guests: asNullableNumber(row.actual_guests),
    kind: asString(row.kind, 'normal') as ReservationKind,
    cake_count: asNumber(row.cake_count),
  }
}

/**
 * Evento completo (`ScheduledEventWithTemplate`) → solo lo que usa el cálculo.
 * El snapshot del form viaja al cliente: sin notas, bonus ni ids de template.
 */
export function toSegmentEventInput(
  e: SegmentEventInput & Record<string, unknown>,
): SegmentEventInput {
  const template = firstOf(e.template)
  return {
    id: e.id,
    event_date: e.event_date,
    starts_at_local: e.starts_at_local,
    capacity: asNumber(e.capacity),
    name_override: e.name_override ?? null,
    template: template
      ? { name: asString(template.name), color_hex: asString(template.color_hex) }
      : null,
  }
}

// ──────────────────────────────────────────────────────────
// Config: semanal, especiales y ajustes
// ──────────────────────────────────────────────────────────

/** Filas de `salon_segment_capacities`. Descarta lo que no sea un servicio/día válido. */
export function toWeeklyCapRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): SegmentWeeklyCapRow[] {
  const out: SegmentWeeklyCapRow[] = []
  for (const row of rows) {
    const isoDow = asNumber(row.iso_dow, Number.NaN)
    if (!isSegmentKey(row.segment) || !isIsoDow(isoDow)) continue
    out.push({
      segment: row.segment,
      iso_dow: isoDow,
      capacity: asNumber(row.capacity),
      warn_at: asNullableNumber(row.warn_at),
    })
  }
  return out
}

/** Filas de `salon_segment_capacity_overrides`. */
export function toOverrideRows(rows: ReadonlyArray<Record<string, unknown>>): SegmentOverrideRow[] {
  const out: SegmentOverrideRow[] = []
  for (const row of rows) {
    if (!isSegmentKey(row.segment)) continue
    const date = asString(row.override_date)
    if (!date) continue
    out.push({
      segment: row.segment,
      override_date: date,
      capacity: asNumber(row.capacity),
      warn_at: asNullableNumber(row.warn_at),
      reason: asNullableString(row.reason),
    })
  }
  return out
}

/**
 * `tenants.settings` → cupo de cada planta de `salon_capacities` (el «Cupo
 * general por planta» de Configuración), SIN los overrides por zona (quedaron
 * sin UI y los reemplaza el cupo especial por servicio).
 *
 * Una planta sin cargar da 0, que en el filtro de planta es "sin tope". Un
 * valor que no es número también cuenta 0: con `Number()` pelado un "abc" daba
 * NaN y el cupo quedaba en un número que no compara con nada.
 */
export function zoneCapsFromSettings(settings: unknown): ZoneCaps {
  if (typeof settings !== 'object' || settings === null) return { ...NO_ZONE_CAPS }
  const caps = (settings as Record<string, unknown>).salon_capacities
  if (typeof caps !== 'object' || caps === null) return { ...NO_ZONE_CAPS }
  const { planta_alta, planta_baja } = caps as Record<string, unknown>
  return { planta_alta: asNumber(planta_alta), planta_baja: asNumber(planta_baja) }
}

/**
 * Cupo general del salón: planta alta + planta baja. Sale de
 * `zoneCapsFromSettings` para que el cupo por servicio de un bar sin config
 * (130 en el HUB) y el de cada planta (60 y 70) no puedan contradecirse.
 * Sin `salon_capacities` da 0, que en el cálculo es "sin tope".
 */
export function fallbackTotalFromSettings(settings: unknown): number {
  const caps = zoneCapsFromSettings(settings)
  return caps.planta_alta + caps.planta_baja
}

/**
 * Filas de `salon_segment_settings`. La columna es `time`, así que llega
 * '13:00:00': se recorta a 'HH:MM', que es lo que usan el input del editor y
 * el alta de reserva.
 */
export function toSettingRows(rows: ReadonlyArray<Record<string, unknown>>): SegmentSettingRow[] {
  const out: SegmentSettingRow[] = []
  for (const row of rows) {
    if (!isSegmentKey(row.segment)) continue
    out.push({
      segment: row.segment,
      default_time: asString(row.default_time).slice(0, 5),
      warn_note: asNullableString(row.warn_note),
    })
  }
  return out
}

// ──────────────────────────────────────────────────────────
// Búsqueda de reservas (buscador del calendario)
// ──────────────────────────────────────────────────────────

export type ReservationSearchResult = {
  id: string
  guest_name: string
  reservation_date: string
  /** 'HH:MM' */
  reservation_time_local: string
  guests: number
  status: SalonReservationStatus
  segment: SegmentKey
  eventName: string | null
}

/**
 * Select del buscador: lo que muestra cada resultado más el evento, que define
 * el servicio (R3). El teléfono se filtra en la query pero no se devuelve.
 */
export const SEARCH_RES_SELECT =
  'id, guest_name, reservation_date, reservation_time_local, estimated_guests, actual_guests, status, meal_type, scheduled_event_id, scheduled_event:scheduled_events(id, starts_at_local, name_override, template:scheduled_event_templates(name, color_hex))'

/**
 * Fila del buscador → resultado. El servicio sale con la MISMA regla que el
 * día: el del evento si está colgada de uno (por su hora de inicio), si no el
 * `meal_type`. Así "Cena" en el resultado es la sección donde la vas a ver al
 * abrir el día.
 */
export function mapSearchRow(row: Record<string, unknown>): ReservationSearchResult {
  const event = firstOf(row.scheduled_event)
  const eventStart = event ? asString(event.starts_at_local) : ''
  const segment: SegmentKey =
    event && eventStart
      ? segmentOfEventStart(eventStart)
      : segmentOfMealType(asString(row.meal_type, 'dinner') as MealType)

  let eventName: string | null = null
  if (event) {
    const template = firstOf(event.template)
    eventName = eventDisplayName({
      name_override: asNullableString(event.name_override),
      template: template
        ? { name: asString(template.name), color_hex: asString(template.color_hex) }
        : null,
    })
  }

  const actual = asNullableNumber(row.actual_guests)
  return {
    id: asString(row.id),
    guest_name: asString(row.guest_name),
    reservation_date: asString(row.reservation_date),
    reservation_time_local: asString(row.reservation_time_local).slice(0, 5),
    guests: actual ?? asNumber(row.estimated_guests),
    status: asString(row.status, 'pending') as SalonReservationStatus,
    segment,
    eventName,
  }
}

/**
 * Texto del buscador → filtros seguros para PostgREST.
 *
 * - `name`: sin los caracteres que rompen la sintaxis de `.or()` (`,` `(` `)`
 *   `"`) ni comodines que el usuario no quiso poner (`%` `*` y `\`, que es el
 *   escape de LIKE). Con menos de 2 caracteres útiles no se busca por nombre:
 *   '%%' traería todo el bar.
 * - `digits`: los dígitos del texto, si son 4 o más, para buscar también por
 *   teléfono (se guardan en E.164, '+5493511234567', así que '3511234' matchea).
 */
export function searchTerms(q: string): { name: string | null; digits: string | null } {
  const name = q
    .replace(/[%,()*"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const digits = q.replace(/\D/g, '')
  return {
    name: name.length >= 2 ? name : null,
    digits: digits.length >= 4 ? digits : null,
  }
}
