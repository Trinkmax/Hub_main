import { formatInTimeZone } from 'date-fns-tz'

/**
 * Calendario del tablero de marketing.
 *
 * Dos cosas viven acá y ninguna toca la red, así que son testeables solas:
 *   · la semana del checklist orgánico (lunes → domingo);
 *   · el cajón temporal de una tarea (Hoy / Esta semana / …).
 *
 * Todo se resuelve en el reloj del bar (America/Argentina/Cordoba) y viaja
 * como `yyyy-MM-dd`, que es el tipo real de las columnas `date`. La aritmética
 * se hace sobre `Date.UTC` a propósito: las funciones de fecha nativas operan
 * sobre los campos LOCALES del runtime, así que un server en otro huso podía
 * correr un día en los bordes — justo lo que rompe un "esta semana".
 * Mismo criterio que lib/salon/date-presets.ts.
 */

export const MARKETING_TZ = 'America/Argentina/Cordoba'

/** Día calendario en curso en Córdoba, como `yyyy-MM-dd`. */
export function todayIso(now: Date = new Date()): string {
  return formatInTimeZone(now, MARKETING_TZ, 'yyyy-MM-dd')
}

function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function shiftDays(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta))
}

/** ¿Es un `yyyy-MM-dd` válido? Se usa para sanear el `?semana=` de la URL. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && toIsoDay(d) === value
}

/**
 * Lunes de la semana que contiene `iso`. El bar piensa en fines de semana:
 * arrancar la semana en domingo partiría el finde en dos.
 */
export function weekStartOf(iso: string): string {
  const day = parseIsoDay(iso)
  // getUTCDay(): 0=domingo … 6=sábado. Queremos lunes como día 0.
  const offsetFromMonday = (day.getUTCDay() + 6) % 7
  return toIsoDay(shiftDays(day, -offsetFromMonday))
}

/** Lunes de la semana en curso en Córdoba. */
export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(todayIso(now))
}

/** Corre `n` semanas (puede ser negativo) desde un lunes dado. */
export function shiftWeeks(weekStart: string, n: number): string {
  return toIsoDay(shiftDays(parseIsoDay(weekStart), n * 7))
}

/** Domingo de esa semana. */
export function weekEndOf(weekStart: string): string {
  return toIsoDay(shiftDays(parseIsoDay(weekStart), 6))
}

/** Cuántas semanas hay entre dos lunes (`+1` = la que viene). */
export function weeksBetween(fromWeekStart: string, toWeekStart: string): number {
  const ms = parseIsoDay(toWeekStart).getTime() - parseIsoDay(fromWeekStart).getTime()
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000))
}

/** Etiqueta relativa de una semana ("Esta semana", "Semana anterior", …). */
export function weekLabel(weekStart: string, now: Date = new Date()): string {
  const delta = weeksBetween(currentWeekStart(now), weekStart)
  if (delta === 0) return 'Esta semana'
  if (delta === 1) return 'Próxima semana'
  if (delta === -1) return 'Semana anterior'
  if (delta > 1) return `En ${delta} semanas`
  return `Hace ${Math.abs(delta)} semanas`
}

// ──────────────────────────────────────────────
// Cajones temporales del listado de tareas
// ──────────────────────────────────────────────

export const DATE_BUCKETS = ['past', 'today', 'this_week', 'next_week', 'later'] as const
export type DateBucket = (typeof DATE_BUCKETS)[number]

export const BUCKET_LABELS: Record<DateBucket, string> = {
  past: 'Fechas pasadas',
  today: 'Hoy',
  this_week: 'Esta semana',
  next_week: 'La próxima semana',
  later: 'Más adelante',
}

/**
 * En qué cajón cae una tarea. `date` es la fecha efectiva
 * (`defined_date ?? ideal_date`); sin fecha, la tarea es un pendiente sin
 * compromiso y va al fondo.
 *
 * Las ventanas son móviles a propósito (7 y 14 días desde hoy), no el
 * calendario: un martes, "esta semana" tiene que llegar hasta el lunes que
 * viene, no morirse el domingo.
 */
export function dateBucket(date: string | null, today: string): DateBucket {
  if (!date) return 'later'
  if (date < today) return 'past'
  if (date === today) return 'today'
  const in7 = toIsoDay(shiftDays(parseIsoDay(today), 7))
  if (date < in7) return 'this_week'
  const in14 = toIsoDay(shiftDays(parseIsoDay(today), 14))
  if (date < in14) return 'next_week'
  return 'later'
}

/**
 * Meses a mano en vez de `Intl.DateTimeFormat`. Dos razones:
 *   · el ICU de Node devuelve "03-sept" y el del browser "3 sept" — distinto
 *     texto en el server y en el cliente es un mismatch de hidratación;
 *   · queremos el corte corto de siempre ("sep", no "sept").
 */
const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const

/** `2026-09-04` → `04 sep`. Sin fecha → "Sin fecha". */
export function formatDayShort(date: string | null): string {
  if (!date) return 'Sin fecha'
  const [, month, day] = date.split('-')
  const index = Number(month) - 1
  const name = MONTHS_SHORT[index]
  if (!day || !name) return date
  return `${day} ${name}`
}
