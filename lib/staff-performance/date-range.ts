import {
  addDays,
  addMonthsToYearMonth,
  CORDOBA_TZ,
  cordobaDayStartUtc,
  endOfMonth,
  isoDayInCordoba,
  monthOf,
  startOfMonth,
  todayInCordoba,
} from '@/lib/dates'

/**
 * Períodos de «Mozos» (Estadísticas) y del cajón de cada mozo.
 *
 * Todo se piensa en días del calendario del bar (America/Argentina/Cordoba) con
 * `lib/dates`, igual en cualquier runtime: los atajos se cuentan desde
 * `todayInCordoba` y un rango a mano llega como días civiles `yyyy-MM-dd`.
 * Recién al final cada borde se pasa a un instante para filtrar `paid_at`:
 * `from` = las 00:00 de Córdoba del primer día y `to` = el último milisegundo
 * del último día.
 *
 * Por qué el rango a mano no viaja como `Date`: `new Date('2026-03-10')` es la
 * medianoche UTC, que en Córdoba (UTC−3) todavía es el 9 a las 21:00, y el
 * rango arrancaba (y terminaba) un día antes.
 */

export const TZ = CORDOBA_TZ

export const PRESETS = ['today', 'last7', 'last30', 'this_month', 'last_month', 'custom'] as const
export type DateRangePreset = (typeof PRESETS)[number]

export type DateRange = { from: Date; to: Date }

/** El rango a mano trae días civiles de Córdoba (`yyyy-MM-dd`), inclusivos de los dos bordes. */
export type DateRangeInput =
  | { preset: Exclude<DateRangePreset, 'custom'> }
  | { preset: 'custom'; from: string; to: string }

/**
 * `[00:00 de from, 23:59:59.999 de to]` en Córdoba, como instantes. El fin es
 * las 00:00 del día siguiente menos un milisegundo: las queries filtran con
 * `.lte(to)`.
 */
function cordobaDayBounds(from: string, to: string): DateRange {
  return {
    from: new Date(cordobaDayStartUtc(from)),
    to: new Date(Date.parse(cordobaDayStartUtc(addDays(to, 1))) - 1),
  }
}

/**
 * Resuelve un preset a un rango concreto. `now` es inyectable para testear.
 * Todos los rangos tienen el reloj del bar (TZ America/Argentina/Cordoba) —
 * "Hoy" empieza a las 00:00 hora Córdoba, no UTC.
 */
export function resolveDateRange(input: DateRangeInput, now: Date = new Date()): DateRange {
  if (input.preset === 'custom') return cordobaDayBounds(input.from, input.to)

  const today = todayInCordoba(now)
  switch (input.preset) {
    case 'today':
      return cordobaDayBounds(today, today)
    case 'last7':
      return cordobaDayBounds(addDays(today, -6), today)
    case 'last30':
      return cordobaDayBounds(addDays(today, -29), today)
    case 'this_month':
      return cordobaDayBounds(startOfMonth(today), today)
    case 'last_month': {
      const prev = addMonthsToYearMonth(monthOf(today), -1)
      return cordobaDayBounds(startOfMonth(prev), endOfMonth(prev))
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
  return isoDayInCordoba(d) ?? ''
}
