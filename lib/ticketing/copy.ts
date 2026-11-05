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

/** El WhatsApp de quien transfirió, con todo lo que hace falta para cargarle la reserva. */
export function transferProofMessage(input: {
  tenantName: string
  title: string
  dateLabel: string
  time: string
  partySize: number
  guestName: string
  amountLabel: string
  alias: string
  code: string
}): string {
  return (
    `¡Hola ${input.tenantName}! Mercado Pago me rechazó el pago, así que transferí ` +
    `${input.amountLabel} al alias ${input.alias}. Es para ${input.title}, ${input.dateLabel} ` +
    `a las ${input.time} hs, ${peopleLabel(input.partySize)}, a nombre de ${input.guestName} ` +
    `(entrada #${input.code}). Te paso el comprobante.`
  )
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

/** Con qué pagó, como lo dice una persona. */
export function paymentTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'credit_card':
      return 'Tarjeta de crédito'
    case 'debit_card':
      return 'Tarjeta de débito'
    case 'prepaid_card':
      return 'Tarjeta prepaga'
    case 'account_money':
      return 'Dinero en cuenta'
    default:
      return 'Mercado Pago'
  }
}

/**
 * «Ignacio Baldovino» → «Ignacio B.». La entrada se abre con su link y la imagen
 * se comparte: alcanza para reconocerse sin dejar el nombre completo dando vueltas.
 */
export function guestShortName(name: string): string {
  const [first = '', ...rest] = name.trim().split(/\s+/)
  const initial = rest.at(-1)?.charAt(0)
  return initial ? `${first} ${initial.toUpperCase()}.` : first
}

/** «Faltan 27 días» / «Es mañana» / «Es hoy». Una fecha pasada no dice nada. */
export function daysUntilLabel(date: string, today: string): string | null {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
  if (!Number.isFinite(days) || days < 0) return null
  if (days === 0) return 'Es hoy'
  if (days === 1) return 'Es mañana'
  return `Faltan ${days} días`
}
