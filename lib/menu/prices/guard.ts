/**
 * El cuidado de los ceros, puro. El error clásico al cambiar un precio a mano es tipear «12»
 * por «12.000» (o un cero de más): si el precio nuevo queda a menos de la quinta parte del
 * anterior o a más de cinco veces, no se guarda sin preguntar. Se ofrecen dos botones: lo que
 * se tipeó y lo que probablemente se quiso tipear.
 */

import { formatCentsShort } from '@/lib/money'

/** Menos del 20 % del precio anterior… */
const LOW_FACTOR = 5
/** …o más de 5 veces: se pregunta. */
const HIGH_FACTOR = 5
/** Hasta cuántos ceros de más o de menos se prueban. */
const MAX_SHIFT = 6

export type PriceJump =
  | { kind: 'ok' }
  | {
      kind: 'confirm'
      /** `low`: quedó muy por debajo (faltan ceros) · `high`: muy por arriba (sobran). */
      why: 'low' | 'high'
      typedCents: number
      /** Lo que probablemente se quiso tipear, o `null` si no hay un candidato razonable. */
      suggestedCents: number | null
    }

function isPlausible(candidateCents: number, oldCents: number): boolean {
  return candidateCents * LOW_FACTOR >= oldCents && candidateCents <= oldCents * HIGH_FACTOR
}

/** El candidato que queda más cerca del precio anterior, en proporción. */
function closest(candidates: number[], oldCents: number): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate <= 0 || !isPlausible(candidate, oldCents)) continue
    const distance = Math.abs(Math.log(candidate / oldCents))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * ¿Se guarda sin preguntar? Sin precio anterior (o en cero) no hay contra qué comparar y
 * siempre se guarda.
 */
export function checkPriceJump(oldCents: number | null, newCents: number): PriceJump {
  if (oldCents === null || oldCents <= 0 || newCents === oldCents) return { kind: 'ok' }
  const low = newCents * LOW_FACTOR < oldCents
  const high = newCents > oldCents * HIGH_FACTOR
  if (!low && !high) return { kind: 'ok' }

  // Los candidatos se arman en pesos enteros: agregando ceros o sacando las últimas cifras.
  const typedPesos = Math.round(newCents / 100)
  const candidates: number[] = []
  for (let shift = 1; shift <= MAX_SHIFT; shift++) {
    const factor = 10 ** shift
    candidates.push((low ? typedPesos * factor : Math.floor(typedPesos / factor)) * 100)
  }
  return {
    kind: 'confirm',
    why: low ? 'low' : 'high',
    typedCents: newCents,
    suggestedCents: closest(candidates, oldCents),
  }
}

/** La pregunta, como se lee en la pantalla: «¿$ 12 o $ 12.000?». */
export function guardQuestion(jump: Extract<PriceJump, { kind: 'confirm' }>): string {
  const typed = formatCentsShort(jump.typedCents)
  return jump.suggestedCents === null
    ? `¿Seguro que ${typed}?`
    : `¿${typed} o ${formatCentsShort(jump.suggestedCents)}?`
}
