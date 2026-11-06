import 'server-only'
import { formatInTimeZone } from 'date-fns-tz'
import { getAppUrl } from '@/lib/app-url'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { functionState, isOnSale, seatsLeft } from './availability'
import { checkoutUrl, guestShortName } from './copy'
import { DEFAULT_TZ, formatTime, nowLocalIn, serviceDayIn, todayIn } from './dates'
import { orderEntryFrom } from './door'
import { entryCodeFromOrderId, shortCodeFromOrderId } from './entry-code'
import { parseGallery, parseSteps } from './schemas'
import { buildTicketQr } from './ticket-qr'
import { isManualTransfer } from './transfer'
import type {
  ExperienceRow,
  OrderEntry,
  OrderStatus,
  PublicExperience,
  PublicFunction,
  PublicOrder,
  PublicVenue,
  TicketingSettingsView,
  TicketOrderRow,
} from './types'

/**
 * Lecturas de las entradas online.
 *
 * Las PÚBLICAS (cartelera, página de la película, entrada del cliente) usan
 * service_role, igual que la carta (/carta/[slug]): las abre gente sin cuenta
 * y no hay grant para `anon`. Cada consulta lleva el tenant_id explícito y lo
 * que sale de acá es solo lo que la página muestra (nada de la cuenta de
 * Mercado Pago, nada de teléfonos).
 *
 * Las del PANEL usan la sesión de quien mira (RLS: el dueño, y las ventas
 * también la anfitriona); solo el conteo de lugares y el «¿hay alias?» pasan
 * por service_role porque son del server o de la configuración del dueño.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas nuevas, sin tipos generados todavía
type SBAny = any

/** El acento de la página si el dueño no eligió uno: el óxido de HUB. */
export const DEFAULT_ACCENT = '#c0573e'

const EXPERIENCE_COLUMNS =
  'id, tenant_id, template_id, slug, published, series, title, tagline, synopsis, schedule_note, poster_url, hero_url, card_image_url, video_url, accent_hex, steps, steps_note, gallery, price_cents, deposit_cents, cash_price_cents, allow_full_payment, min_party_size, max_party_size, price_note, terms, sort_order, created_at, updated_at'

type TenantRow = {
  id: string
  slug: string
  name: string
  logo_url: string | null
  timezone: string | null
}

type EventRow = {
  id: string
  template_id: string
  event_date: string
  starts_at_local: string
  capacity: number
}

type SeatsRow = {
  scheduled_event_id: string
  capacity: number
  taken: number
  held: number
}

async function loadTenant(service: SBAny, slug: string): Promise<TenantRow | null> {
  const { data, error } = await service
    .from('tenants')
    .select('id, slug, name, logo_url, timezone')
    .eq('slug', slug)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.loadTenant]', { code: error.code })
    throw new Error('No pudimos cargar la cartelera.')
  }
  return (data as TenantRow | null) ?? null
}

type SettingsPublicRow = {
  headline: string | null
  intro: string | null
  venue_address: string | null
  contact_whatsapp: string | null
  transfer_alias: string | null
  transfer_holder: string | null
  hold_minutes: number | null
  mp_connected_at: string | null
}

async function loadVenue(service: SBAny, tenant: TenantRow): Promise<PublicVenue> {
  const { data, error } = await service
    .from('ticketing_settings')
    .select(
      'headline, intro, venue_address, contact_whatsapp, transfer_alias, transfer_holder, hold_minutes, mp_connected_at',
    )
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.loadVenue]', { tenantId: tenant.id, code: error.code })
  }
  const row = (data as SettingsPublicRow | null) ?? null
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    logoUrl: tenant.logo_url,
    headline: row?.headline ?? null,
    intro: row?.intro ?? null,
    address: row?.venue_address ?? null,
    whatsapp: row?.contact_whatsapp ?? null,
    transfer: row?.transfer_alias
      ? { alias: row.transfer_alias, holder: row.transfer_holder ?? null }
      : null,
    canSell: Boolean(row?.mp_connected_at),
    holdMinutes: row?.hold_minutes ?? 15,
  }
}

/**
 * Las funciones de los formatos pedidos, desde hoy, con su disponibilidad.
 * Las que ya empezaron (hoy, pasada la hora) no se ofrecen.
 */
async function loadFunctions(
  service: SBAny,
  tenantId: string,
  templateIds: string[],
  tz: string,
): Promise<Map<string, PublicFunction[]>> {
  const byTemplate = new Map<string, PublicFunction[]>()
  if (templateIds.length === 0) return byTemplate

  const { data: events, error } = await service
    .from('scheduled_events')
    .select('id, template_id, event_date, starts_at_local, capacity')
    .eq('tenant_id', tenantId)
    .in('template_id', templateIds)
    .eq('private_group', false)
    .gte('event_date', todayIn(tz))
    .order('event_date', { ascending: true })
    .order('starts_at_local', { ascending: true })
  if (error) {
    console.error('[ticketing.loadFunctions]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar las fechas.')
  }

  const nowLocal = nowLocalIn(tz)
  const upcoming = ((events as EventRow[] | null) ?? []).filter((e) =>
    isOnSale(e.event_date, e.starts_at_local, nowLocal),
  )
  if (upcoming.length === 0) return byTemplate

  const { data: seats, error: seatsError } = await service.rpc('ticketing_event_seats', {
    p_tenant_id: tenantId,
    p_event_ids: upcoming.map((e) => e.id),
  })
  if (seatsError) {
    console.error('[ticketing.loadFunctions.seats]', { tenantId, code: seatsError.code })
    throw new Error('No pudimos calcular los lugares.')
  }
  const seatsById = new Map<string, SeatsRow>(
    ((seats as SeatsRow[] | null) ?? []).map((s) => [s.scheduled_event_id, s]),
  )

  for (const e of upcoming) {
    const s = seatsById.get(e.id)
    const capacity = s?.capacity ?? e.capacity
    const left = seatsLeft(capacity, s?.taken ?? 0, s?.held ?? 0)
    const fn: PublicFunction = {
      eventId: e.id,
      date: e.event_date,
      time: formatTime(e.starts_at_local),
      capacity,
      left,
      state: functionState(left, capacity),
    }
    const list = byTemplate.get(e.template_id) ?? []
    list.push(fn)
    byTemplate.set(e.template_id, list)
  }
  return byTemplate
}

function toPublicExperience(row: ExperienceRow, functions: PublicFunction[]): PublicExperience {
  const minPartySize = Math.max(1, row.min_party_size ?? 1)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    series: row.series,
    tagline: row.tagline,
    synopsis: row.synopsis,
    scheduleNote: row.schedule_note,
    posterUrl: row.poster_url,
    heroUrl: row.hero_url,
    cardUrl: row.card_image_url ?? null,
    videoUrl: row.video_url ?? null,
    accent: row.accent_hex ?? DEFAULT_ACCENT,
    steps: parseSteps(row.steps),
    stepsNote: row.steps_note,
    gallery: parseGallery(row.gallery),
    priceCents: Number(row.price_cents),
    depositCents: Number(row.deposit_cents),
    cashPriceCents: row.cash_price_cents === null ? null : Number(row.cash_price_cents),
    allowFullPayment: row.allow_full_payment ?? true,
    minPartySize,
    maxPartySize: row.max_party_size,
    priceNote: row.price_note,
    terms: row.terms,
    // Con menos lugares que el mínimo, para la venta online es «Agotado».
    functions: functions.map((fn) => ({
      ...fn,
      state: functionState(fn.left, fn.capacity, minPartySize),
    })),
    draft: !row.published,
  }
}

export type PublicCatalog = {
  venue: PublicVenue
  experiences: PublicExperience[]
  today: string
  /** La está viendo el dueño con las películas sin publicar incluidas. */
  preview?: boolean
}

/** La cartelera: todas las películas publicadas del bar con sus funciones. */
export async function getPublicCatalog(
  tenantSlug: string,
  opts: { includeUnpublished?: boolean } = {},
): Promise<PublicCatalog | null> {
  const service = createServiceClient() as SBAny
  const tenant = await loadTenant(service, tenantSlug)
  if (!tenant) return null
  const tz = tenant.timezone ?? DEFAULT_TZ

  const [venue, { data: rows, error }] = await Promise.all([
    loadVenue(service, tenant),
    (() => {
      let query = service
        .from('event_experiences')
        .select(EXPERIENCE_COLUMNS)
        .eq('tenant_id', tenant.id)
      // La vista previa del dueño trae también las apagadas (marcadas).
      if (!opts.includeUnpublished) query = query.eq('published', true)
      return query.order('sort_order', { ascending: true }).order('title', { ascending: true })
    })(),
  ])
  if (error) {
    console.error('[ticketing.getPublicCatalog]', { tenantId: tenant.id, code: error.code })
    throw new Error('No pudimos cargar la cartelera.')
  }
  const experiences = (rows as ExperienceRow[] | null) ?? []
  const functions = await loadFunctions(
    service,
    tenant.id,
    experiences.map((e) => e.template_id),
    tz,
  )
  return {
    venue,
    today: todayIn(tz),
    experiences: experiences.map((e) => toPublicExperience(e, functions.get(e.template_id) ?? [])),
    preview: Boolean(opts.includeUnpublished) && experiences.some((e) => !e.published),
  }
}

export type PublicExperiencePage = {
  venue: PublicVenue
  experience: PublicExperience
  /** Las otras películas publicadas (para «Seguí mirando»). */
  others: Array<Pick<PublicExperience, 'slug' | 'title' | 'posterUrl' | 'accent'>>
  today: string
  /** La está viendo el dueño sin publicar (vista previa). */
  preview: boolean
}

/**
 * La página de una película. `allowUnpublished` = la vista previa del dueño
 * (la decide la página con su sesión): sin eso, una película apagada es 404.
 */
export async function getPublicExperience(
  tenantSlug: string,
  slug: string,
  opts: { allowUnpublished?: boolean } = {},
): Promise<PublicExperiencePage | null> {
  const service = createServiceClient() as SBAny
  const tenant = await loadTenant(service, tenantSlug)
  if (!tenant) return null
  const tz = tenant.timezone ?? DEFAULT_TZ

  const { data: row, error } = await service
    .from('event_experiences')
    .select(EXPERIENCE_COLUMNS)
    .eq('tenant_id', tenant.id)
    .eq('slug', slug)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getPublicExperience]', { tenantId: tenant.id, code: error.code })
    throw new Error('No pudimos cargar la película.')
  }
  const experience = row as ExperienceRow | null
  if (!experience) return null
  if (!experience.published && !opts.allowUnpublished) return null

  const [venue, functions, { data: otherRows }] = await Promise.all([
    loadVenue(service, tenant),
    loadFunctions(service, tenant.id, [experience.template_id], tz),
    service
      .from('event_experiences')
      .select('slug, title, poster_url, card_image_url, accent_hex')
      .eq('tenant_id', tenant.id)
      .eq('published', true)
      .neq('id', experience.id)
      .order('sort_order', { ascending: true })
      .limit(6),
  ])

  const others = (
    (otherRows as Array<{
      slug: string
      title: string
      poster_url: string | null
      card_image_url: string | null
      accent_hex: string | null
    }> | null) ?? []
  ).map((o) => ({
    slug: o.slug,
    title: o.title,
    // «También en cartelera» es afuera de la película: va la de previsualización.
    posterUrl: o.card_image_url ?? o.poster_url,
    accent: o.accent_hex ?? DEFAULT_ACCENT,
  }))

  return {
    venue,
    experience: toPublicExperience(experience, functions.get(experience.template_id) ?? []),
    others,
    today: todayIn(tz),
    preview: !experience.published,
  }
}

// ──────────────────────────────────────────────
// La entrada del cliente
// ──────────────────────────────────────────────

const ORDER_PUBLIC_COLUMNS =
  'id, tenant_id, experience_id, reservation_id, title, event_date, event_time, party_size, payment_option, unit_price_cents, full_price_cents, total_cents, balance_cash_only, guest_name, status, hold_expires_at, paid_cents, paid_at, mp_status_detail, mp_preference_id, mp_payment_id, mp_payment_type, terms'

type OrderPublicRow = Pick<
  TicketOrderRow,
  | 'id'
  | 'tenant_id'
  | 'experience_id'
  | 'reservation_id'
  | 'title'
  | 'event_date'
  | 'event_time'
  | 'party_size'
  | 'payment_option'
  | 'unit_price_cents'
  | 'full_price_cents'
  | 'total_cents'
  | 'balance_cash_only'
  | 'guest_name'
  | 'status'
  | 'hold_expires_at'
  | 'paid_cents'
  | 'paid_at'
  | 'mp_status_detail'
  | 'mp_preference_id'
  | 'mp_payment_id'
  | 'mp_payment_type'
  | 'terms'
>

const ORDER_RESERVATION_COLUMNS =
  'status, reservation_date, reservation_time_local, estimated_guests, actual_guests, arrived_at'

type OrderReservationRow = {
  status: string
  reservation_date: string
  reservation_time_local: string
  estimated_guests: number
  actual_guests: number | null
  arrived_at: string | null
}

export function isOrderExpired(
  status: OrderStatus,
  holdExpiresAt: string,
  now: Date = new Date(),
): boolean {
  return (status === 'pending' || status === 'rejected') && new Date(holdExpiresAt) <= now
}

export type PublicOrderPage = {
  venue: PublicVenue
  order: PublicOrder
}

/**
 * La entrada de un pedido. El id del pedido es la llave (uuid al azar, como
 * el link de la billetera): quien tiene el link ve su entrada. Sale solo el
 * primer nombre, nunca el teléfono.
 */
export async function getPublicOrder(
  tenantSlug: string,
  orderId: string,
): Promise<PublicOrderPage | null> {
  const service = createServiceClient() as SBAny
  const tenant = await loadTenant(service, tenantSlug)
  if (!tenant) return null

  const { data, error } = await service
    .from('ticket_orders')
    .select(ORDER_PUBLIC_COLUMNS)
    .eq('tenant_id', tenant.id)
    .eq('id', orderId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getPublicOrder]', { tenantId: tenant.id, code: error.code })
    throw new Error('No pudimos cargar tu entrada.')
  }
  const order = data as OrderPublicRow | null
  if (!order) return null

  const [venue, { data: exp }, { data: mode }, { data: res, error: resError }] = await Promise.all([
    loadVenue(service, tenant),
    order.experience_id
      ? service
          .from('event_experiences')
          .select('slug, poster_url, accent_hex, price_note')
          .eq('tenant_id', tenant.id)
          .eq('id', order.experience_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    service.from('ticketing_settings').select('mp_live').eq('tenant_id', tenant.id).maybeSingle(),
    order.reservation_id
      ? service
          .from('salon_reservations')
          .select(ORDER_RESERVATION_COLUMNS)
          .eq('tenant_id', tenant.id)
          .eq('id', order.reservation_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const experience = exp as {
    slug: string
    poster_url: string | null
    accent_hex: string | null
    price_note: string | null
  } | null
  if (resError) {
    // La puerta valida igual contra la base: acá solo se pierde el dato al día.
    console.error('[ticketing.getPublicOrder] no se pudo leer la reserva', {
      tenantId: tenant.id,
      code: resError.code,
    })
  }
  const reservation = res as OrderReservationRow | null
  const tz = tenant.timezone ?? DEFAULT_TZ
  const today = serviceDayIn(tz)
  const entry = orderEntryFrom(reservation, order.party_size, (iso) =>
    formatInTimeZone(new Date(iso), tz, 'HH:mm'),
  )
  // La reserva sigue al evento: si lo movieron, la entrada dice la fecha nueva.
  const date = reservation?.reservation_date ?? order.event_date
  const time = formatTime(reservation?.reservation_time_local ?? order.event_time)
  // El QR solo si todavía puede usarse. Un pedido sin reserva (la función ya no
  // existe) también lo lleva: en la puerta avisa, y quien recibe lo resuelve.
  const usable =
    order.status === 'approved' && !entry.cancelled && entry.inside < entry.total && date >= today

  const expired = isOrderExpired(order.status, order.hold_expires_at)
  // Rechazado o a medio pagar con el lugar todavía guardado: se puede volver
  // a la MISMA preferencia (mismo pedido, mismos lugares).
  const retryUrl =
    !expired &&
    (order.status === 'pending' || order.status === 'rejected') &&
    order.mp_preference_id
      ? checkoutUrl(
          order.mp_preference_id,
          (mode as { mp_live: boolean | null } | null)?.mp_live ?? true,
        )
      : null

  return {
    venue,
    order: {
      id: order.id,
      shortCode: shortCodeFromOrderId(order.id),
      status: order.status,
      expired,
      holdExpiresAt: order.hold_expires_at,
      title: order.title,
      date,
      time,
      partySize: order.party_size,
      option: order.payment_option,
      unitPriceCents: Number(order.unit_price_cents),
      fullPriceCents: Number(order.full_price_cents),
      totalCents: Number(order.total_cents),
      balanceCashOnly: order.balance_cash_only ?? false,
      paidCents: order.paid_cents === null ? null : Number(order.paid_cents),
      guestFirstName: order.guest_name.trim().split(/\s+/)[0] ?? order.guest_name,
      experienceSlug: experience?.slug ?? null,
      posterUrl: experience?.poster_url ?? null,
      accent: experience?.accent_hex ?? DEFAULT_ACCENT,
      priceNote: experience?.price_note ?? null,
      mpStatusDetail: order.mp_status_detail,
      retryUrl,
      guestShortName: guestShortName(order.guest_name),
      // Una transferencia no tiene número de operación de Mercado Pago.
      mpPaymentId: isManualTransfer(order.mp_payment_type) ? null : order.mp_payment_id,
      mpPaymentType: order.mp_payment_type,
      paidAtLabel: order.paid_at
        ? formatInTimeZone(new Date(order.paid_at), tz, 'dd/MM/yyyy HH:mm')
        : null,
      terms: order.terms,
      today,
      entry,
      qr: usable ? buildTicketQr(`${await getAppUrl()}/e/${entryCodeFromOrderId(order.id)}`) : null,
    },
  }
}

/**
 * Cómo va la llegada de una entrada, para la página del cliente (pregunta cada
 * tanto mientras la función es hoy). `null` si no se pudo saber: la página se queda
 * con lo último que sabía, no con «nadie entró».
 */
export async function getOrderEntry(
  service: SBAny,
  tenantId: string,
  reservationId: string | null,
  partySize: number,
  tz: string,
): Promise<OrderEntry | null> {
  if (!reservationId) {
    return orderEntryFrom(null, partySize, () => '')
  }
  const { data, error } = await service
    .from('salon_reservations')
    .select(ORDER_RESERVATION_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', reservationId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getOrderEntry]', { tenantId, code: error.code })
    return null
  }
  return orderEntryFrom(data as OrderReservationRow | null, partySize, (iso) =>
    formatInTimeZone(new Date(iso), tz, 'HH:mm'),
  )
}

/**
 * Una entrada de muestra, para ver y filmar cómo queda sin pagar: la película y los
 * precios son los de verdad, y todo lo demás es inventado. No toca la base. El
 * comprobante dice que es una muestra y el QR no sirve en la puerta: su pedido no
 * existe, así que sale «No figura».
 */
export const SAMPLE_ORDER_ID = '00000000-0000-4000-8000-000000000000'

type SampleExperienceRow = {
  id: string
  template_id: string
  slug: string
  title: string
  poster_url: string | null
  accent_hex: string | null
  price_note: string | null
  terms: string | null
  price_cents: number
  deposit_cents: number
}

export async function getSampleOrder(
  tenantSlug: string,
  options: { film?: string; name?: string; people?: number },
): Promise<PublicOrderPage | null> {
  const service = createServiceClient() as SBAny
  const tenant = await loadTenant(service, tenantSlug)
  if (!tenant) return null
  const tz = tenant.timezone ?? DEFAULT_TZ

  let query = service
    .from('event_experiences')
    .select(
      'id, template_id, slug, title, poster_url, accent_hex, price_note, terms, price_cents, deposit_cents',
    )
    .eq('tenant_id', tenant.id)
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .limit(1)
  if (options.film) query = query.eq('slug', options.film)
  const { data: rows, error } = await query
  if (error) {
    console.error('[ticketing.getSampleOrder]', { tenantId: tenant.id, code: error.code })
    throw new Error('No pudimos cargar la muestra.')
  }
  const experience = (rows as SampleExperienceRow[] | null)?.[0]
  if (!experience) return null

  const today = serviceDayIn(tz)
  const [venue, { data: next }] = await Promise.all([
    loadVenue(service, tenant),
    service
      .from('scheduled_events')
      .select('event_date, starts_at_local')
      .eq('tenant_id', tenant.id)
      .eq('template_id', experience.template_id)
      // Una función que todavía no fue: sin el botón fijo de la noche, que taparía la escena.
      .gt('event_date', today)
      .order('event_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  const event = next as { event_date: string; starts_at_local: string } | null

  const partySize = Math.min(Math.max(options.people ?? 2, 1), 10)
  const deposit = Number(experience.deposit_cents) > 0
  const unit = deposit ? Number(experience.deposit_cents) : Number(experience.price_cents)
  const name = options.name?.trim().slice(0, 24) || 'Nacho'
  const total = unit * partySize
  const now = new Date()
  return {
    venue,
    order: {
      id: SAMPLE_ORDER_ID,
      shortCode: 'MUESTRA0',
      status: 'approved',
      expired: false,
      holdExpiresAt: now.toISOString(),
      title: experience.title,
      date: event?.event_date ?? today,
      time: formatTime(event?.starts_at_local ?? '21:00:00'),
      partySize,
      option: deposit ? 'deposit' : 'full',
      unitPriceCents: unit,
      fullPriceCents: Number(experience.price_cents),
      totalCents: total,
      balanceCashOnly: false,
      paidCents: total,
      guestFirstName: name,
      experienceSlug: experience.slug,
      posterUrl: experience.poster_url,
      accent: experience.accent_hex ?? DEFAULT_ACCENT,
      priceNote: experience.price_note,
      mpStatusDetail: 'accredited',
      retryUrl: null,
      guestShortName: name,
      mpPaymentId: '000000000000',
      mpPaymentType: 'credit_card',
      paidAtLabel: formatInTimeZone(now, tz, 'dd/MM/yyyy HH:mm'),
      terms: experience.terms,
      today,
      entry: { inside: 0, total: partySize, atLabel: null, cancelled: false },
      qr: buildTicketQr(`${await getAppUrl()}/e/${entryCodeFromOrderId(SAMPLE_ORDER_ID)}`),
      sample: true,
    },
  }
}

// ──────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────

const SETTINGS_VIEW_COLUMNS =
  'tenant_id, mp_user_id, mp_nickname, mp_live, mp_connected_at, online_manager_id, hold_minutes, headline, intro, venue_address, contact_whatsapp, transfer_alias, transfer_holder, updated_at'

export async function getTicketingSettings(tenantId: string): Promise<TicketingSettingsView> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('ticketing_settings')
    .select(SETTINGS_VIEW_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getTicketingSettings]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar la configuración de entradas.')
  }
  return (
    (data as TicketingSettingsView | null) ?? {
      tenant_id: tenantId,
      mp_user_id: null,
      mp_nickname: null,
      mp_live: null,
      mp_connected_at: null,
      online_manager_id: null,
      hold_minutes: 15,
      headline: null,
      intro: null,
      venue_address: null,
      contact_whatsapp: null,
      transfer_alias: null,
      transfer_holder: null,
      updated_at: null,
    }
  )
}

export type AdminExperience = PublicExperience & {
  published: boolean
  templateId: string
  templateName: string
  templateColor: string
  sortOrder: number
  updatedAt: string
}

type TemplateRow = { id: string; name: string; slug: string; color_hex: string; active: boolean }

async function loadTemplates(supabase: SBAny, tenantId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase
    .from('scheduled_event_templates')
    .select('id, name, slug, color_hex, active')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  if (error) {
    console.error('[ticketing.loadTemplates]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar los formatos.')
  }
  return (data as TemplateRow[] | null) ?? []
}

export type AdminOverview = {
  experiences: AdminExperience[]
  /** Formatos del calendario que todavía no tienen página. */
  availableTemplates: Array<{ id: string; name: string; color: string }>
  today: string
}

/** Todo lo de la pestaña Entradas: las películas, sus funciones y los formatos libres. */
export async function getAdminOverview(tenantId: string): Promise<AdminOverview> {
  const supabase = (await createClient()) as SBAny
  const [templates, { data: rows, error }] = await Promise.all([
    loadTemplates(supabase, tenantId),
    supabase
      .from('event_experiences')
      .select(EXPERIENCE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
  ])
  if (error) {
    console.error('[ticketing.getAdminOverview]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar las películas.')
  }
  const experiences = (rows as ExperienceRow[] | null) ?? []
  const templateById = new Map(templates.map((t) => [t.id, t]))
  const functions = await loadFunctions(
    createServiceClient() as SBAny,
    tenantId,
    experiences.map((e) => e.template_id),
    DEFAULT_TZ,
  )
  const used = new Set(experiences.map((e) => e.template_id))

  return {
    today: todayIn(DEFAULT_TZ),
    experiences: experiences.map((e) => {
      const tpl = templateById.get(e.template_id)
      return {
        ...toPublicExperience(e, functions.get(e.template_id) ?? []),
        published: e.published,
        templateId: e.template_id,
        templateName: tpl?.name ?? 'Formato',
        templateColor: tpl?.color_hex ?? '#7c3aed',
        sortOrder: e.sort_order,
        updatedAt: e.updated_at,
      }
    }),
    availableTemplates: templates
      .filter((t) => t.active && !used.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, color: t.color_hex })),
  }
}

export async function getAdminExperience(
  tenantId: string,
  id: string,
): Promise<AdminExperience | null> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('event_experiences')
    .select(EXPERIENCE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getAdminExperience]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar la película.')
  }
  const row = data as ExperienceRow | null
  if (!row) return null
  const [templates, functions] = await Promise.all([
    loadTemplates(supabase, tenantId),
    loadFunctions(createServiceClient() as SBAny, tenantId, [row.template_id], DEFAULT_TZ),
  ])
  const tpl = templates.find((t) => t.id === row.template_id)
  return {
    ...toPublicExperience(row, functions.get(row.template_id) ?? []),
    published: row.published,
    templateId: row.template_id,
    templateName: tpl?.name ?? 'Formato',
    templateColor: tpl?.color_hex ?? '#7c3aed',
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }
}

export type AdminOrder = Pick<
  TicketOrderRow,
  | 'id'
  | 'title'
  | 'event_date'
  | 'event_time'
  | 'party_size'
  | 'payment_option'
  | 'total_cents'
  | 'paid_cents'
  | 'guest_name'
  | 'guest_phone'
  | 'status'
  | 'hold_expires_at'
  | 'reservation_id'
  | 'attention'
  | 'mp_status_detail'
  | 'mp_payment_type'
  | 'created_at'
  | 'paid_at'
> & {
  /** La reserva, para saber si ya entraron. */
  reservation: {
    status: string
    estimated_guests: number
    actual_guests: number | null
    arrived_at: string | null
  } | null
  /** Si en la puerta dejaron pasar y lo deshicieron: queda a la vista de los dueños. */
  undo: OrderUndo | null
}

export type OrderUndo = {
  by: string | null
  at: string
  from: number
  to: number
}

/** Los «Deshacer» de la puerta de estas compras: quién, cuándo y de cuánto a cuánto. */
async function loadOrderUndos(
  supabase: SBAny,
  tenantId: string,
  orderIds: string[],
): Promise<Map<string, OrderUndo>> {
  const undos = new Map<string, OrderUndo>()
  if (orderIds.length === 0) return undos
  const { data, error } = await supabase
    .from('audit_log')
    .select('entity_id, user_id, created_at, payload')
    .eq('tenant_id', tenantId)
    .eq('entity', 'ticket_order')
    .eq('action', 'ticket_order.door_undo')
    .in('entity_id', orderIds)
  if (error) {
    console.error('[ticketing.loadOrderUndos]', { tenantId, code: error.code })
    return undos
  }
  const rows = (data ?? []) as Array<{
    entity_id: string
    user_id: string | null
    created_at: string
    payload: { from?: number; to?: number }
  }>
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
  const { data: people } = userIds.length
    ? await supabase
        .from('reservation_managers')
        .select('user_id, display_name')
        .eq('tenant_id', tenantId)
        .in('user_id', userIds)
    : { data: [] }
  const names = new Map(
    ((people ?? []) as Array<{ user_id: string; display_name: string }>).map((p) => [
      p.user_id,
      p.display_name,
    ]),
  )
  for (const row of rows) {
    undos.set(row.entity_id, {
      by: row.user_id ? (names.get(row.user_id) ?? null) : null,
      at: row.created_at,
      from: Number(row.payload?.from ?? 0),
      to: Number(row.payload?.to ?? 0),
    })
  }
  return undos
}

const ADMIN_ORDER_COLUMNS =
  'id, title, event_date, event_time, party_size, payment_option, total_cents, paid_cents, guest_name, guest_phone, status, hold_expires_at, reservation_id, attention, mp_status_detail, mp_payment_type, created_at, paid_at, reservation:salon_reservations(status, estimated_guests, actual_guests, arrived_at)'

/**
 * Le suma a cada compra pagada su «Deshacer» de la puerta. Lo lee solo el dueño (audit_log es
 * suyo por RLS): para la anfitriona sale vacío, y está bien, porque es lo que los dueños miran.
 */
async function withUndos(
  supabase: SBAny,
  tenantId: string,
  orders: Omit<AdminOrder, 'undo'>[],
): Promise<AdminOrder[]> {
  const undos = await loadOrderUndos(
    supabase,
    tenantId,
    orders.filter((o) => o.status === 'approved').map((o) => o.id),
  )
  return orders.map((o) => ({ ...o, undo: undos.get(o.id) ?? null }))
}

/** Las últimas compras (pagadas, en curso y caídas): lo que lee Tex. */
export async function listRecentOrders(tenantId: string, limit = 60): Promise<AdminOrder[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('ticket_orders')
    .select(ADMIN_ORDER_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[ticketing.listRecentOrders]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar las ventas.')
  }
  return withUndos(supabase, tenantId, (data as Omit<AdminOrder, 'undo'>[] | null) ?? [])
}

/**
 * Ventas online, una página (lib/ticketing/sales-days.ts): las compras que entraron entre
 * `fromIso` (inclusive) y `toIso` (exclusivo), de la más nueva a la más vieja, y cuándo entró la
 * anterior más nueva, para «Ver días anteriores». Las leen el dueño y la anfitriona, cada uno con
 * su sesión (policies ticket_orders_owner_select y ticket_orders_host_select).
 */
export async function listOrdersBetween(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<{ orders: AdminOrder[]; olderCreatedAt: string | null }> {
  const supabase = (await createClient()) as SBAny
  const [page, older] = await Promise.all([
    supabase
      .from('ticket_orders')
      .select(ADMIN_ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: false }),
    supabase
      .from('ticket_orders')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .lt('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (page.error || older.error) {
    console.error('[ticketing.listOrdersBetween]', {
      tenantId,
      code: page.error?.code ?? older.error?.code,
    })
    throw new Error('No pudimos cargar las ventas.')
  }
  const olderRows = (older.data as Array<{ created_at: string }> | null) ?? []
  return {
    orders: await withUndos(supabase, tenantId, (page.data as Omit<AdminOrder, 'undo'>[]) ?? []),
    olderCreatedAt: olderRows[0]?.created_at ?? null,
  }
}

/**
 * ¿El bar cargó un alias para transferir? Decide si hay transferencias que confirmar. La
 * configuración es del dueño por RLS, así que se lee con service_role: el alias no es secreto
 * (lo ve cualquiera a quien Mercado Pago le rechaza el pago) y de acá sale solo un sí o un no.
 */
export async function hasTransferAlias(tenantId: string): Promise<boolean> {
  const service = createServiceClient() as SBAny
  const { data, error } = await service
    .from('ticketing_settings')
    .select('transfer_alias')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.hasTransferAlias]', { tenantId, code: error.code })
    return false
  }
  return Boolean((data as { transfer_alias: string | null } | null)?.transfer_alias)
}

/** Los gestores activos, para «¿A nombre de quién quedan las reservas?». */
export async function listActiveManagers(
  tenantId: string,
): Promise<Array<{ id: string; name: string; commission: boolean }>> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('reservation_managers')
    .select('id, display_name, commission_eligible')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('display_name', { ascending: true })
  if (error) {
    console.error('[ticketing.listActiveManagers]', { tenantId, code: error.code })
    return []
  }
  return (
    (data as Array<{ id: string; display_name: string; commission_eligible: boolean }> | null) ?? []
  ).map((m) => ({ id: m.id, name: m.display_name, commission: m.commission_eligible }))
}
