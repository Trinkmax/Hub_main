/**
 * El tipo de cada día de la planilla de Ventas (reunión del 29/10/2026, min. 20:42 a 23:36): «dependiendo de
 * cómo le ponés el objetivo, que se catalogue en flojo, normal, fuerte». Es el revés de lo que había antes: acá
 * nadie elige el tipo, sale del objetivo escrito, comparado con el promedio de los días del mes que tienen objetivo.
 *
 * Puro: lo usa la planilla mientras se escribe y lo prueba `administracion-ventas-tipo-dia.test.ts`.
 */

import { NBSP } from '@/lib/money'

export const DAY_TYPES = ['none', 'low', 'normal', 'strong'] as const
export type DayType = (typeof DAY_TYPES)[number]

export const DAY_TYPE_LABELS: Readonly<Record<DayType, string>> = {
  none: 'Sin objetivo',
  low: 'Flojo',
  normal: 'Normal',
  strong: 'Fuerte',
}

/**
 * El margen es del 10 % desde el 05/11/2026: con el 20 %, noviembre de HUB daba cuatro días fuertes y ninguno flojo
 * (sus objetivos son parejos). En la reunión no se dijo ningún número; lo decidió Nacho.
 */

/** Por debajo de este porcentaje del promedio, el día es flojo. */
export const LOW_DAY_PERCENT = 90
/** Por arriba de este porcentaje del promedio, el día es fuerte. */
export const STRONG_DAY_PERCENT = 110

/** La regla, dicha una sola vez: va debajo de la planilla. */
export const DAY_TYPE_LEGEND = `Fuerte: 10${NBSP}% arriba del promedio. Flojo: 10${NBSP}% abajo.`

/** Cuántos días tienen objetivo y cuánto suman: con eso alcanza para el promedio, sin dividir. */
export type TargetStats = { count: number; sumCents: number }

function hasTarget(targetCents: number | null): targetCents is number {
  return targetCents !== null && Number.isFinite(targetCents) && targetCents > 0
}

export function targetStats(targets: Iterable<number | null>): TargetStats {
  let count = 0
  let sumCents = 0
  for (const target of targets) {
    if (!hasTarget(target)) continue
    count += 1
    sumCents += target
  }
  return { count, sumCents }
}

/**
 * Flojo, normal, fuerte o sin objetivo. Justo en el 90 % o en el 110 % todavía es normal («menor» y «mayor»).
 * Se compara sin dividir (objetivo × días × 100 contra suma × porcentaje): un promedio con decimales no puede
 * correr un día de tipo. Con los topes de la base (31 días de $ 10.000 millones) todo entra en un entero seguro.
 */
export function dayTypeOf(targetCents: number | null, stats: TargetStats): DayType {
  if (!hasTarget(targetCents) || stats.count === 0) return 'none'
  const scaled = targetCents * stats.count * 100
  if (scaled < stats.sumCents * LOW_DAY_PERCENT) return 'low'
  if (scaled > stats.sumCents * STRONG_DAY_PERCENT) return 'strong'
  return 'normal'
}

/** El tipo de cada día de un mes, por día. */
export function dayTypes(
  days: ReadonlyArray<{ day: string; targetCents: number | null }>,
): Record<string, DayType> {
  const stats = targetStats(days.map((d) => d.targetCents))
  const out: Record<string, DayType> = {}
  for (const d of days) out[d.day] = dayTypeOf(d.targetCents, stats)
  return out
}
