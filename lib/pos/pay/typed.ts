/**
 * El cuidado de los ceros en la cuenta — PURO.
 *
 * Casi nada se escribe a mano al cobrar; lo poco que sí (otro monto, con cuánto paga, una propina,
 * un descuento en pesos) tiene el error de siempre: «129» por $ 129.000, o un cero de más. En la
 * caja de HUB ya pasó. La regla es la misma que usan los puntos (`suggestThousands`) y los precios
 * de la carta (`checkPriceJump`): si lo escrito queda fuera de lo razonable para ESE campo, no se
 * sigue sin preguntar, y se ofrece lo que probablemente se quiso escribir.
 *
 * Cada campo dice qué es razonable con una ventana (`lo`…`hi`) y qué directamente no se puede
 * (`min`…`max`). Todo en centavos; lo que se escribe son pesos enteros.
 */
import { formatCentsShort } from '@/lib/money'

/** Por debajo de $ 1.000, en un bar, casi siempre faltan los ceros. */
export const MISSING_ZEROS_BELOW_CENTS = 100_000

export type TypedWindow = {
  /** Lo razonable. Fuera de esto se pregunta. `hi: null` = sin techo. */
  lo: number
  hi: number | null
  /** Lo posible. Fuera de esto no se puede seguir con lo escrito. */
  min?: number
  max?: number | null
}

export type TypedVerdict =
  | { kind: 'empty' }
  | { kind: 'ok'; cents: number }
  | {
      kind: 'ask'
      cents: number
      /** `low`: parece que faltan ceros · `high`: parece que sobran. */
      why: 'low' | 'high'
      /** Lo que probablemente se quiso escribir, si hay un candidato razonable. */
      suggestedCents: number | null
      /** Si lo escrito se puede dejar tal cual (está dentro de lo posible). */
      canKeep: boolean
    }

function within(cents: number, lo: number, hi: number | null): boolean {
  return cents >= lo && (hi === null || cents <= hi)
}

function possible(cents: number, window: TypedWindow): boolean {
  return within(cents, window.min ?? 1, window.max ?? null)
}

/**
 * ¿Se sigue sin preguntar? Si faltan ceros se prueba con los miles (el error de verdad: decir
 * «ciento veintinueve» y escribir 129); si sobran, sacando de a un cero.
 */
export function judgeTyped(cents: number | null, window: TypedWindow): TypedVerdict {
  if (cents === null || !Number.isFinite(cents) || cents <= 0) return { kind: 'empty' }
  const canKeep = possible(cents, window)
  if (canKeep && within(cents, window.lo, window.hi)) return { kind: 'ok', cents }

  const low = cents < window.lo
  const pesos = Math.round(cents / 100)
  const candidates = low
    ? [pesos * 1000]
    : [10, 100, 1000].map((factor) => Math.floor(pesos / factor))
  const suggested = candidates
    .map((candidate) => candidate * 100)
    .find(
      (candidate) =>
        candidate > 0 && possible(candidate, window) && within(candidate, window.lo, window.hi),
    )
  return {
    kind: 'ask',
    cents,
    why: low ? 'low' : 'high',
    suggestedCents: suggested ?? null,
    canKeep,
  }
}

/** La pregunta, como se lee en la pantalla: «¿$ 129 o $ 129.000?». */
export function typedQuestion(verdict: Extract<TypedVerdict, { kind: 'ask' }>): string {
  const typed = formatCentsShort(verdict.cents)
  return verdict.suggestedCents === null
    ? `¿Seguro que ${typed}?`
    : `¿${typed} o ${formatCentsShort(verdict.suggestedCents)}?`
}

// ─── Qué es razonable en cada campo ──────────────────────────────────────────

/** «Otro monto»: una parte de lo que falta. Nunca más que lo que falta. */
export function amountWindow(remainingCents: number): TypedWindow {
  const max = Math.max(0, remainingCents)
  return { lo: Math.min(MISSING_ZEROS_BELOW_CENTS, max), hi: max, min: 100, max }
}

/**
 * «¿Con cuánto paga?»: por lo menos lo que tiene que pagar. Lo razonable llega hasta el triple, o
 * hasta redondear al billete más grande y uno más (pagar $ 1.500 con uno de $ 20.000 es normal;
 * pagar $ 47.000 con $ 500.000, no).
 */
export function tenderWindow(dueCents: number, denominations: ReadonlyArray<number>): TypedWindow {
  const biggest = Math.max(0, ...denominations.filter((value) => Number.isFinite(value))) * 100
  const rounded = biggest > 0 ? Math.ceil(dueCents / biggest) * biggest + biggest : 0
  return { lo: dueCents, hi: Math.max(dueCents * 3, rounded), min: dueCents, max: null }
}

/** La propina: entre medio punto y el 40 % de lo que se cobra (y nunca menos de $ 100 de piso). */
export function tipWindow(amountCents: number): TypedWindow {
  const lo = Math.max(10_000, Math.round(amountCents / 200 / 100) * 100)
  const hi = Math.max(lo, Math.round((amountCents * 0.4) / 100) * 100)
  return { lo, hi, min: 100, max: null }
}

/** Un descuento en pesos: desde medio punto del consumo hasta todo lo que falta. */
export function discountWindow(subtotalCents: number, remainingCents: number): TypedWindow {
  const max = Math.max(0, remainingCents)
  const lo = Math.min(max, Math.max(10_000, Math.round(subtotalCents / 200 / 100) * 100))
  return { lo, hi: max, min: 100, max }
}
