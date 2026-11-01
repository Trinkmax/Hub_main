import type { PaymentOption } from './types'

/**
 * La cuenta de una compra. Todo en centavos y POR PERSONA, como cobra el bar.
 * Cine y degustación en HUB: hasta noviembre de 2026, seña de $5.000 y
 * $30.000 en efectivo o $35.000 todo con Mercado Pago; desde las fechas nuevas
 * (pedido del 30/10), $45.000 con cualquier medio, seña de $20.000 y el resto
 * en el local.
 *
 *   seña  → hoy se paga deposit × personas; el resto, (precio en efectivo −
 *           deposit) × personas, el día de la función. Con precio en
 *           efectivo propio, ese resto es solo en efectivo; sin él, el precio
 *           es `price` para todo y el resto se paga como quiera.
 *   total → hoy se paga price × personas y no queda nada por pagar.
 *
 * La misma cuenta la hace la base al crear el pedido (ticketing_create_order):
 * esto es para mostrarla antes de pagar, nunca para cobrar.
 */

export type Quote = {
  option: PaymentOption
  partySize: number
  /** Lo que se cobra hoy por persona. */
  unitCents: number
  /** Lo que se cobra hoy. */
  totalCents: number
  /** Lo que queda para pagar el día de la función, por persona. */
  balancePerPersonCents: number
  /** Lo que queda para pagar el día de la función. */
  balanceCents: number
}

export function hasDepositOption(depositCents: number, priceCents: number): boolean {
  return depositCents > 0 && depositCents < priceCents
}

/**
 * Las formas de pago de una película. Sin seña siempre se puede pagar todo
 * (si no, no se vendería); con seña, el pago total se puede apagar.
 */
export function paymentOptions(input: {
  priceCents: number
  depositCents: number
  allowFullPayment: boolean
}): { deposit: boolean; full: boolean } {
  const deposit = hasDepositOption(input.depositCents, input.priceCents)
  return { deposit, full: input.allowFullPayment || !deposit }
}

/** Si el resto se paga solo en efectivo: pasa cuando hay precio en efectivo propio. */
export function balanceCashOnly(cashPriceCents: number | null | undefined): boolean {
  return cashPriceCents !== null && cashPriceCents !== undefined
}

/** Lo que sale por persona señando y pagando el resto en el bar. */
export function cashPrice(priceCents: number, cashPriceCents: number | null | undefined): number {
  return cashPriceCents ?? priceCents
}

export function quote(input: {
  priceCents: number
  depositCents: number
  /** Total por persona con seña + efectivo; sin él, `priceCents`. */
  cashPriceCents?: number | null
  partySize: number
  option: PaymentOption
}): Quote {
  const partySize = Math.max(1, Math.floor(input.partySize))
  const useDeposit =
    input.option === 'deposit' && hasDepositOption(input.depositCents, input.priceCents)
  const unitCents = useDeposit ? input.depositCents : input.priceCents
  const balancePerPersonCents = useDeposit
    ? Math.max(0, cashPrice(input.priceCents, input.cashPriceCents) - input.depositCents)
    : 0
  return {
    option: useDeposit ? 'deposit' : 'full',
    partySize,
    unitCents,
    totalCents: unitCents * partySize,
    balancePerPersonCents,
    balanceCents: balancePerPersonCents * partySize,
  }
}

const ARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/** $35.000 — sin decimales: el bar nunca cobra centavos. */
export function formatPesos(cents: number): string {
  return ARS.format(Math.round(cents / 100))
}

/** Pesos (como los escribe el dueño en el panel) → centavos. */
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

/** Centavos → pesos para el input del panel (el dueño nunca ve centavos). */
export function centsToPesos(cents: number): number {
  return Math.round(cents) / 100
}

/** Centavos → el número que espera Mercado Pago en `unit_price` (pesos). */
export function centsToMercadoPagoAmount(cents: number): number {
  return Math.round(cents) / 100
}

/** `transaction_amount` de Mercado Pago (pesos, con decimales) → centavos. */
export function mercadoPagoAmountToCents(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null
  return Math.round(amount * 100)
}
