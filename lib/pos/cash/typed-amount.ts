/**
 * Plata escrita a mano en la caja — PURO y testeado.
 *
 * En la caja casi nada se escribe: los cobros llegan solos y el arqueo se cuenta billete por
 * billete. Lo poco que sí se tipea (el cambio con el que se abre, un retiro, lo que queda para el
 * turno que sigue) es justo donde aparece el error clásico del bar: «129» por «129.000», o un cero
 * de más. Acá viven el campo en pesos enteros y la pregunta que lo frena.
 *
 * Mismo criterio que el resto del sistema (no se inventa otro):
 *   · con un monto contra el que comparar (lo que dejó el turno anterior), se pregunta si lo escrito
 *     queda a menos de la quinta parte o a más de cinco veces, como en «Precios»;
 *   · sin referencia, se pregunta por todo lo que no llega a $ 1.000, como al sumar puntos;
 *   · y si es más de lo que hay (sacar más plata de la que tiene el cajón), también.
 * Nunca bloquea: ofrece lo que se tipeó y lo que probablemente se quiso tipear.
 */
import { formatCentsShort, groupThousands } from '@/lib/money'

const PESO = 100

/** Hasta $ 999.999.999: sobra para un cajón y queda lejos del tope de la base. */
export const MAX_PESOS_DIGITS = 9

/** Menos de la quinta parte de la referencia, o más de cinco veces: se pregunta. */
const FACTOR = 5
/** Sin referencia, por debajo de esto casi seguro faltan los ceros. */
export const MISSING_ZEROS_BELOW_CENTS = 100_000
/** Hasta cuántos ceros de más o de menos se prueban. */
const MAX_SHIFT = 6

const LEADING_ZEROS = /^0+(?=\d)/

/** Solo los dígitos, sin ceros de adelante y cortado al máximo. */
export function pesosDigits(raw: string): string {
  return raw.replace(/\D/g, '').replace(LEADING_ZEROS, '').slice(0, MAX_PESOS_DIGITS)
}

/** Lo tipeado con los miles separados: «12500» → «12.500». */
export function formatPesosTyping(raw: string): string {
  return groupThousands(pesosDigits(raw))
}

/** Lo que quedó escrito → centavos. `null` si el campo está vacío (vacío no es cero). */
export function readPesos(text: string): number | null {
  const digits = pesosDigits(text)
  return digits === '' ? null : Number(digits) * PESO
}

/** Centavos → lo que se lee en el campo («12.500»). Al peso; la mitad redondea para arriba. */
export function pesosText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents) || cents < 0) return ''
  return groupThousands(String(Math.floor((cents + PESO / 2) / PESO)))
}

export type TypedCheck =
  | { kind: 'ok' }
  | {
      kind: 'ask'
      /**
       * `low`: muy por debajo de la referencia (faltan ceros) · `high`: muy por arriba (sobran) ·
       * `small`: no llega a $ 1.000 · `over`: es más de lo que hay.
       */
      why: 'low' | 'high' | 'small' | 'over'
      typedCents: number
      /** Lo que probablemente se quiso tipear, o `null` si no hay un candidato razonable. */
      suggestedCents: number | null
    }

export type TypedContext = {
  /** Contra qué comparar: lo que dejó el turno anterior, el cambio con el que se abrió hoy. */
  referenceCents?: number | null
  /** Lo máximo que tiene sentido (lo que tiene que haber en el cajón). No bloquea: pregunta. */
  capCents?: number | null
}

function plausible(candidateCents: number, referenceCents: number): boolean {
  return candidateCents * FACTOR >= referenceCents && candidateCents <= referenceCents * FACTOR
}

/** El candidato que queda más cerca de la referencia, en proporción. */
function closest(candidates: ReadonlyArray<number>, referenceCents: number): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate <= 0 || !plausible(candidate, referenceCents)) continue
    const distance = Math.abs(Math.log(candidate / referenceCents))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * ¿Lo que se escribió se toma sin preguntar? El cero y lo vacío no son de acá: cada formulario
 * decide si «sin cambio» vale.
 */
export function checkTypedAmount(cents: number, context: TypedContext = {}): TypedCheck {
  if (!Number.isFinite(cents) || cents <= 0) return { kind: 'ok' }
  const pesos = Math.round(cents / PESO)
  const cap = context.capCents
  const reference = context.referenceCents

  // Más de lo que hay: casi siempre es un cero de más.
  if (cap !== null && cap !== undefined && cap >= 0 && cents > cap) {
    let suggested: number | null = null
    for (let shift = 1; shift <= MAX_SHIFT; shift += 1) {
      const candidate = Math.floor(pesos / 10 ** shift) * PESO
      if (candidate <= 0) break
      if (candidate <= cap) {
        suggested = candidate
        break
      }
    }
    return { kind: 'ask', why: 'over', typedCents: cents, suggestedCents: suggested }
  }

  if (reference !== null && reference !== undefined && reference > 0) {
    if (cents === reference) return { kind: 'ok' }
    const low = cents * FACTOR < reference
    const high = cents > reference * FACTOR
    if (!low && !high) return { kind: 'ok' }
    const candidates: number[] = []
    for (let shift = 1; shift <= MAX_SHIFT; shift += 1) {
      const factor = 10 ** shift
      candidates.push((low ? pesos * factor : Math.floor(pesos / factor)) * PESO)
    }
    return {
      kind: 'ask',
      why: low ? 'low' : 'high',
      typedCents: cents,
      suggestedCents: closest(candidates, reference),
    }
  }

  if (cents < MISSING_ZEROS_BELOW_CENTS && cents % PESO === 0) {
    const suggested = cents * 1000
    // Si con los ceros se pasa de lo que hay, no se propone: solo se pregunta.
    const fits = cap === null || cap === undefined || suggested <= cap
    return {
      kind: 'ask',
      why: 'small',
      typedCents: cents,
      suggestedCents: fits ? suggested : null,
    }
  }
  return { kind: 'ok' }
}

/** La pregunta, como se lee en la pantalla: «¿$ 129 o $ 129.000?». */
export function typedQuestion(check: Extract<TypedCheck, { kind: 'ask' }>): string {
  const typed = formatCentsShort(check.typedCents)
  return check.suggestedCents === null
    ? `¿Seguro que ${typed}?`
    : `¿${typed} o ${formatCentsShort(check.suggestedCents)}?`
}
