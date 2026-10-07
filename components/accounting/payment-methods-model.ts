/**
 * La lógica pura de `PaymentMethodsEditor`: los medios de una orden de pago o
 * de un cobro (H.8, H.10) contra lo que hay que cubrir. Sin React, con tests.
 */

import { formatCents } from '@/lib/money/format'
import { hasAmount } from './entry-balance'

export type PaymentMethodLine = {
  key: string
  /** La caja, el banco o la billetera (`acc_treasury_accounts.id`). */
  treasuryAccountId: string | null
  amountCents: number | null
  /** Número de transferencia, de cheque o de liquidación. */
  reference?: string
}

export type PaymentMethodsStatus = 'empty' | 'balanced' | 'short' | 'over' | 'untargeted'

export type PaymentMethodsBalance = {
  status: PaymentMethodsStatus
  /** Σ importes de los medios. */
  assigned: bigint
  /** Lo que hay que cubrir, o `null` si no hay meta (pago a cuenta). */
  target: bigint | null
  /** Asignado − meta (negativo si falta). 0 sin meta. */
  diff: bigint
}

function toBigInt(value: number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(value < 0 ? -Math.round(-value) : Math.round(value))
}

/** Cuánto suman los medios y cómo están contra la meta. */
export function paymentMethodsBalance(
  lines: readonly PaymentMethodLine[],
  targetCents?: number | bigint | null,
): PaymentMethodsBalance {
  const assigned = lines.reduce((acc, line) => acc + toBigInt(line.amountCents), 0n)
  if (targetCents === null || targetCents === undefined) {
    return { status: assigned === 0n ? 'empty' : 'untargeted', assigned, target: null, diff: 0n }
  }
  const target = toBigInt(targetCents)
  const diff = assigned - target
  if (assigned === 0n && target === 0n) return { status: 'empty', assigned, target, diff }
  if (diff === 0n) return { status: 'balanced', assigned, target, diff }
  return { status: diff < 0n ? 'short' : 'over', assigned, target, diff }
}

/** «Falta asignar $ 240.000,00 a un medio» / «Sobran $ 1.000,00»; `null` si cubre o no hay meta. */
export function paymentMethodsGapText(balance: PaymentMethodsBalance): string | null {
  if (balance.status === 'short') return `Falta asignar ${formatCents(-balance.diff)} a un medio`
  if (balance.status === 'over') return `Sobran ${formatCents(balance.diff)}`
  return null
}

/** Lo que frena el envío cuando los medios tienen que cubrir la meta justo; `null` si se puede mandar. */
export function paymentMethodsBlockMessage(balance: PaymentMethodsBalance): string | null {
  if (balance.status === 'short') return `${paymentMethodsGapText(balance) ?? ''}.`
  if (balance.status === 'over') {
    return `Los medios suman ${formatCents(balance.diff)} más de lo que hay que cubrir. Revisá los importes.`
  }
  return null
}

/** Lo que precarga «Otro medio»: lo que falta para llegar a la meta (o vacío). */
export function remainderCents(
  lines: readonly PaymentMethodLine[],
  targetCents?: number | bigint | null,
): number | null {
  const balance = paymentMethodsBalance(lines, targetCents)
  if (balance.status !== 'short') return null
  const missing = -balance.diff
  return missing <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(missing) : null
}

export type SerializedPaymentMethod =
  | {
      type: 'treasury'
      treasuryAccountId: string | null
      amountCents: number | null
      reference: string | null
    }
  | { treasuryAccountId: string | null; amountCents: number | null; reference: string | null }

/**
 * El JSON del `hidden`: las líneas con algo cargado, sin keys. `payment` lleva
 * `type: 'treasury'` (`paymentSchema.methods`); `collection`, no
 * (`collectionSchema.received`).
 */
export function serializePaymentMethods(
  lines: readonly PaymentMethodLine[],
  shape: 'payment' | 'collection' = 'payment',
): SerializedPaymentMethod[] {
  return lines
    .filter((line) => line.treasuryAccountId !== null || hasAmount(line.amountCents))
    .map((line) => {
      const base = {
        treasuryAccountId: line.treasuryAccountId,
        amountCents: line.amountCents,
        reference: line.reference?.trim() ? line.reference.trim() : null,
      }
      return shape === 'payment' ? { type: 'treasury' as const, ...base } : base
    })
}
