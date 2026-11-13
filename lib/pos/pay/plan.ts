/**
 * Partes iguales — PURO.
 *
 * «Somos cuatro, dividimos.» Cada parte se cobra con su medio y lleva su rótulo («Parte 2 de 4»), que
 * es lo único que queda escrito del plan: con eso cualquier celular que abra la cuenta sabe en qué
 * parte va, y no hace falta guardar nada más.
 *
 * Las partes que faltan se reparten SIEMPRE lo que falta: si en el medio se aprueba un descuento o
 * se da algo de baja, lo que queda se vuelve a repartir parejo entre los que todavía no pagaron.
 */
import { partLabel, splitEqual } from '@/lib/pos/cash/bill'
import type { Payment } from '@/lib/pos/cash/types'

/** Más que esto no es dividir una mesa: es otra cosa. */
export const MAX_PARTS = 50

const PART_LABEL = /^Parte (\d+) de (\d+)$/

type PaymentLike = Pick<Payment, 'payer_label' | 'status' | 'created_at'>

export type EqualProgress = {
  /** En cuántas partes se venía dividiendo (el del último cobro por parte). `null` = no se dividió. */
  parts: number | null
  /** Cuántas partes ya se cobraron. */
  paid: number
  /** Los números de parte que ya están usados. */
  used: number[]
}

/** Lo que ya se cobró por partes iguales, leído de los rótulos de los cobros vigentes. */
export function equalProgress(payments: ReadonlyArray<PaymentLike>): EqualProgress {
  let parts: number | null = null
  let latest = ''
  const used: number[] = []
  for (const payment of payments) {
    if (payment.status !== 'ok') continue
    const match = PART_LABEL.exec(payment.payer_label ?? '')
    if (!match) continue
    const index = Number(match[1])
    const total = Number(match[2])
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1) continue
    used.push(index)
    if (parts === null || payment.created_at >= latest) {
      parts = total
      latest = payment.created_at
    }
  }
  return { parts, paid: used.length, used: used.sort((a, b) => a - b) }
}

/** Entre cuántos se puede dividir como mínimo: los que ya pagaron y uno más. */
export function minParts(payments: ReadonlyArray<PaymentLike>): number {
  return Math.max(2, equalProgress(payments).paid + 1)
}

export function clampParts(parts: number, payments: ReadonlyArray<PaymentLike>): number {
  const wanted = Number.isFinite(parts) ? Math.floor(parts) : 2
  return Math.min(Math.max(wanted, minParts(payments)), MAX_PARTS)
}

/**
 * Con cuántas partes arranca la división: los comensales de la mesa (o los de la reserva). Si ya se
 * venía dividiendo, sigue con esa cantidad.
 */
export function defaultParts(
  partySize: number | null | undefined,
  guests: number | null | undefined,
  payments: ReadonlyArray<PaymentLike>,
): number {
  const progress = equalProgress(payments)
  if (progress.parts !== null && progress.paid < progress.parts) {
    return clampParts(progress.parts, payments)
  }
  return clampParts(partySize || guests || 2, payments)
}

/**
 * Si la mesa se venía dividiendo en partes iguales y todavía falta alguna, en cuántas. `null` si no
 * hay un plan en curso (nadie pagó por partes, o ya pagaron todas).
 */
export function resumeParts(
  payments: ReadonlyArray<PaymentLike>,
  remainingCents: number,
): number | null {
  if (remainingCents <= 0) return null
  const progress = equalProgress(payments)
  if (progress.parts === null || progress.paid >= progress.parts) return null
  return clampParts(progress.parts, payments)
}

export type NextPart = {
  /** El número de la parte que se cobra ahora (1 = la primera). */
  index: number
  /** En cuántas se divide. */
  parts: number
  /** Cuántas quedan sin cobrar, contando esta. */
  left: number
  amountCents: number
  /** «Parte 2 de 4»: viaja con el cobro. */
  label: string
}

/** La parte que toca cobrar: lo que falta, repartido entre los que todavía no pagaron. */
export function nextPart(
  parts: number,
  payments: ReadonlyArray<PaymentLike>,
  remainingCents: number,
): NextPart {
  const progress = equalProgress(payments)
  const total = clampParts(parts, payments)
  const left = Math.max(1, total - progress.paid)
  // El primero que no esté usado: si se anuló la parte 2, la que sigue vuelve a ser la 2.
  let index = 1
  while (progress.used.includes(index)) index += 1
  index = Math.min(index, total)
  const [amount] = splitEqual(remainingCents, left)
  return {
    index,
    parts: total,
    left,
    amountCents: amount ?? Math.max(0, remainingCents),
    label: partLabel(index - 1, total),
  }
}

export type PartStub = { number: number; state: 'paid' | 'now' | 'todo' }

/** Los talones de la división, para mostrar el avance: los cobrados, el que toca y los que faltan. */
export function partStubs(parts: number, payments: ReadonlyArray<PaymentLike>): PartStub[] {
  const total = clampParts(parts, payments)
  const paid = Math.min(equalProgress(payments).paid, total)
  return Array.from({ length: total }, (_, i) => ({
    number: i + 1,
    state: i < paid ? 'paid' : i === paid ? 'now' : 'todo',
  }))
}
