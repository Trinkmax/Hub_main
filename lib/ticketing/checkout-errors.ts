/**
 * Qué le dice la entrada a la persona cuando la compra no arranca. Módulo puro
 * (sin 'use server') para poder probarlo: lo usa startCheckout.
 */

export type CheckoutResult =
  | { ok: true; redirectUrl: string; orderId: string }
  | {
      ok: false
      message: string
      field?: string
      seatsLeft?: number
      /** El bar frenó la venta de esa fecha mientras la persona la tenía abierta. */
      paused?: true
      /**
       * Falló algo nuestro (la base, Mercado Pago), no un dato de la persona:
       * la entrada ofrece escribir por WhatsApp para no perder la reserva.
       */
      unexpected?: true
    }

function seatsMessage(left: number): string {
  if (left <= 0) return 'Se acaban de agotar los lugares de esta fecha. Probá con otra.'
  if (left === 1) return 'Queda solo 1 lugar para esta fecha.'
  return `Quedan solo ${left} lugares para esta fecha.`
}

const UNEXPECTED_MESSAGE =
  'No pudimos guardar tu lugar. Probá de nuevo en un minuto o escribinos y te lo reservamos.'

/**
 * Lo que dice la entrada cuando la base no guarda el lugar. Cada motivo con su
 * campo, y «ya no está a la venta» SOLO cuando es cierto: antes era el mensaje
 * para cualquier error, y un teléfono que la base rechazaba («+0351…») le
 * decía a la gente que la función no se vendía y la mandaba a elegir otra
 * fecha (17/11/2026, El Grinch del 13/12 con 44 lugares libres).
 */
export function createOrderErrorMessage(message: string, details: string | null): CheckoutResult {
  if (message.includes('ticketing_not_enough_seats')) {
    const left = Number.parseInt(details ?? '0', 10)
    const seatsLeft = Number.isFinite(left) ? Math.max(0, left) : 0
    return { ok: false, message: seatsMessage(seatsLeft), field: 'party_size', seatsLeft }
  }
  if (message.includes('ticketing_event_paused')) {
    return {
      ok: false,
      message: 'Esta fecha todavía no está a la venta. Elegí otra.',
      field: 'event_id',
      paused: true,
    }
  }
  if (message.includes('ticketing_event_started')) {
    return { ok: false, message: 'Esta función ya empezó. Elegí otra fecha.', field: 'event_id' }
  }
  if (message.includes('ticketing_invalid_party_size')) {
    return { ok: false, message: 'Elegí cuántas personas van.', field: 'party_size' }
  }
  if (message.includes('ticketing_invalid_option')) {
    return { ok: false, message: 'Elegí cómo querés pagar.', field: 'option' }
  }
  if (message.includes('ticketing_too_many_holds')) {
    return {
      ok: false,
      message:
        'Ya tenés otras reservas esperando el pago. Terminá esas o esperá unos minutos y probá de nuevo.',
    }
  }
  if (
    message.includes('ticketing_event_unavailable') ||
    message.includes('ticketing_experience_unavailable')
  ) {
    return {
      ok: false,
      message: 'Esta función ya no está a la venta. Elegí otra fecha.',
      field: 'event_id',
    }
  }
  if (message.includes('guest_phone')) {
    return {
      ok: false,
      message: 'Revisá tu WhatsApp: escribilo con la característica, por ejemplo 351 555 1234.',
      field: 'guest_phone',
    }
  }
  if (message.includes('guest_name')) {
    return { ok: false, message: 'Escribí el nombre de la reserva.', field: 'guest_name' }
  }
  return { ok: false, message: UNEXPECTED_MESSAGE, unexpected: true }
}
