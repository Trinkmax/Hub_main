/**
 * «Lo próximo» de la puesta en marcha en Ajustes y en «Listo» (rediseño de
 * octubre 2026), puro. Lo prueba `administracion-puesta-en-marcha.test.ts`.
 *
 * No hay una lista nueva: los pasos salen de `buildSetup` (`lib/accounting/home.ts`),
 * la MISMA función que arma la franja «Puesta en marcha · N de M» del Resumen.
 * Acá solo se filtran los que se hacen en esta área, en su orden: el mismo
 * paso se llama igual, dice lo mismo y lleva al mismo lugar en las dos
 * pantallas. La lista completa sigue siendo «Cómo arrancar», y el «N de M» se
 * dice una sola vez, en el Resumen.
 */

import type { SetupStep, SetupStrip } from '@/lib/accounting/home'

/** Los pasos de `buildSetup` que se resuelven en Ajustes o en la puesta en marcha. */
export const CONFIG_STEP_IDS = [
  'opening',
  'sas_data',
  'treasuries',
  'sales_methods',
  'platforms',
  'sales_points',
  'access',
  'arca',
] as const
export type ConfigStepId = (typeof CONFIG_STEP_IDS)[number]

const CONFIG_IDS: ReadonlySet<string> = new Set(CONFIG_STEP_IDS)

/** Los pasos de esta área, en el orden en que los da `buildSetup` (hechos y pendientes). */
export function configSteps(strip: Pick<SetupStrip, 'steps'>): SetupStep[] {
  return strip.steps.filter((step) => CONFIG_IDS.has(step.id))
}

/** Lo que hace que los números sean de verdad: si falta, la portada lo pide en grande. */
export type SetupFacts = {
  /** Faltan los saldos iniciales. */
  openingPending: boolean
  /** La SAS no tiene CUIT. */
  cuitMissing: boolean
  /** No hay ningún medio de cobro prendido (no se puede cargar el cierre). */
  noMethods: boolean
}

export type SetupNextView =
  /** Falta algo que deforma los números: un paso en grande y los dos que siguen. */
  | { kind: 'urgent'; step: SetupStep; after: SetupStep[] }
  /** Solo queda lo que puede esperar: una línea con hasta tres. */
  | { kind: 'later'; steps: SetupStep[]; more: number }
  | { kind: 'complete' }

const AFTER_MAX = 2
const LATER_MAX = 3

/**
 * Qué muestra el bloque «Puesta en marcha» de la portada. Lo urgente es, en
 * este orden: los saldos iniciales, la CUIT y que haya algún medio de cobro.
 * Lo demás (el resto de la constancia, el banco, las comisiones, los puntos de
 * venta, la contadora, ARCA) puede esperar: no sostiene un cartel de «falta».
 */
export function setupNextView(steps: readonly SetupStep[], facts: SetupFacts): SetupNextView {
  const pending = steps.filter((s) => !s.done)
  if (pending.length === 0) return { kind: 'complete' }
  const urgentIds: ConfigStepId[] = []
  if (facts.openingPending) urgentIds.push('opening')
  if (facts.cuitMissing) urgentIds.push('sas_data')
  if (facts.noMethods) urgentIds.push('sales_methods')
  const step = urgentIds
    .map((id) => pending.find((s) => s.id === id))
    .find((s): s is SetupStep => s !== undefined)
  if (step) {
    return { kind: 'urgent', step, after: pending.filter((s) => s !== step).slice(0, AFTER_MAX) }
  }
  return {
    kind: 'later',
    steps: pending.slice(0, LATER_MAX),
    more: Math.max(0, pending.length - LATER_MAX),
  }
}

/** A dónde lleva un paso (los de esta área siempre son un link; `null` si no trae acción). */
export function stepHref(step: Pick<SetupStep, 'action'>): string | null {
  return step.action?.kind === 'href' ? step.action.href : null
}

/** «Lo próximo» de la pantalla «Listo»: hasta tres pendientes, con su link. */
export function doneNextSteps(steps: readonly SetupStep[], max = 3): SetupStep[] {
  return steps.filter((s) => !s.done && stepHref(s) !== null).slice(0, Math.max(0, max))
}
