/**
 * La hora del bar (America/Argentina/Cordoba) calculada a mano.
 *
 * Por qué no `Intl` ni date-fns-tz: el server (Node en Vercel, en UTC) y el
 * navegador del dueño no tienen por qué traer el mismo ICU, y lo que se
 * renderiza en los dos lados tiene que dar el mismo string o React avisa
 * hydration mismatch (kit §8, riesgo 15). Córdoba está en UTC−3 fijo desde el
 * 15/03/2009 (la Argentina no volvió a mover el reloj), así que para cualquier
 * instante desde entonces alcanza con restar tres horas y contar días con
 * enteros. El código viejo ya se apoya en esa regla (`serviceDayStartIso` de
 * `lib/salon/operativo.ts` usa `-03:00` fijo).
 *
 * Antes de 2009 hubo horario de verano (2007-08 y 2008-09) y otros husos.
 * Ningún dato del bar es de esa época, pero para no devolver una hora falsa
 * esos instantes se resuelven con la base de zonas del runtime vía `Intl`,
 * pidiendo solo campos numéricos (los mismos en cualquier ICU). Si algún día la
 * Argentina vuelve a adoptar horario de verano, este archivo es el único lugar
 * que hay que tocar.
 *
 * Los valores sin zona (`'2026-09-10T21:30'`, lo que manda un
 * `datetime-local` o DateTimeField) se leen como hora de reloj de Córdoba, no
 * de la zona del runtime: `Date.parse` los tomaría como hora local del server.
 */

import {
  addDays,
  civilFromDays,
  daysFromCivil,
  isoDayToEpochDays,
  timeToMinutes,
  toIsoDay,
} from './civil'

export const CORDOBA_TZ = 'America/Argentina/Cordoba'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** UTC−3. */
const CORDOBA_OFFSET_MS = -3 * HOUR_MS

/**
 * El último cambio de hora: el 15/03/2009 a las 00:00 (UTC−2) el reloj volvió a
 * las 23:00 del 14 (UTC−3). Desde ese instante, 02:00 UTC, el offset es fijo.
 */
const FIXED_OFFSET_SINCE_MS = Date.UTC(2009, 2, 15, 2)

export type CordobaDateTime = {
  /** `'yyyy-MM-dd'` */
  date: string
  /** `'HH:mm'` */
  time: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): CordobaDateTime {
  return {
    date: toIsoDay(year, month, day),
    time: `${pad2(hour)}:${pad2(minute)}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  }
}

/** Campos de un instante ya corrido a la hora local (`ms + offset`). */
function partsFromLocalMs(localMs: number): CordobaDateTime {
  const days = Math.floor(localMs / DAY_MS)
  const msOfDay = localMs - days * DAY_MS
  const { year, month, day } = civilFromDays(days)
  return buildParts(
    year,
    month,
    day,
    Math.floor(msOfDay / HOUR_MS),
    Math.floor((msOfDay % HOUR_MS) / MINUTE_MS),
    Math.floor((msOfDay % MINUTE_MS) / SECOND_MS),
  )
}

// ─── Respaldo para instantes anteriores a 2009 ───────────────────────────────

let historicFormatter: Intl.DateTimeFormat | null = null

/** Campos de Córdoba vía `Intl` (solo para antes de 2009). Se crea recién al usarse. */
function historicParts(ms: number): CordobaDateTime {
  historicFormatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: CORDOBA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // Con `hour12: false` algunos motores devuelven `24` a la medianoche.
    hourCycle: 'h23',
  })
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of historicFormatter.formatToParts(ms)) {
    if (part.type in out) out[part.type as keyof typeof out] = Number(part.value)
  }
  return buildParts(out.year, out.month, out.day, out.hour % 24, out.minute, out.second)
}

/** Offset histórico (local − UTC) en un instante anterior a 2009. */
function historicOffsetMs(ms: number): number {
  const p = historicParts(ms)
  const localAsUtc =
    daysFromCivil(p.year, p.month, p.day) * DAY_MS +
    p.hour * HOUR_MS +
    p.minute * MINUTE_MS +
    p.second * SECOND_MS
  return localAsUtc - Math.floor(ms / SECOND_MS) * SECOND_MS
}

// ─── Instante ↔ hora de Córdoba ──────────────────────────────────────────────

function partsFromMs(ms: number): CordobaDateTime {
  if (!Number.isFinite(ms)) throw new RangeError('Instante inválido')
  return ms >= FIXED_OFFSET_SINCE_MS ? partsFromLocalMs(ms + CORDOBA_OFFSET_MS) : historicParts(ms)
}

/** Instante (ms UTC) de una hora de reloj de Córdoba. */
function wallToMs(epochDays: number, minutesOfDay: number, seconds = 0): number {
  const wallAsUtc = epochDays * DAY_MS + minutesOfDay * MINUTE_MS + seconds * SECOND_MS
  const fixed = wallAsUtc - CORDOBA_OFFSET_MS
  if (fixed >= FIXED_OFFSET_SINCE_MS) return fixed
  // Antes de 2009: dos pasadas con el offset de la época, como hacen las
  // bibliotecas de zonas. En un cambio de hora puede caer en cualquiera de las
  // dos lecturas de una hora repetida; ningún dato del bar es de entonces.
  const first = wallAsUtc - historicOffsetMs(fixed)
  return wallAsUtc - historicOffsetMs(first)
}

// ─── Lectura de valores de fecha ─────────────────────────────────────────────

const DAY_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i

export type DateValue = Date | number | string

/**
 * Qué es un valor de fecha:
 * - `day`: un `date` civil (`'2026-09-15'`), sin hora ni zona.
 * - `wall`: una hora de reloj de Córdoba sin zona (`'2026-09-15T21:30'`).
 * - `instant`: un instante (`Date`, epoch ms o un string con `Z`/offset, como
 *   los `timestamptz` que devuelve PostgREST).
 */
export type DateValueKind =
  | { kind: 'day'; date: string }
  | { kind: 'wall'; date: string; hour: number; minute: number; second: number }
  | { kind: 'instant'; ms: number }

function validClock(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59
}

/** Clasifica un valor de fecha sin pasar por `Date.parse`. `null` si no se lee. */
export function readDateValue(value: DateValue | null | undefined): DateValueKind | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? { kind: 'instant', ms } : null
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? { kind: 'instant', ms: value } : null

  const text = value.trim()
  const dayOnly = DAY_ONLY_RE.exec(text)
  if (dayOnly) {
    try {
      isoDayToEpochDays(text)
      return { kind: 'day', date: text }
    } catch {
      return null
    }
  }

  const m = TIMESTAMP_RE.exec(text)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  let epochDays: number
  try {
    epochDays = isoDayToEpochDays(date)
  } catch {
    return null
  }
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6] ?? '0')
  if (!validClock(hour, minute, second)) return null
  const zone = m[8]
  if (!zone) return { kind: 'wall', date, hour, minute, second }

  let offsetMinutes = 0
  if (zone.toUpperCase() !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1
    const digits = zone.slice(1).replace(':', '')
    const offH = Number(digits.slice(0, 2))
    const offM = Number(digits.slice(2, 4) || '0')
    if (offH > 14 || offM > 59) return null
    offsetMinutes = sign * (offH * 60 + offM)
  }
  // Solo milisegundos: PostgREST manda microsegundos y el resto no cambia el minuto.
  const millis = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'))
  const ms =
    epochDays * DAY_MS +
    hour * HOUR_MS +
    minute * MINUTE_MS +
    second * SECOND_MS +
    millis -
    offsetMinutes * MINUTE_MS
  return { kind: 'instant', ms }
}

/**
 * Fecha y hora de Córdoba de un instante. Un valor sin zona ya es hora de
 * Córdoba y vuelve tal cual; un `date` civil (sin hora) da `null`.
 */
export function cordobaDateTime(value: DateValue | null | undefined): CordobaDateTime | null {
  const read = readDateValue(value)
  if (!read || read.kind === 'day') return null
  if (read.kind === 'wall') {
    const civil = read.date.split('-').map(Number)
    return buildParts(
      civil[0] ?? 0,
      civil[1] ?? 0,
      civil[2] ?? 0,
      read.hour,
      read.minute,
      read.second,
    )
  }
  return partsFromMs(read.ms)
}

/** Fecha y hora de Córdoba en este momento. */
export function nowInCordoba(now: Date | number = new Date()): CordobaDateTime {
  return partsFromMs(typeof now === 'number' ? now : now.getTime())
}

/** Día calendario en curso en Córdoba, como `yyyy-MM-dd`. */
export function todayInCordoba(now: Date | number = new Date()): string {
  return nowInCordoba(now).date
}

/** A qué día del calendario del bar pertenece un instante (`timestamptz`). */
export function isoDayInCordoba(value: DateValue | null | undefined): string | null {
  return cordobaDateTime(value)?.date ?? null
}

/** `'HH:mm'` del reloj del bar para un instante. */
export function timeInCordoba(value: DateValue | null | undefined): string | null {
  return cordobaDateTime(value)?.time ?? null
}

/**
 * Instante UTC (ISO, con `Z`) de una hora de reloj de Córdoba:
 * `cordobaWallTimeToUtc('2026-09-15', '21:30')` → `'2026-09-16T00:30:00.000Z'`.
 */
export function cordobaWallTimeToUtc(iso: string, time = '00:00'): string {
  const minutes = timeToMinutes(time)
  if (minutes === null) throw new RangeError(`Hora inválida: «${time}» (se espera HH:mm)`)
  return new Date(wallToMs(isoDayToEpochDays(iso), minutes)).toISOString()
}

/**
 * Las 00:00 de `iso` en Córdoba, como instante UTC. Es el borde para filtrar
 * `timestamptz` por día del bar (`[desde, hasta + 1)`): la base corre en UTC y
 * una reserva de las 21:30 ya figura al día siguiente.
 */
export function cordobaDayStartUtc(iso: string): string {
  return cordobaWallTimeToUtc(iso, '00:00')
}

/**
 * El «día de servicio» no termina a medianoche: hasta las 5 AM la anfitriona
 * sigue cerrando la noche anterior. Misma regla que `serviceDayInCordoba` de
 * `lib/salon/operativo.ts`.
 */
export const SERVICE_DAY_ROLLOVER_HOUR = 5

export function serviceDayInCordoba(
  now: Date | number = new Date(),
  rolloverHour: number = SERVICE_DAY_ROLLOVER_HOUR,
): string {
  const parts = nowInCordoba(now)
  return parts.hour >= rolloverHour ? parts.date : addDays(parts.date, -1)
}
