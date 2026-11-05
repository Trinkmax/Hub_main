import type { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { isRealIsoDay } from '@/lib/dates'
import { formatPhoneForDisplay, tryNormalizePhone } from '@/lib/phone'
import type { ServiceAlert } from '@/lib/salon/alerts'
import { salonStatusEnum } from '@/lib/salon/schemas'
import type { ConfigurableSegmentKey, FloorZone, SegmentKey } from '@/lib/salon/segments'
import type {
  ReservationKind,
  ReservationOrigin,
  SalonReservationStatus,
  SalonZone,
} from '@/lib/salon/types'
import type { TenantRole } from '@/lib/tenant/types'
import { dayField } from '../types'

/**
 * Las palabras con que Tex pide las cosas y lo que entiende el sistema, más lo que comparten todas las
 * herramientas del área. Puro: lo usan las herramientas y los tests.
 */

/** Las pantallas de plata del área son de los dueños (`requireRole(['owner'])`). */
export const OWNER_ONLY: readonly TenantRole[] = ['owner']

/** Un día que además existe: el 31/02 tiene la forma de una fecha y Postgres lo rebota con un error crudo. */
export const realDay = (description?: string) =>
  dayField(description).refine(isRealIsoDay, 'Esa fecha no existe.')

// ─── Servicios, plantas, tipos ───────────────────────────────────────────────

export const SERVICE_WORDS = ['desayuno', 'almuerzo', 'merienda', 'cena'] as const
export type ServiceWord = (typeof SERVICE_WORDS)[number]

export const SEGMENT_OF_WORD: Readonly<Record<ServiceWord, SegmentKey>> = {
  desayuno: 'breakfast',
  almuerzo: 'lunch',
  merienda: 'tea_time',
  cena: 'dinner',
}

/** Los que tienen cupo propio: el desayuno siempre usa el cupo general. */
export const CONFIGURABLE_SERVICE_WORDS = ['almuerzo', 'merienda', 'cena'] as const
export type ConfigurableServiceWord = (typeof CONFIGURABLE_SERVICE_WORDS)[number]

export const CONFIGURABLE_SEGMENT_OF_WORD: Readonly<
  Record<ConfigurableServiceWord, ConfigurableSegmentKey>
> = { almuerzo: 'lunch', merienda: 'tea_time', cena: 'dinner' }

export const FLOOR_WORDS = ['alta', 'baja'] as const
export type FloorWord = (typeof FLOOR_WORDS)[number]

export const ZONE_OF_WORD: Readonly<Record<FloorWord, FloorZone>> = {
  alta: 'planta_alta',
  baja: 'planta_baja',
}

export const ZONE_FILTER_WORDS = ['alta', 'baja', 'sin_ubicar'] as const
export type ZoneFilterWord = (typeof ZONE_FILTER_WORDS)[number]

export const ZONE_OF_FILTER_WORD: Readonly<Record<ZoneFilterWord, SalonZone>> = {
  alta: 'planta_alta',
  baja: 'planta_baja',
  sin_ubicar: 'event_floating',
}

export const KIND_WORDS = ['normal', 'cumpleanos', 'especial'] as const
export type KindWord = (typeof KIND_WORDS)[number]

export const KIND_OF_WORD: Readonly<Record<KindWord, ReservationKind>> = {
  normal: 'normal',
  cumpleanos: 'birthday',
  especial: 'special',
}

export const ORIGIN_WORDS = [
  'whatsapp',
  'instagram',
  'messenger',
  'presencial',
  'conocido_de_socio',
] as const
export type OriginWord = (typeof ORIGIN_WORDS)[number]

export const ORIGIN_OF_WORD: Readonly<Record<OriginWord, ReservationOrigin>> = {
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  messenger: 'messenger',
  presencial: 'in_person',
  conocido_de_socio: 'partner_referral',
}

/** Como lo dice el tique. `ORIGIN_LABELS` trae el nombre de un bar: acá no sirve. */
export const ORIGIN_TEXT: Readonly<Record<ReservationOrigin, string>> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  in_person: 'Presencial',
  partner_referral: 'Conocido de un socio',
  web: 'Web · Mercado Pago',
}

export const ALERT_WORDS = [
  'celiaco',
  'alergia',
  'vegetariano',
  'vegano',
  'movilidad_reducida',
  'silla_de_bebe',
] as const
export type AlertWord = (typeof ALERT_WORDS)[number]

export const ALERT_OF_WORD: Readonly<Record<AlertWord, ServiceAlert>> = {
  celiaco: 'celiac',
  alergia: 'allergy',
  vegetariano: 'vegetarian',
  vegano: 'vegan',
  movilidad_reducida: 'reduced_mobility',
  silla_de_bebe: 'baby_seat',
}

export const STATUS_FILTER_WORDS = [
  'pendiente',
  'llego',
  'sentada',
  'cerrada',
  'no_vino',
  'cancelada',
] as const
export type StatusFilterWord = (typeof STATUS_FILTER_WORDS)[number]

export const STATUS_OF_WORD: Readonly<Record<StatusFilterWord, SalonReservationStatus>> = {
  pendiente: 'pending',
  llego: 'arrived',
  sentada: 'seated',
  cerrada: 'closed',
  no_vino: 'no_show',
  cancelada: 'cancelled',
}

/** Lo que se le puede pedir a una reserva desde el tablero. Cancelar va aparte. */
export const STATUS_CHANGE_WORDS = ['llego', 'no_vino', 'sentada', 'cerrada', 'por_llegar'] as const
export type StatusChangeWord = (typeof STATUS_CHANGE_WORDS)[number]

export const OPERABLE_STATUS = salonStatusEnum.exclude(['cancelled'])
export type OperableStatus = z.infer<typeof OPERABLE_STATUS>

export const TARGET_OF_CHANGE: Readonly<Record<StatusChangeWord, OperableStatus>> = {
  llego: 'arrived',
  no_vino: 'no_show',
  sentada: 'seated',
  cerrada: 'closed',
  por_llegar: 'pending',
}

export const WEEKDAY_WORDS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const
export type WeekdayWord = (typeof WEEKDAY_WORDS)[number]

/** Como los guarda la grilla de cupos: 1 = lunes … 7 = domingo. */
export const ISO_DOW_OF_WORD: Readonly<Record<WeekdayWord, 1 | 2 | 3 | 4 | 5 | 6 | 7>> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
}

export const WEEKDAY_PLURAL: Readonly<Record<WeekdayWord, string>> = {
  lunes: 'lunes',
  martes: 'martes',
  miercoles: 'miércoles',
  jueves: 'jueves',
  viernes: 'viernes',
  sabado: 'sábados',
  domingo: 'domingos',
}

// ─── Los datos de contacto no viajan ─────────────────────────────────────────

/** `+5493511234567` → `…4567`. Sin 4 dígitos, nada. */
export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `…${digits.slice(-4)}` : null
}

/**
 * Como la guarda el formulario. El zod de reservas deja pasar con espacios lo que arranca con `+`, y así
 * no matchearía con su ficha. Lo que no se puede normalizar va tal cual: el zod lo rechaza con su mensaje.
 */
export function normalizedPhone(raw: string): string {
  return tryNormalizePhone(raw) ?? raw.trim()
}

/** En el tique, que lo ve solo quien lo pidió, va entero: tiene que poder revisar lo que se va a guardar. */
export function phoneForTicket(raw: string): string {
  return formatPhoneForDisplay(normalizedPhone(raw))
}

const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
/** El mismo criterio que la pantalla (`maskPersonal`): 9 a 15 dígitos, sin tomar un importe. */
const PHONE_RE = /(?<![\d.,$/])\+?(?:\d[\s-]?){8,14}\d(?![\d.,/])/g

/**
 * Lo que alguien escribió a mano (un comentario, hasta un nombre) puede traer un teléfono o un mail, y
 * lo que devuelve una herramienta viaja a la API de un tercero.
 */
export function redactContacts(text: string): string {
  return text
    .replace(MAIL_RE, '[mail]')
    .replace(PHONE_RE, (match) => maskPhone(match) ?? '[teléfono]')
}

const HEALTH_RE =
  /cel[ií]ac|sin tacc|alerg|al[eé]rgic|intoleran|diab[eé]tic|embaraz|discapacid|silla de ruedas|movilidad reducida/i

/** ¿Este texto escrito a mano habla de la salud de alguien? */
export function mentionsHealth(text: string): boolean {
  return HEALTH_RE.test(text)
}

export const HEALTH_NOTE = 'tiene una nota con un dato de salud: se ve en la pantalla'

// ─── Las respuestas de las acciones ──────────────────────────────────────────

type ActionLike =
  | { ok: true; message?: string }
  | { ok: false; message: string; field?: string; code?: string }

/**
 * Lo que devuelven las acciones de reservas, en la forma que entiende `simpleExecutor`. `data` lo pone
 * quien llama a propósito: la respuesta de `transitionStatus` trae la fila entera, con el teléfono, y
 * `data` le llega a Tex.
 */
export function toSimpleState<D>(
  state: ActionLike,
  data: D,
  fallbackMessage: string,
): AccSimpleState<D> {
  if (state.ok) return { ok: true, data, message: state.message || fallbackMessage }
  return {
    ok: false,
    code: 'field' in state && state.field ? 'invalid' : 'error',
    message: state.message,
  }
}
