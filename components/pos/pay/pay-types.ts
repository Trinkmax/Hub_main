import {
  ArrowLeftRight,
  Banknote,
  CircleEllipsis,
  CreditCard,
  type LucideIcon,
  QrCode,
} from 'lucide-react'
import { formatCentsShort } from '@/lib/money'
import type { ActionResult } from '@/lib/pos/actions'
import type { AddDiscountInput } from '@/lib/pos/cash/actions'
import type {
  Bill,
  CloseTableResult,
  DiscountResult,
  PayMethod,
  PayResult,
  RemoveDiscountResult,
  RequestVoidResult,
  VoidPaymentResult,
} from '@/lib/pos/cash/types'
import type { ChargeInput } from '@/lib/pos/pay/charge'

/**
 * Lo que la pantalla de la cuenta puede hacer. La pantalla no sabe de dónde salen: la página las
 * conecta con las acciones de `lib/pos/cash/actions.ts` (que chequean quién sos y llaman a la base).
 * Todas devuelven lo mismo: salió bien con datos, o un mensaje que se puede resolver.
 */
export type PayActions = {
  /** Volver a leer la cuenta entera. */
  refresh: () => Promise<ActionResult<Bill>>
  pay: (input: ChargeInput) => Promise<ActionResult<PayResult>>
  /** Cerrar la mesa cuando ya no falta cobrar nada (la seña o un descuento cubrían todo). */
  closeTable: () => Promise<ActionResult<CloseTableResult>>
  voidPayment: (paymentId: string, why: string) => Promise<ActionResult<VoidPaymentResult>>
  addDiscount: (input: AddDiscountInput) => Promise<ActionResult<DiscountResult>>
  removeDiscount: (discountId: string) => Promise<ActionResult<RemoveDiscountResult>>
  /** Dar de baja un renglón, o pedir la baja si hace falta el OK. */
  requestVoid: (itemId: string, why: string | null) => Promise<ActionResult<RequestVoidResult>>
  /** «Todavía no la pidieron»: le saca a la mesa el aviso de cuenta. */
  unrequestBill: () => Promise<ActionResult>
}

export type Failure = { ok: false; message: string; code: string }

export const NO_SIGNAL: Failure = {
  ok: false,
  message: 'No hay señal: no se guardó. Probá de nuevo cuando vuelva.',
  code: 'network',
}

/** Llama a una acción y, si la llamada ni siquiera vuelve (sin señal), lo dice con un mensaje. */
export async function attempt<R extends { ok: boolean }>(
  call: () => Promise<R>,
): Promise<R | Failure> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return NO_SIGNAL
  try {
    return await call()
  } catch {
    return NO_SIGNAL
  }
}

export const METHOD_ICON: Readonly<Record<PayMethod, LucideIcon>> = {
  cash: Banknote,
  transfer: ArrowLeftRight,
  qr: QrCode,
  debit: CreditCard,
  credit: CreditCard,
  other: CircleEllipsis,
}

/** «$ 85.000»: la plata siempre en pesos, sin centavos. */
export const money = (cents: number): string => formatCentsShort(cents)

/** «−$ 16.500»: lo que baja de la cuenta. */
export const minus = (cents: number): string => formatCentsShort(-Math.abs(cents))
