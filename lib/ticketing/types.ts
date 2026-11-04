import type { TicketQr } from './ticket-art'

/**
 * Tipos de las entradas online (Cine y degustación y cualquier otro formato
 * del calendario que el bar ponga a la venta).
 *
 * Espejan supabase/migrations/20261026120100_ticketing_tables.sql. Los
 * «Public*» son lo que viaja a las páginas públicas: serializable, sin ids
 * internos de más y sin nada de la cuenta de Mercado Pago.
 */

export type PaymentOption = 'deposit' | 'full'

export type OrderStatus = 'pending' | 'rejected' | 'approved' | 'refunded'

export type OrderAttention =
  | 'overbooked'
  | 'event_missing'
  | 'amount_mismatch'
  | 'duplicate_payment'

/** Un paso del menú: «Paso 03 · Cajita Medieval». */
export type ExperienceStep = {
  icon: string | null
  title: string
  description: string | null
  /** Rótulo propio («Final · Postre»). Sin rótulo, «Paso NN». */
  label: string | null
}

export type GalleryKind = 'scene' | 'venue'

export type GalleryItem = {
  url: string
  caption: string | null
  /** scene = de la película · venue = foto real de una función en el bar. */
  kind: GalleryKind
}

export type ExperienceRow = {
  id: string
  tenant_id: string
  template_id: string
  slug: string
  published: boolean
  series: string | null
  title: string
  tagline: string | null
  synopsis: string | null
  schedule_note: string | null
  poster_url: string | null
  hero_url: string | null
  /** Imagen de previsualización (la de la cartelera). null = poster_url. */
  card_image_url: string | null
  /** Link de un video de YouTube (un Short) que muestra la experiencia. */
  video_url: string | null
  accent_hex: string | null
  steps: unknown
  steps_note: string | null
  gallery: unknown
  price_cents: number
  deposit_cents: number
  /** Total por persona con seña + efectivo en el bar. null = price_cents. */
  cash_price_cents: number | null
  /** Si se puede pagar todo online. En false se reserva solo con seña. */
  allow_full_payment: boolean
  min_party_size: number
  max_party_size: number
  /** Aclaración del precio en la entrada: «Incluye todos los pasos de la película». */
  price_note: string | null
  terms: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type TicketOrderRow = {
  id: string
  tenant_id: string
  experience_id: string | null
  scheduled_event_id: string | null
  title: string
  event_date: string
  event_time: string
  meal_type: string
  party_size: number
  payment_option: PaymentOption
  unit_price_cents: number
  full_price_cents: number
  total_cents: number
  /** El resto se paga solo en efectivo (foto del pedido). */
  balance_cash_only: boolean
  guest_name: string
  guest_phone: string
  marketing_opt_in: boolean
  status: OrderStatus
  hold_expires_at: string
  mp_preference_id: string | null
  mp_payment_id: string | null
  mp_status: string | null
  mp_status_detail: string | null
  mp_payment_type: string | null
  /** Las condiciones de la película al comprar (foto). */
  terms: string | null
  paid_cents: number | null
  paid_at: string | null
  reservation_id: string | null
  customer_id: string | null
  attention: OrderAttention | null
  created_at: string
  updated_at: string
}

/** Lo que el panel puede leer de la configuración (sin token ni clave). */
export type TicketingSettingsView = {
  tenant_id: string
  mp_user_id: number | null
  mp_nickname: string | null
  mp_live: boolean | null
  mp_connected_at: string | null
  online_manager_id: string | null
  hold_minutes: number
  headline: string | null
  intro: string | null
  venue_address: string | null
  contact_whatsapp: string | null
  transfer_alias: string | null
  transfer_holder: string | null
  updated_at: string | null
}

export type FunctionState = 'available' | 'last' | 'sold_out'

/** Una función (fecha) a la venta, con su disponibilidad. */
export type PublicFunction = {
  eventId: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  time: string
  capacity: number
  left: number
  state: FunctionState
}

export type PublicExperience = {
  id: string
  slug: string
  title: string
  series: string | null
  tagline: string | null
  synopsis: string | null
  scheduleNote: string | null
  posterUrl: string | null
  heroUrl: string | null
  /** Imagen de previsualización (cartelera, «Por fecha», «También en cartelera»); null = posterUrl. */
  cardUrl: string | null
  /** Link de YouTube tal como lo cargó el bar (la página saca el id). */
  videoUrl: string | null
  accent: string
  steps: ExperienceStep[]
  stepsNote: string | null
  gallery: GalleryItem[]
  priceCents: number
  depositCents: number
  /**
   * Total por persona si señá y paga el resto en efectivo. null = un solo
   * precio para cualquier medio, y el resto se paga como quiera.
   */
  cashPriceCents: number | null
  /** Si se puede pagar todo online (HUB desde el 01/11: no, solo seña). */
  allowFullPayment: boolean
  /** Desde cuántas personas se vende (Cine y degustación: 2). */
  minPartySize: number
  maxPartySize: number
  /** Lo que aclara el precio («Incluye todos los pasos de la película»), o null. */
  priceNote: string | null
  terms: string | null
  functions: PublicFunction[]
  /** Sin publicar: solo aparece en la vista previa del dueño. */
  draft?: boolean
}

export type PublicVenue = {
  tenantId: string
  tenantSlug: string
  tenantName: string
  logoUrl: string | null
  headline: string | null
  intro: string | null
  address: string | null
  whatsapp: string | null
  /** A dónde transferir si Mercado Pago rechaza el pago. */
  transfer: TransferAccount | null
  /** Hay cuenta de Mercado Pago conectada: se puede pagar online. */
  canSell: boolean
  holdMinutes: number
}

/** La cuenta del bar para pagar por transferencia. */
export type TransferAccount = {
  alias: string
  /** «Mi Bar S.A.S., CUIT 30-…»: para que quien transfiere sepa que es la cuenta correcta. */
  holder: string | null
}

/** La entrada del cliente (/entradas/<bar>/mi-entrada/<pedido>). */
export type PublicOrder = {
  id: string
  shortCode: string
  status: OrderStatus
  /** pending/rejected con el lugar ya vencido. */
  expired: boolean
  holdExpiresAt: string
  title: string
  date: string
  time: string
  partySize: number
  option: PaymentOption
  unitPriceCents: number
  fullPriceCents: number
  totalCents: number
  /** El resto se paga solo en efectivo. */
  balanceCashOnly: boolean
  paidCents: number | null
  guestFirstName: string
  experienceSlug: string | null
  posterUrl: string | null
  accent: string
  /** La aclaración del precio de la película, o null. */
  priceNote: string | null
  mpStatusDetail: string | null
  /** Volver a Mercado Pago con el mismo pedido (si el lugar sigue guardado). */
  retryUrl: string | null
  /** «Ignacio B.»: el nombre en el comprobante. */
  guestShortName: string
  /** El número de operación de Mercado Pago, para el comprobante. */
  mpPaymentId: string | null
  /** Con qué pagó (`payment_type` de Mercado Pago). */
  mpPaymentType: string | null
  /** «03/11/2026 13:55», ya en el huso del bar. */
  paidAtLabel: string | null
  /** Las condiciones que aceptó al pagar (foto del pedido). Compras viejas: sin condiciones. */
  terms: string | null
  /** Hoy en el bar (día de servicio): para saber si la función es hoy o ya pasó. */
  today: string
  /** Quiénes ya entraron: sale de la reserva. */
  entry: OrderEntry
  /** El QR de la puerta. Solo si la entrada está paga y todavía sirve. */
  qr: TicketQr | null
  /** Entrada de muestra: no es una compra de verdad y el comprobante lo dice. */
  sample?: boolean
}

/** La llegada de una entrada a la puerta. */
export type OrderEntry = {
  inside: number
  total: number
  /** «21:04», ya en el huso del bar. */
  atLabel: string | null
  /** Cancelaron la reserva: la entrada ya no sirve. */
  cancelled: boolean
}
