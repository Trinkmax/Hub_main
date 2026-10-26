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
  accent_hex: string | null
  steps: unknown
  steps_note: string | null
  gallery: unknown
  price_cents: number
  deposit_cents: number
  max_party_size: number
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
  accent: string
  steps: ExperienceStep[]
  stepsNote: string | null
  gallery: GalleryItem[]
  priceCents: number
  depositCents: number
  maxPartySize: number
  terms: string | null
  functions: PublicFunction[]
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
  /** Hay cuenta de Mercado Pago conectada: se puede pagar online. */
  canSell: boolean
  holdMinutes: number
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
  paidCents: number | null
  guestFirstName: string
  experienceSlug: string | null
  posterUrl: string | null
  accent: string
  mpStatusDetail: string | null
}
