import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { functionState, isOnSale, seatsLeft } from './availability'
import { DEFAULT_TZ, formatTime, nowLocalIn, todayIn } from './dates'
import { parseGallery, parseSteps } from './schemas'
import type {
  ExperienceRow,
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
 * Las del PANEL usan la sesión del dueño (RLS owner); solo el conteo de
 * lugares pasa por service_role porque la función de la base es solo del
 * server.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas nuevas, sin tipos generados todavía
type SBAny = any

/** El acento de la página si el dueño no eligió uno: el óxido de HUB. */
export const DEFAULT_ACCENT = '#c0573e'

const EXPERIENCE_COLUMNS =
  'id, tenant_id, template_id, slug, published, series, title, tagline, synopsis, schedule_note, poster_url, hero_url, accent_hex, steps, steps_note, gallery, price_cents, deposit_cents, max_party_size, terms, sort_order, created_at, updated_at'

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
  hold_minutes: number | null
  mp_connected_at: string | null
}

async function loadVenue(service: SBAny, tenant: TenantRow): Promise<PublicVenue> {
  const { data, error } = await service
    .from('ticketing_settings')
    .select('headline, intro, venue_address, contact_whatsapp, hold_minutes, mp_connected_at')
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
    accent: row.accent_hex ?? DEFAULT_ACCENT,
    steps: parseSteps(row.steps),
    stepsNote: row.steps_note,
    gallery: parseGallery(row.gallery),
    priceCents: Number(row.price_cents),
    depositCents: Number(row.deposit_cents),
    maxPartySize: row.max_party_size,
    terms: row.terms,
    functions,
  }
}

export type PublicCatalog = {
  venue: PublicVenue
  experiences: PublicExperience[]
  today: string
}

/** La cartelera: todas las películas publicadas del bar con sus funciones. */
export async function getPublicCatalog(tenantSlug: string): Promise<PublicCatalog | null> {
  const service = createServiceClient() as SBAny
  const tenant = await loadTenant(service, tenantSlug)
  if (!tenant) return null
  const tz = tenant.timezone ?? DEFAULT_TZ

  const [venue, { data: rows, error }] = await Promise.all([
    loadVenue(service, tenant),
    service
      .from('event_experiences')
      .select(EXPERIENCE_COLUMNS)
      .eq('tenant_id', tenant.id)
      .eq('published', true)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true }),
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
      .select('slug, title, poster_url, accent_hex')
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
      accent_hex: string | null
    }> | null) ?? []
  ).map((o) => ({
    slug: o.slug,
    title: o.title,
    posterUrl: o.poster_url,
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
  'id, tenant_id, experience_id, title, event_date, event_time, party_size, payment_option, unit_price_cents, full_price_cents, total_cents, guest_name, status, hold_expires_at, paid_cents, mp_status_detail'

type OrderPublicRow = Pick<
  TicketOrderRow,
  | 'id'
  | 'tenant_id'
  | 'experience_id'
  | 'title'
  | 'event_date'
  | 'event_time'
  | 'party_size'
  | 'payment_option'
  | 'unit_price_cents'
  | 'full_price_cents'
  | 'total_cents'
  | 'guest_name'
  | 'status'
  | 'hold_expires_at'
  | 'paid_cents'
  | 'mp_status_detail'
>

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

  const [venue, { data: exp }] = await Promise.all([
    loadVenue(service, tenant),
    order.experience_id
      ? service
          .from('event_experiences')
          .select('slug, poster_url, accent_hex')
          .eq('tenant_id', tenant.id)
          .eq('id', order.experience_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const experience = exp as {
    slug: string
    poster_url: string | null
    accent_hex: string | null
  } | null

  return {
    venue,
    order: {
      id: order.id,
      shortCode: order.id.slice(0, 8).toUpperCase(),
      status: order.status,
      expired: isOrderExpired(order.status, order.hold_expires_at),
      holdExpiresAt: order.hold_expires_at,
      title: order.title,
      date: order.event_date,
      time: formatTime(order.event_time),
      partySize: order.party_size,
      option: order.payment_option,
      unitPriceCents: Number(order.unit_price_cents),
      fullPriceCents: Number(order.full_price_cents),
      totalCents: Number(order.total_cents),
      paidCents: order.paid_cents === null ? null : Number(order.paid_cents),
      guestFirstName: order.guest_name.trim().split(/\s+/)[0] ?? order.guest_name,
      experienceSlug: experience?.slug ?? null,
      posterUrl: experience?.poster_url ?? null,
      accent: experience?.accent_hex ?? DEFAULT_ACCENT,
      mpStatusDetail: order.mp_status_detail,
    },
  }
}

// ──────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────

const SETTINGS_VIEW_COLUMNS =
  'tenant_id, mp_user_id, mp_nickname, mp_live, mp_connected_at, online_manager_id, hold_minutes, headline, intro, venue_address, contact_whatsapp, updated_at'

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
  | 'created_at'
  | 'paid_at'
>

/** Las últimas compras (pagadas, en curso y caídas) para la pestaña Entradas. */
export async function listRecentOrders(tenantId: string, limit = 60): Promise<AdminOrder[]> {
  const supabase = (await createClient()) as SBAny
  const { data, error } = await supabase
    .from('ticket_orders')
    .select(
      'id, title, event_date, event_time, party_size, payment_option, total_cents, paid_cents, guest_name, guest_phone, status, hold_expires_at, reservation_id, attention, mp_status_detail, created_at, paid_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[ticketing.listRecentOrders]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar las ventas.')
  }
  return (data as AdminOrder[] | null) ?? []
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
