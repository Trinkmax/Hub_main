/**
 * «Armar el objetivo»: para el bar que no tiene su planilla. Se dice cuánto se
 * quiere vender en el mes y qué días son fuertes, y esto lo reparte día por
 * día. Puro: lo prueba `administracion-ventas-objetivo.test.ts`.
 *
 * Es una cuenta, no un pronóstico: los pesos son fijos y enteros (con decimales
 * `allocateCents` los redondea, y «Flojo» valdría lo mismo que «Normal»). Se
 * reparte en unidades de $ 1.000 para que cada día quede en un número redondo;
 * lo que no llega al millar va al último día fuerte, así la suma da exacta.
 */

import { allocateCents } from '@/lib/accounting/home'
import { daysInMonth, isRealYearMonth, toIsoDay, weekdayOf } from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

export const TARGET_LEVELS = ['closed', 'low', 'normal', 'strong'] as const
export type TargetLevel = (typeof TARGET_LEVELS)[number]

export const LEVEL_LABELS: Readonly<Record<TargetLevel, string>> = {
  closed: 'Cerrado',
  low: 'Flojo',
  normal: 'Normal',
  strong: 'Fuerte',
}

/** Cuánto pesa cada tipo de día en el reparto. Enteros a propósito. */
export const LEVEL_WEIGHTS: Readonly<Record<TargetLevel, number>> = {
  closed: 0,
  low: 6,
  normal: 10,
  strong: 16,
}

/** El tipo de cada día de la semana: 0 = domingo … 6 = sábado (como `weekdayOf`). */
export type WeekPlan = Readonly<Record<number, TargetLevel>>

/** De lunes a jueves normal, viernes y sábado fuerte, domingo normal. */
export const DEFAULT_WEEK_PLAN: WeekPlan = {
  0: 'normal',
  1: 'normal',
  2: 'normal',
  3: 'normal',
  4: 'normal',
  5: 'strong',
  6: 'strong',
}

/** Lunes primero: el bar piensa la semana de lunes a domingo. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]

/** El objetivo de cada día queda en múltiplos de $ 1.000. */
const UNIT_CENTS = 100_000

export type BuiltTarget = { day: string; targetCents: number | null }

export type BuiltTargets = {
  /** Un ítem por día del mes, listo para `saveSalesTargets`. `null` = sin objetivo. */
  items: BuiltTarget[]
  /** Σ de los objetivos: igual a lo pedido, salvo que todos los días estén cerrados. */
  totalCents: number
  /** Días que quedan con objetivo. */
  days: number
}

function levelOf(plan: WeekPlan, day: string): TargetLevel {
  return plan[weekdayOf(day)] ?? 'normal'
}

/**
 * Reparte `totalCents` entre los días de `month` (`yyyy-MM`) según `plan`. Un
 * día «Cerrado» queda sin objetivo. Con el total en cero, o con todos los días
 * cerrados, ningún día tiene objetivo.
 */
export function buildTargets(input: {
  month: string
  totalCents: number | null
  plan: WeekPlan
}): BuiltTargets {
  const { month, plan } = input
  if (!isRealYearMonth(month)) return { items: [], totalCents: 0, days: 0 }
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const days = Array.from({ length: daysInMonth(year, monthNumber) }, (_, i) =>
    toIsoDay(year, monthNumber, i + 1),
  )
  const weights = days.map((day) => LEVEL_WEIGHTS[levelOf(plan, day)])
  const total =
    input.totalCents !== null && Number.isFinite(input.totalCents)
      ? Math.max(0, Math.trunc(input.totalCents))
      : 0
  if (total === 0 || weights.every((w) => w === 0)) {
    return { items: days.map((day) => ({ day, targetCents: null })), totalCents: 0, days: 0 }
  }

  const units = Math.floor(total / UNIT_CENTS)
  const cents = allocateCents(units, weights).map((u) => u * UNIT_CENTS)
  // Lo que no llega al millar va al último día fuerte (o, si no hay, al último del tipo que más pesa).
  const rest = total - units * UNIT_CENTS
  if (rest > 0) {
    const heaviest = Math.max(...weights)
    const last = weights.lastIndexOf(heaviest)
    cents[last] = (cents[last] ?? 0) + rest
  }

  const items = days.map((day, i): BuiltTarget => {
    const value = cents[i] ?? 0
    return { day, targetCents: value > 0 ? value : null }
  })
  return {
    items,
    totalCents: items.reduce((sum, item) => sum + (item.targetCents ?? 0), 0),
    days: items.filter((item) => item.targetCents !== null).length,
  }
}

/**
 * «Venís vendiendo unos $ 1.265.000 por noche: a ese ritmo, el mes cierra
 * cerca de $ 39.200.000.» Es una cuenta (promedio × días del mes), y lo dice.
 * `null` si el mes todavía no tiene cierres.
 */
export function paceHint(input: { averageCents: number | null; month: string }): string | null {
  const { averageCents, month } = input
  if (averageCents === null || averageCents <= 0 || !isRealYearMonth(month)) return null
  const count = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  const round = (cents: number, step: number) => Math.round(cents / step) * step
  const perNight = round(averageCents, 100_000)
  const projected = round(averageCents * count, 10_000_000)
  return `Venís vendiendo unos ${formatCentsShort(perNight)} por noche: a ese ritmo, el mes cierra cerca de ${formatCentsShort(projected)}.`
}
