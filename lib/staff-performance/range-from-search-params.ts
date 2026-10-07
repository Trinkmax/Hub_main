import { isoDayInCordoba, isRealIsoDay, readDateValue } from '@/lib/dates'
import {
  type DateRangeInput,
  type DateRangePreset,
  parsePreset,
  resolveDateRange,
} from './date-range'

/**
 * Un borde de `?from=`/`?to=` como día del calendario de Córdoba
 * (`yyyy-MM-dd`), o `null` si no es una fecha real (1900–2199).
 *
 * - `2026-03-10` se toma tal cual: es un día del bar, no la medianoche UTC
 *   (`new Date('2026-03-10')` en Córdoba todavía es el 9 a las 21:00).
 * - Un instante con zona (`2026-03-10T15:00:00Z`, `…-03:00`) cuenta en el día
 *   de Córdoba en que cae; una hora sin zona ya es hora de Córdoba.
 */
export function cordobaDayFromParam(raw: string | undefined): string | null {
  const read = readDateValue(raw)
  if (!read) return null
  const day = read.kind === 'instant' ? isoDayInCordoba(read.ms) : read.date
  return day !== null && isRealIsoDay(day) ? day : null
}

/**
 * Construye un DateRangeInput a partir de los searchParams de Next.js.
 * - `?preset=today|last7|last30|this_month|last_month` → preset directo
 * - `?preset=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` → custom
 * - Default: `last7`.
 *
 * Acepta `from`/`to` como `yyyy-MM-dd` (días de Córdoba) o como instantes ISO
 * (ver `cordobaDayFromParam`). Si custom viene mal formado, cae al default.
 */
export function rangeFromSearchParams(params: Record<string, string | string[] | undefined>): {
  preset: DateRangePreset
  input: DateRangeInput
} {
  const rawPreset = Array.isArray(params.preset) ? params.preset[0] : params.preset
  const preset = parsePreset(rawPreset) ?? 'last7'

  if (preset === 'custom') {
    const rawFrom = Array.isArray(params.from) ? params.from[0] : params.from
    const rawTo = Array.isArray(params.to) ? params.to[0] : params.to
    const from = cordobaDayFromParam(rawFrom)
    const to = cordobaDayFromParam(rawTo)
    if (from && to) {
      return { preset, input: { preset: 'custom', from, to } }
    }
    return { preset: 'last7', input: { preset: 'last7' } }
  }

  return { preset, input: { preset } }
}

export function resolveFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
) {
  const { preset, input } = rangeFromSearchParams(params)
  return { preset, input, range: resolveDateRange(input, now) }
}
