/**
 * Con qué se cobró la seña de una reserva — PURO y testeado (`tests/lib/salon-deposit-method.test.ts`).
 *
 * Pedido de los socios (22/11/2026): «dar la posibilidad de seleccionar el medio de pago a las señas».
 * Son los mismos medios del punto de venta, con sus mismos nombres: así una seña por transferencia se
 * llama igual acá, en la cuenta y en la caja.
 *
 * `salon_reservations.deposit_method` es opcional: vacío quiere decir «no se anotó» (todas las señas
 * de antes, y las de una compra online, donde el medio se sabe por la compra). Sin seña no hay medio.
 */
import { METHOD_LABEL, type PayMethod } from '@/lib/pos/cash/types'

/** En el orden en que se ofrecen. Una seña casi siempre llega por transferencia: va primero. */
export const DEPOSIT_METHODS = [
  'transfer',
  'cash',
  'qr',
  'debit',
  'credit',
  'other',
] as const satisfies ReadonlyArray<PayMethod>

export type DepositMethod = (typeof DEPOSIT_METHODS)[number]

export const DEPOSIT_METHOD_LABELS: Readonly<Record<DepositMethod, string>> = METHOD_LABEL

/** Lo que viene de la base o de un formulario → un medio, o `null` si no dice nada que se entienda. */
export function parseDepositMethod(value: unknown): DepositMethod | null {
  return typeof value === 'string' && (DEPOSIT_METHODS as ReadonlyArray<string>).includes(value)
    ? (value as DepositMethod)
    : null
}

/** «Transferencia». `null` si no se anotó. */
export function depositMethodLabel(value: unknown): string | null {
  const method = parseDepositMethod(value)
  return method ? DEPOSIT_METHOD_LABELS[method] : null
}

/**
 * El medio que corresponde guardar con esa seña: sin seña no hay medio, por más que el formulario
 * todavía tenga uno elegido de antes.
 */
export function depositMethodForSave(depositCents: number, value: unknown): DepositMethod | null {
  return depositCents > 0 ? parseDepositMethod(value) : null
}

/** «$ 5.000 · Transferencia»: el medio pegado a un monto ya formateado. Sin medio, el monto solo. */
export function withDepositMethod(amount: string, value: unknown): string {
  const label = depositMethodLabel(value)
  return label ? `${amount} · ${label}` : amount
}
