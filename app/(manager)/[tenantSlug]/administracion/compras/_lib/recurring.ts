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

const STEP_MONTHS: Readonly<Record<RecurringFrequency, number>> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  yearly: 12,
}

/** El vencimiento número `count` contando desde el próximo (1 = el próximo). */
export function nthDue(
  nextDueDate: string,
  dueDay: number,
  frequency: RecurringFrequency,
  count: number,
): string {
  const steps = Math.max(0, Math.trunc(count) - 1) * STEP_MONTHS[frequency]
  return dueInMonth(addMonthsToYearMonth(monthOf(nextDueDate), steps), dueDay)
}

/**
 * Cuántos vencimientos faltan, contando el próximo, hasta el último
 * (`endsOn`). Por mes, como la base: 0 si el próximo cae después del último.
 */
export function duesUntil(
  nextDueDate: string,
  endsOn: string,
  frequency: RecurringFrequency,
): number {
  const months =
    (Number(endsOn.slice(0, 4)) - Number(nextDueDate.slice(0, 4))) * 12 +
    (Number(endsOn.slice(5, 7)) - Number(nextDueDate.slice(5, 7)))
  return months < 0 ? 0 : Math.floor(months / STEP_MONTHS[frequency]) + 1
}
