/**
 * Gastos fijos (H.7), lo puro del formulario. Lo prueba
 * `administracion-compras.test.ts`.
 */

import { addMonthsToYearMonth, daysInMonth, monthOf, toIsoDay } from '@/lib/dates'

export const RECURRING_FREQUENCIES = [
  { value: 'monthly', label: 'Todos los meses' },
  { value: 'bimonthly', label: 'Cada 2 meses' },
  { value: 'quarterly', label: 'Cada 3 meses' },
  { value: 'yearly', label: 'Una vez por año' },
] as const

export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]['value']

export function isRecurringFrequency(value: unknown): value is RecurringFrequency {
  return RECURRING_FREQUENCIES.some((f) => f.value === value)
}

/** El día `dueDay` de un mes (`yyyy-MM`), ajustado a los meses cortos (31 → 30 o 28). */
export function dueInMonth(yearMonth: string, dueDay: number): string {
  const year = Number(yearMonth.slice(0, 4))
  const month = Number(yearMonth.slice(5, 7))
  const day = Math.min(Math.max(1, Math.trunc(dueDay)), daysInMonth(year, month))
  return toIsoDay(year, month, day)
}

/**
 * El próximo vencimiento a partir de hoy: el día `dueDay` de este mes si
 * todavía no pasó (hoy cuenta), si no el del mes que viene.
 */
export function nextDueFrom(today: string, dueDay: number): string {
  const thisMonth = dueInMonth(monthOf(today), dueDay)
  return thisMonth >= today
    ? thisMonth
    : dueInMonth(addMonthsToYearMonth(monthOf(today), 1), dueDay)
}
