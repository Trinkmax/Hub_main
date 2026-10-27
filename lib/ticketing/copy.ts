/**
 * Textos para la persona que compra. Puro y testeable.
 */

/**
 * Por qué Mercado Pago no aprobó el pago, en castellano y con qué hacer.
 * Los códigos son los `status_detail` de la API de pagos.
 */
export function rejectionReason(statusDetail: string | null | undefined): string {
  switch (statusDetail) {
    case 'cc_rejected_insufficient_amount':
      return 'La tarjeta no tiene saldo o límite suficiente. Probá con otra.'
    case 'cc_rejected_bad_filled_security_code':
      return 'El código de seguridad no es correcto.'
    case 'cc_rejected_bad_filled_date':
      return 'La fecha de vencimiento no es correcta.'
    case 'cc_rejected_bad_filled_card_number':
    case 'cc_rejected_bad_filled_other':
      return 'Revisá los datos de la tarjeta y probá de nuevo.'
    case 'cc_rejected_call_for_authorize':
      return 'Tu banco pide autorizar el pago: llamalos y probá de nuevo.'
    case 'cc_rejected_card_disabled':
      return 'La tarjeta está deshabilitada. Activala con tu banco o usá otra.'
    case 'cc_rejected_duplicated_payment':
      return 'Ya hiciste un pago igual hace un momento. Fijate en tu cuenta de Mercado Pago.'
    case 'cc_rejected_max_attempts':
      return 'Llegaste al límite de intentos con esa tarjeta. Probá con otra.'
    case 'cc_rejected_high_risk':
    case 'rejected_high_risk':
    case 'rejected_by_regulations':
      return 'Mercado Pago no aprobó el pago por seguridad. Probá con otro medio.'
    default:
      return 'Mercado Pago no aprobó el pago. Probá de nuevo o con otro medio.'
  }
}

/** «2 personas» / «1 persona». */
export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? 'persona' : 'personas'}`
}

/**
 * El link para reintentar el pago con la MISMA preferencia (mismo pedido,
 * mismo lugar guardado). Es el formato de `init_point` de Checkout Pro en
 * Argentina.
 */
export function checkoutUrl(preferenceId: string, live: boolean): string {
  const host = live ? 'https://www.mercadopago.com.ar' : 'https://sandbox.mercadopago.com.ar'
  return `${host}/checkout/v1/redirect?pref_id=${encodeURIComponent(preferenceId)}`
}
