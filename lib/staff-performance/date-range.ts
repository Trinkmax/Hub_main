import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

export const TZ = 'America/Argentina/Cordoba'

export const PRESETS = ['today', 'last7', 'last30', 'this_month', 'last_month', 'custom'] as const
export type DateRangePreset = (typeof PRESETS)[number]

export type DateRange = { from: Date; to: Date }

export type DateRangeInput =
  | { preset: Exclude<DateRangePreset, 'custom'> }
  | { preset: 'custom'; from: Date; to: Date }

/**
 * Devuelve el instante UTC que corresponde a las 00:00 del día calendario de
 * `d` en la zona Córdoba.
 *
 * Cómo funciona: tomamos el "qué día calendario es ahora en Córdoba" (string
 * `yyyy-MM-dd`), y lo interpretamos como 00:00 en Córdoba con `fromZonedTime`.
 * Eso devuelve el instante UTC correcto y es estable al TZ del runtime.
 */
function startOfDayInTz(d: Date): Date {
  const isoDay = formatInTimeZone(d, TZ, 'yyyy-MM-dd')
  return fromZonedTime(`${isoDay}T00:00:00`, TZ)
}

function endOfDayInTz(d: Date): Date {
  const isoDay = formatInTimeZone(d, TZ, 'yyyy-MM-dd')
  return fromZonedTime(`${isoDay}T23:59:59.999`, TZ)
}

/**
 * Resuelve un preset a un rango concreto. `now` es inyectable para testear.
 * Todos los rangos tienen el reloj del bar (TZ America/Argentina/Cordoba) —
 * "Hoy" empieza a las 00:00 hora Córdoba, no UTC.
 */
export function resolveDateRange(input: DateRangeInput, now: Date = new Date()): DateRange {
  if (input.preset === 'custom') {
    return { from: startOfDayInTz(input.from), to: endOfDayInTz(input.to) }
  }

  // Las operaciones de date-fns (startOfMonth, subDays, etc.) operan en el TZ
  // del runtime. Para que calculen sobre el calendario de Córdoba, primero
  // "movemos" el instant a una representación en Córdoba (toZonedTime), hacemos
  // la operación, y después volvemos al instant UTC con fromZonedTime.
  const cordobaNow = toZonedTime(now, TZ)

  switch (input.preset) {
    case 'today':
      return { from: startOfDayInTz(now), to: endOfDayInTz(now) }
    case 'last7':
      return { from: startOfDayInTz(subDays(now, 6)), to: endOfDayInTz(now) }
    case 'last30':
      return { from: startOfDayInTz(subDays(now, 29)), to: endOfDayInTz(now) }
    case 'this_month': {
      const firstDay = startOfMonth(cordobaNow)
      return { from: fromZonedTime(firstDay, TZ), to: endOfDayInTz(now) }
    }
    case 'last_month': {
      const prev = subMonths(cordobaNow, 1)
      const firstDay = startOfMonth(prev)
      const lastDay = endOfMonth(prev)
      return {
        from: fromZonedTime(firstDay, TZ),
        to: fromZonedTime(lastDay, TZ),
      }
    }
  }
}

export function labelForPreset(preset: DateRangePreset): string {
  switch (preset) {
    case 'today':
      return 'Hoy'
    case 'last7':
      return 'Últimos 7 días'
    case 'last30':
      return 'Últimos 30 días'
    case 'this_month':
      return 'Mes actual'
    case 'last_month':
      return 'Mes anterior'
    case 'custom':
      return 'Personalizado'
  }
}

/**
 * Valida un preset que viene de searchParams (puede ser string libre).
 * Devuelve null si no es válido — el caller decide el fallback.
 */
export function parsePreset(raw: string | undefined | null): DateRangePreset | null {
  if (!raw) return null
  return (PRESETS as readonly string[]).includes(raw) ? (raw as DateRangePreset) : null
}

export function toIsoBounds(range: DateRange): { fromIso: string; toIso: string } {
  return { fromIso: range.from.toISOString(), toIso: range.to.toISOString() }
}

/**
 * Helper para tests: dado un Date instant UTC, devuelve "qué día calendario fue
 * en Córdoba" como string `yyyy-MM-dd`. Útil para aserciones robustas al TZ del
 * runtime de los tests.
 */
export function dayInTz(d: Date): string {
  return formatInTimeZone(d, TZ, 'yyyy-MM-dd')
}
