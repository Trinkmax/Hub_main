/**
 * El período de las listas de Compras (`?periodo=`), validado como en los
 * reportes (fechas reales, desde ≤ hasta, hasta 400 días: lo mismo que acepta
 * el exporte). Puro.
 */

import {
  addDays,
  formatIsoDay,
  type Period,
  periodErrorMessage,
  periodRange,
  presetPeriod,
  resolvePeriod,
  serializePeriod,
} from '@/lib/dates'

/** Lo mismo que acepta el exporte CSV (F.15). */
export const MAX_PERIOD_DAYS = 400

export type ListPeriodChipKey = 'este-mes' | 'mes-pasado' | 'ultimos-90' | 'este-anio'

export type PeriodChip = {
  key: string
  label: string
  /** El período serializado (`2026-10`, `2026-08-01..2026-10-31`). */
  value: string
}

export type ListPeriod = {
  from: string
  to: string
  /**
   * El período serializado para un link (`?periodo=`), o `null` si es el de por
   * defecto (no hace falta escribirlo).
   */
  param: string | null
  chips: PeriodChip[]
  /** El chip activo, o `null` si es un rango elegido a mano. */
  active: string | null
  /** «Del 01/10/2026 al 31/10/2026». */
  label: string
  /** Si el período de la URL no servía: por qué (se muestra y se usa el de por defecto). */
  error: string | null
}

const CHIP_LABELS: Readonly<Record<ListPeriodChipKey, string>> = {
  'este-mes': 'Este mes',
  'mes-pasado': 'Mes pasado',
  'ultimos-90': 'Últimos 90 días',
  'este-anio': 'Este año',
}

function chipPeriod(key: ListPeriodChipKey, today: string): Period {
  switch (key) {
    case 'este-mes':
      return presetPeriod('este-mes', { today })
    case 'mes-pasado':
      return presetPeriod('mes-pasado', { today })
    case 'ultimos-90':
      return { kind: 'range', from: addDays(today, -89), to: today }
    case 'este-anio':
      return { kind: 'range', from: `${today.slice(0, 4)}-01-01`, to: today }
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function resolveListPeriod(
  sp: Readonly<Record<string, string | string[] | undefined>>,
  opts: { today: string; chips: readonly ListPeriodChipKey[]; fallback: ListPeriodChipKey },
): ListPeriod {
  const chips: PeriodChip[] = opts.chips.map((key) => ({
    key,
    label: CHIP_LABELS[key],
    value: serializePeriod(chipPeriod(key, opts.today)),
  }))
  const fallback = chipPeriod(opts.fallback, opts.today)
  const resolved = resolvePeriod(
    {
      periodo: first(sp.periodo),
      mes: first(sp.mes),
      desde: first(sp.desde),
      hasta: first(sp.hasta),
    },
    { today: opts.today, maxDays: MAX_PERIOD_DAYS, fallback },
  )
  const period = resolved.ok ? resolved.period : fallback
  const range = resolved.ok ? { from: resolved.from, to: resolved.to } : periodRange(fallback)
  const value = serializePeriod(period)
  const active = chips.find((c) => c.value === value)?.value ?? null
  return {
    from: range.from,
    to: range.to,
    param: value === serializePeriod(fallback) ? null : value,
    chips,
    active,
    label:
      range.from === range.to
        ? `El ${formatIsoDay(range.from)}`
        : `Del ${formatIsoDay(range.from)} al ${formatIsoDay(range.to)}`,
    error: resolved.ok ? null : periodErrorMessage(resolved.error, { maxDays: MAX_PERIOD_DAYS }),
  }
}

/** «octubre de 2026» o «este período», para los textos de vacío. */
export function periodPhrase(p: Pick<ListPeriod, 'active' | 'chips' | 'from' | 'to'>): string {
  const chip = p.chips.find((c) => c.value === p.active)
  if (chip?.key === 'este-mes') return 'este mes'
  if (chip?.key === 'mes-pasado') return 'el mes pasado'
  if (chip?.key === 'ultimos-90') return 'los últimos 90 días'
  if (chip?.key === 'este-anio') return 'este año'
  return 'este período'
}
