import {
  type DateRangeInput,
  type DateRangePreset,
  parsePreset,
  resolveDateRange,
} from './date-range'

/**
 * Construye un DateRangeInput a partir de los searchParams de Next.js.
 * - `?preset=today|last7|last30|this_month|last_month` → preset directo
 * - `?preset=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` → custom
 * - Default: `last7`.
 *
 * Acepta `from`/`to` como ISO date strings o `yyyy-MM-dd`. Si custom viene mal
 * formado, cae al default.
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
    const from = rawFrom ? new Date(rawFrom) : null
    const to = rawTo ? new Date(rawTo) : null
    if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { preset, input: { preset: 'custom', from, to } }
    }
    return { preset: 'last7', input: { preset: 'last7' } }
  }

  return { preset, input: { preset } }
}

export function resolveFromSearchParams(params: Record<string, string | string[] | undefined>) {
  const { preset, input } = rangeFromSearchParams(params)
  return { preset, input, range: resolveDateRange(input) }
}
