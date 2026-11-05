import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from './dates'

/**
 * Pagar por transferencia cuando Mercado Pago rechaza. La transferencia no pasa por
 * ningún sistema: alguien del bar ve la plata en la cuenta y la confirma en el panel.
 * La compra se aprueba por el mismo camino que un pago de Mercado Pago (reserva, QR y
 * comprobante), con esta marca en lugar del medio de pago.
 *
 * Puro: lo usan el panel, la entrada y el comprobante.
 */
export const MANUAL_TRANSFER = 'manual_transfer'

export function isManualTransfer(paymentType: string | null | undefined): boolean {
  return paymentType === MANUAL_TRANSFER
}

/**
 * Siempre el mismo para una compra: confirmar dos veces no cuenta como un cobro doble, que
 * es lo que pasaría con dos números distintos.
 */
export function transferPaymentId(orderId: string): string {
  return `${MANUAL_TRANSFER}-${orderId}`
}

/**
 * Se puede confirmar mientras no esté paga ni anulada y la función no haya pasado. No
 * importa si el lugar ya se liberó: pudo vencerse mientras la persona transfería.
 */
export function canConfirmTransfer(
  order: { status: string; event_date: string },
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): boolean {
  if (order.status !== 'pending' && order.status !== 'rejected') return false
  return order.event_date >= formatInTimeZone(now, tz, 'yyyy-MM-dd')
}

/** El comentario de la reserva lo arma la base pensando en Mercado Pago. */
export function transferReservationComment(comment: string): string {
  return comment.replace('online con Mercado Pago', 'por transferencia')
}

export function voidedReservationComment(comment: string): string {
  return comment.replace(
    'Mercado Pago devolvió el pago de esta reserva.',
    'Se anuló la transferencia de esta reserva.',
  )
}
