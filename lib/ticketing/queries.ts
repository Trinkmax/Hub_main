import 'server-only'
import { formatInTimeZone } from 'date-fns-tz'
import { getAppUrl } from '@/lib/app-url'
import { applyBranchFilter, type BranchFilter, WHOLE_BAR } from '@/lib/branches/filter'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { functionState, isOnSale, seatsLeft } from './availability'
import {
  branchSlugLookup,
  functionAddress,
  sellingBranches,
  type TicketBranchRow,
  toPublicBranch,
} from './branches'
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
  PublicBranch,
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
 * Mercado Pago, nada de teléfonos; de las sucursales, nombre, dirección y color).
 *
 * Las del PANEL usan la sesión de quien mira (RLS: el dueño, y las ventas
 * también la anfitriona); solo el conteo de lugares, el «¿hay alias?» y el
 * título de cada película en la pestaña Funciones pasan por service_role
 * porque son del server o del dueño (y la cartelera ya los muestra).
 *
 * Sucursales (docs/features/sucursales.md): la película es del bar y cada
 * función es de una sucursal (`scheduled_events.branch_id`); la compra copia la
 * de su función. Lo del panel recibe el filtro de lo que se mira (`BranchFilter`,
 * de `getBranchScope`); lo público trae todas y dice en cuál es cada función.
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
  /** La sucursal de la función. Obligatoria en la base; acá puede faltar si el código sale antes. */
  branch_id: string | null
  event_date: string
  starts_at_local: string
  capacity: number
  /** El bar frenó la venta online de esta fecha (Ventas online › Funciones y cupos). */
  online_sales_paused?: boolean | null
}

const BRANCH_COLUMNS = 'id, slug, name, short_name, address, color, is_default, position, active'

/**
 * Las sucursales del bar, también las apagadas (una función ya programada sigue siendo allá). Si no
 * se pueden leer, la cartelera sigue: las funciones no dicen dónde y vale la dirección del bar.
 */
async function loadBranches(service: SBAny, tenantId: string): Promise<TicketBranchRow[]> {
  const { data, error } = await service
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('tenant_id', tenantId)
  if (error) {
    console.error('[ticketing.loadBranches]', { tenantId, code: error.code })
    return []
  }
  return (data as TicketBranchRow[] | null) ?? []
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

/** Una función abierta con sus números crudos: el panel los muestra, la cartelera no. */
type FunctionSeats = {
  event: EventRow
  capacity: number
  /** Reservas en pie de la función: las de la venta online y las que carga el bar a mano. */
  taken: number
  /** Compras que se están pagando: su lugar queda guardado mientras tanto. */
  held: number
  /** La venta online de esta fecha está frenada: se ve en la cartelera, no se compra. */
  paused: boolean
}

/**
 * Las funciones de los formatos pedidos, desde hoy, con sus lugares. Las que ya
 * empezaron (hoy, pasada la hora) y las de grupos privados no se ofrecen.
 *
 * `branch`: las de qué sucursales (el panel pasa lo que se mira; lo público, todo el bar).
 */
async function loadFunctionSeats(
  service: SBAny,
  tenantId: string,
  templateIds: string[],
  tz: string,
  branch: BranchFilter = WHOLE_BAR,
): Promise<FunctionSeats[]> {
  if (templateIds.length === 0) return []

  const { data: events, error } = await applyBranchFilter(
    service
      .from('scheduled_events')
      .select(
        'id, template_id, branch_id, event_date, starts_at_local, capacity, online_sales_paused',
      )
      .eq('tenant_id', tenantId)
      .in('template_id', templateIds)
      .eq('private_group', false)
      .gte('event_date', todayIn(tz)),
    branch,
  )
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
  if (upcoming.length === 0) return []

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

  return upcoming.map((event) => {
    const s = seatsById.get(event.id)
    return {
      event,
      capacity: s?.capacity ?? event.capacity,
      taken: s?.taken ?? 0,
      held: s?.held ?? 0,
      paused: event.online_sales_paused === true,
    }
  })
}

/**
 * Una función del panel: la de la cartelera con el id de su sucursal en vez del `slug` (la
 * etiqueta de cada una mirando «Todas» la busca por id).
 */
export type AdminFunction = Omit<PublicFunction, 'branch'> & { branchId: string | null }

/**
 * Las funciones de los formatos pedidos, desde hoy, con su disponibilidad.
 * Las que ya empezaron (hoy, pasada la hora) no se ofrecen.
 */
async function loadFunctions(
  service: SBAny,
  tenantId: string,
  templateIds: string[],
  tz: string,
  branch: BranchFilter = WHOLE_BAR,
): Promise<Map<string, AdminFunction[]>> {
  const byTemplate = new Map<string, AdminFunction[]>()
  const rows = await loadFunctionSeats(service, tenantId, templateIds, tz, branch)
  for (const { event: e, capacity, taken, held, paused } of rows) {
    const left = seatsLeft(capacity, taken, held)
    const fn: AdminFunction = {
      eventId: e.id,
      date: e.event_date,
      time: formatTime(e.starts_at_local),
      capacity,
      left,
      state: functionState(left, capacity, 1, paused),
      branchId: e.branch_id ?? null,
    }
    const list = byTemplate.get(e.template_id) ?? []
    list.push(fn)
    byTemplate.set(e.template_id, list)
  }
  return byTemplate
}

/** Lo que viaja a las páginas públicas: la sucursal por su `slug`, nunca por su id. */
function toPublicFunctions(
  functions: ReadonlyArray<AdminFunction>,
  slugOf: (id: string | null) => string | null,
): PublicFunction[] {
  return functions.map((fn) => ({
    eventId: fn.eventId,
    date: fn.date,
    time: fn.time,
    capacity: fn.capacity,
    left: fn.left,
    state: fn.state,
    branch: slugOf(fn.branchId),
  }))
}

function toPublicExperience<F extends Omit<PublicFunction, 'branch'>>(
  row: ExperienceRow,
  functions: F[],
): Omit<PublicExperience, 'functions'> & { functions: F[] } {
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
    // Con menos lugares que el mínimo, para la venta online es «Agotado». La que tiene la venta
    // frenada lo sigue estando.
    functions: functions.map((fn) => ({
      ...fn,
      state: functionState(fn.left, fn.capacity, minPartySize, fn.state === 'paused'),
    })),
    draft: !row.published,
  }
}

export type PublicCatalog = {
  venue: PublicVenue
  experiences: PublicExperience[]
  /**
   * Las sucursales con funciones en la cartelera, la principal primero. Con más de una, cada
   * función dice dónde es y arriba se elige la sucursal.
   */
  branches: PublicBranch[]
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

  const [venue, { data: rows, error }, branchRows] = await Promise.all([
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
    loadBranches(service, tenant.id),
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
  const slugOf = branchSlugLookup(branchRows)
  return {
    venue,
    today: todayIn(tz),
    experiences: experiences.map((e) =>
      toPublicExperience(e, toPublicFunctions(functions.get(e.template_id) ?? [], slugOf)),
    ),
    branches: sellingBranches(
      branchRows,
      [...functions.values()].flatMap((list) => list.map((fn) => fn.branchId)),
    ),
    preview: Boolean(opts.includeUnpublished) && experiences.some((e) => !e.published),
  }
}

/**
 * Las sucursales que venden algo en la cartelera (todas las películas publicadas, no solo una):
 * con más de una, la página de una película dice dónde es cada función aunque esa vaya en una sola.
 * No suma lugares: solo mira qué sucursales tienen funciones por delante.
 */
async function loadSellingBranchIds(
  service: SBAny,
  tenantId: string,
  tz: string,
): Promise<string[]> {
  const { data: films, error } = await service
    .from('event_experiences')
    .select('template_id')
    .eq('tenant_id', tenantId)
    .eq('published', true)
  if (error) {
    console.error('[ticketing.loadSellingBranchIds]', { tenantId, code: error.code })
    return []
  }
  const templateIds = ((films as Array<{ template_id: string }> | null) ?? []).map(
    (f) => f.template_id,
  )
  if (templateIds.length === 0) return []
  const { data: events, error: eventsError } = await service
    .from('scheduled_events')
    .select('branch_id, event_date, starts_at_local')
    .eq('tenant_id', tenantId)
    .in('template_id', templateIds)
    .eq('private_group', false)
    .gte('event_date', todayIn(tz))
  if (eventsError) {
    console.error('[ticketing.loadSellingBranchIds.events]', { tenantId, code: eventsError.code })
    return []
  }
  const nowLocal = nowLocalIn(tz)
  return (
    (events as Array<{
      branch_id: string | null
      event_date: string
      starts_at_local: string
    }> | null) ?? []
  )
    .filter((e) => e.branch_id && isOnSale(e.event_date, e.starts_at_local, nowLocal))
    .map((e) => e.branch_id as string)
}

export type PublicExperiencePage = {
  venue: PublicVenue
  experience: PublicExperience
  /** Las otras películas publicadas (para «Seguí mirando»). */
  others: Array<Pick<PublicExperience, 'slug' | 'title' | 'posterUrl' | 'accent'>>
  /**
   * Las sucursales que venden en la cartelera, más las de esta película. Con más de una, cada
   * función dice dónde es; la dirección es siempre la de la sucursal de la función elegida.
   */
  branches: PublicBranch[]
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

  const [venue, functions, { data: otherRows }, branchRows, sellingIds] = await Promise.all([
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
    loadBranches(service, tenant.id),
    loadSellingBranchIds(service, tenant.id, tz),
  ])
  const own = functions.get(experience.template_id) ?? []

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
    experience: toPublicExperience(
      experience,
      toPublicFunctions(own, branchSlugLookup(branchRows)),
    ),
    others,
    // Las de la película también: en la vista previa de una apagada, sus funciones no están en
    // la cartelera, pero igual tienen que decir dónde son.
    branches: sellingBranches(branchRows, [...sellingIds, ...own.map((fn) => fn.branchId)]),
    today: todayIn(tz),
    preview: !experience.published,
  }
}

// ──────────────────────────────────────────────
// La entrada del cliente
// ──────────────────────────────────────────────

const ORDER_PUBLIC_COLUMNS =
  'id, tenant_id, branch_id, experience_id, scheduled_event_id, reservation_id, title, event_date, event_time, party_size, payment_option, unit_price_cents, full_price_cents, total_cents, balance_cash_only, guest_name, status, hold_expires_at, paid_cents, paid_at, mp_status_detail, mp_preference_id, mp_payment_id, mp_payment_type, terms'

type OrderPublicRow = Pick<
  TicketOrderRow,
  | 'id'
  | 'tenant_id'
  | 'branch_id'
  | 'experience_id'
  | 'scheduled_event_id'
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
  'status, reservation_date, reservation_time_local, estimated_guests, actual_guests, arrived_at, branch_id'

type OrderReservationRow = {
  status: string
  reservation_date: string
  reservation_time_local: string
  estimated_guests: number
  actual_guests: number | null
  arrived_at: string | null
  /** La reserva sigue al evento: si lo mudaron de sucursal, esta es la de ahora. */
  branch_id: string | null
}

/**
 * Dónde es una entrada: la sucursal de su reserva (sigue al evento) o, sin reserva, la de la
 * compra. La dirección es la de esa sucursal (o la del bar si no cargó una), y el nombre se dice
 * solo si el bar tiene más de una sucursal abierta.
 */
function orderPlace(
  branchRows: ReadonlyArray<TicketBranchRow>,
  branchId: string | null,
  venueAddress: string | null,
): { address: string | null; branch: PublicOrder['branch'] } {
  const row = branchId ? branchRows.find((b) => b.id === branchId) : undefined
  const branch = row ? toPublicBranch(row) : null
  const several = branchRows.filter((b) => b.active).length > 1
  return {
    address: functionAddress(branch, venueAddress),
    branch: several && branch ? { slug: branch.slug, name: branch.name } : null,
  }
}

export function isOrderExpired(
  status: OrderStatus,
  holdExpiresAt: string,
  now: Date = new Date(),
): boolean {
  return (status === 'pending' || status === 'rejected') && new Date(holdExpiresAt) <= now
}

/**
 * ¿La función todavía tiene lugar para esta compra? Para el pago rechazado con el lugar
 * ya vencido: mientras haya, la entrada sigue mostrando cómo transferir. La misma cuenta
 * que la cartelera (funciones abiertas, sin empezar, a la venta y con lugar para todo el grupo).
 * Ante cualquier duda, no: mostrar la cuenta de más termina en sobrecupo.
 */
export async function orderHasRoom(
  service: SBAny,
  tenantId: string,
  eventId: string | null,
  partySize: number,
  tz: string,
): Promise<boolean> {
  if (!eventId) return false
  const { data: event, error } = await service
    .from('scheduled_events')
    .select('event_date, starts_at_local, capacity, private_group, online_sales_paused')
    .eq('tenant_id', tenantId)
    .eq('id', eventId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.orderHasRoom]', { tenantId, code: error.code })
    return false
  }
  const ev = event as {
    event_date: string
    starts_at_local: string
    capacity: number
    private_group: boolean
    online_sales_paused: boolean | null
  } | null
  if (!ev || ev.private_group || !isOnSale(ev.event_date, ev.starts_at_local, nowLocalIn(tz))) {
    return false
  }
  // Con la venta frenada no se ofrece comprar de nuevo: el lugar ya venció y esa fecha no se vende.
  if (ev.online_sales_paused === true) return false
  const { data: seats, error: seatsError } = await service.rpc('ticketing_event_seats', {
    p_tenant_id: tenantId,
    p_event_ids: [eventId],
  })
  if (seatsError) {
    console.error('[ticketing.orderHasRoom.seats]', { tenantId, code: seatsError.code })
    return false
  }
  const s = (seats as SeatsRow[] | null)?.[0]
  return seatsLeft(s?.capacity ?? ev.capacity, s?.taken ?? 0, s?.held ?? 0) >= partySize
}

export type PublicOrderPage = {
  venue: PublicVenue
  order: PublicOrder
  /** Dónde es la función: la dirección de su sucursal o, si no cargó, la del bar. */
  address: string | null
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

  const tz = tenant.timezone ?? DEFAULT_TZ
  const expired = isOrderExpired(order.status, order.hold_expires_at)
  const [
    venue,
    { data: exp },
    { data: mode },
    { data: res, error: resError },
    roomLeft,
    branchRows,
  ] = await Promise.all([
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
    order.status === 'rejected' && expired
      ? orderHasRoom(service, tenant.id, order.scheduled_event_id, order.party_size, tz)
      : Promise.resolve(false),
    loadBranches(service, tenant.id),
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
  const today = serviceDayIn(tz)
  const entry = orderEntryFrom(reservation, order.party_size, (iso) =>
    formatInTimeZone(new Date(iso), tz, 'HH:mm'),
  )
  // La reserva sigue al evento: si lo movieron, la entrada dice la fecha nueva (y la sucursal).
  const date = reservation?.reservation_date ?? order.event_date
  const time = formatTime(reservation?.reservation_time_local ?? order.event_time)
  const place = orderPlace(
    branchRows,
    reservation?.branch_id ?? order.branch_id ?? null,
    venue.address,
  )
  // El QR solo si todavía puede usarse. Un pedido sin reserva (la función ya no
  // existe) también lo lleva: en la puerta avisa, y quien recibe lo resuelve.
  const usable =
    order.status === 'approved' && !entry.cancelled && entry.inside < entry.total && date >= today

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
    address: place.address,
    order: {
      id: order.id,
      shortCode: shortCodeFromOrderId(order.id),
      status: order.status,
      expired,
      holdExpiresAt: order.hold_expires_at,
      roomLeft,
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
      branch: place.branch,
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
  const [venue, { data: next }, branchRows] = await Promise.all([
    loadVenue(service, tenant),
    service
      .from('scheduled_events')
      .select('event_date, starts_at_local, branch_id')
      .eq('tenant_id', tenant.id)
      .eq('template_id', experience.template_id)
      // Una función que todavía no fue: sin el botón fijo de la noche, que taparía la escena.
      .gt('event_date', today)
      .order('event_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadBranches(service, tenant.id),
  ])
  const event = next as {
    event_date: string
    starts_at_local: string
    branch_id: string | null
  } | null
  // Sin función por delante, la principal: es donde cae lo que no dice sucursal.
  const place = orderPlace(
    branchRows,
    event?.branch_id ?? branchRows.find((b) => b.is_default)?.id ?? null,
    venue.address,
  )

  const partySize = Math.min(Math.max(options.people ?? 2, 1), 10)
  const deposit = Number(experience.deposit_cents) > 0
  const unit = deposit ? Number(experience.deposit_cents) : Number(experience.price_cents)
  const name = options.name?.trim().slice(0, 24) || 'Nacho'
  const total = unit * partySize
  const now = new Date()
  return {
    venue,
    address: place.address,
    order: {
      id: SAMPLE_ORDER_ID,
      shortCode: 'MUESTRA0',
      status: 'approved',
      expired: false,
      // Como una compra recién hecha: el pago rechazado de la muestra dice una hora creíble.
      holdExpiresAt: new Date(now.getTime() + venue.holdMinutes * 60_000).toISOString(),
      roomLeft: true,
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
      branch: place.branch,
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

export type AdminExperience = Omit<PublicExperience, 'functions'> & {
  /** Las funciones de la sucursal que se mira (en «Todas», las de todas, cada una con la suya). */
  functions: AdminFunction[]
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

/**
 * Todo lo de la pestaña Entradas: las películas (del bar), sus funciones (de la sucursal que se
 * mira, `branch`) y los formatos libres.
 */
export async function getAdminOverview(
  tenantId: string,
  branch: BranchFilter = WHOLE_BAR,
): Promise<AdminOverview> {
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
    branch,
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

/** El editor de una película: la película (del bar) y sus funciones de la sucursal que se mira. */
export async function getAdminExperience(
  tenantId: string,
  id: string,
  branch: BranchFilter = WHOLE_BAR,
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
    loadFunctions(createServiceClient() as SBAny, tenantId, [row.template_id], DEFAULT_TZ, branch),
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

/** Una función que viene, con su cupo y cómo va, para la pestaña Funciones de Ventas online. */
export type CapacityFunction = {
  eventId: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  time: string
  capacity: number
  /** Reservas en pie: las de la venta online y las que carga el bar a mano. */
  reserved: number
  /** Compras que se están pagando ahora: su lugar está guardado. */
  paying: number
  /** Lo que queda a la venta. */
  left: number
  /** La página de la película: sirve para filtrar la lista por película. */
  slug: string
  title: string
  accent: string
  /** La película está apagada: no se vende, pero el cupo se puede dejar listo. */
  published: boolean
  /**
   * La venta online de esta fecha está frenada: en la cartelera dice «Próximamente» y no se
   * puede comprar. Las reservas que se cargan a mano entran igual.
   */
  paused: boolean
  /** La sucursal de la función: el cupo es de esa sala y nunca se suma con el de otra. */
  branchId: string | null
}

type FilmRow = {
  template_id: string
  slug: string
  title: string
  accent_hex: string | null
  published: boolean
}

type FilmByTemplate = { slug: string; title: string; accent: string; published: boolean }

/**
 * Las películas del bar por formato del calendario. Son del dueño por RLS, pero la pestaña
 * Funciones también la usa la anfitriona: se leen con service_role, como la cartelera, y de acá
 * sale solo lo que la cartelera ya muestra (título y color).
 */
async function loadFilmsByTemplate(
  service: SBAny,
  tenantId: string,
): Promise<Map<string, FilmByTemplate>> {
  const { data, error } = await service
    .from('event_experiences')
    .select('template_id, slug, title, accent_hex, published')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('[ticketing.loadFilmsByTemplate]', { tenantId, code: error.code })
    throw new Error('No pudimos cargar las películas.')
  }
  const films = new Map<string, FilmByTemplate>()
  for (const row of (data as FilmRow[] | null) ?? []) {
    if (films.has(row.template_id)) continue
    films.set(row.template_id, {
      slug: row.slug,
      title: row.title,
      accent: row.accent_hex ?? DEFAULT_ACCENT,
      published: row.published,
    })
  }
  return films
}

/**
 * Las funciones que vienen de todas las películas, de la más cercana a la más lejana, con su
 * cupo. Para Ventas online › Funciones: los socios pidieron el 11/11/2026 poder cambiar cuántos
 * entran sin pedírselo a nadie («normalmente va a ser 54, el del cine»), y que lo pueda hacer
 * Luz. Las que ya empezaron y las de grupos privados no aparecen, igual que en la cartelera.
 * Solo las de la sucursal que se mira (`branch`).
 */
export async function listCapacityFunctions(
  tenantId: string,
  branch: BranchFilter = WHOLE_BAR,
): Promise<CapacityFunction[]> {
  const service = createServiceClient() as SBAny
  const films = await loadFilmsByTemplate(service, tenantId)
  const rows = await loadFunctionSeats(service, tenantId, [...films.keys()], DEFAULT_TZ, branch)
  return rows.flatMap(({ event: e, capacity, taken, held, paused }) => {
    const film = films.get(e.template_id)
    if (!film) return []
    return [
      {
        eventId: e.id,
        date: e.event_date,
        time: formatTime(e.starts_at_local),
        capacity,
        reserved: taken,
        paying: held,
        left: seatsLeft(capacity, taken, held),
        slug: film.slug,
        title: film.title,
        accent: film.accent,
        published: film.published,
        paused,
        branchId: e.branch_id ?? null,
      },
    ]
  })
}

/**
 * Una función de la cartelera que todavía se puede tocar (es de una película, no es de un grupo
 * privado y no empezó) con sus lugares y su sucursal, para cambiarle el cupo o frenarle la venta.
 * `null` si no lo es.
 */
export async function getCapacityFunction(
  tenantId: string,
  eventId: string,
): Promise<Pick<
  CapacityFunction,
  'capacity' | 'reserved' | 'paying' | 'paused' | 'branchId'
> | null> {
  const service = createServiceClient() as SBAny
  const { data, error } = await service
    .from('scheduled_events')
    .select('template_id')
    .eq('tenant_id', tenantId)
    .eq('id', eventId)
    .maybeSingle()
  if (error) {
    console.error('[ticketing.getCapacityFunction]', { tenantId, code: error.code })
    throw new Error('No pudimos leer la función.')
  }
  const templateId = (data as { template_id: string | null } | null)?.template_id
  if (!templateId) return null
  const films = await loadFilmsByTemplate(service, tenantId)
  if (!films.has(templateId)) return null
  const rows = await loadFunctionSeats(service, tenantId, [templateId], DEFAULT_TZ)
  const row = rows.find((r) => r.event.id === eventId)
  if (!row) return null
  return {
    capacity: row.capacity,
    reserved: row.taken,
    paying: row.held,
    paused: row.paused,
    branchId: row.event.branch_id ?? null,
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
async function withUndos<T extends Omit<AdminOrder, 'undo'>>(
  supabase: SBAny,
  tenantId: string,
  orders: T[],
): Promise<Array<T & { undo: OrderUndo | null }>> {
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

/** Una compra de Ventas online: la de siempre, con la sucursal de su función. */
export type SalesOrder = AdminOrder & {
  /** La copia la base de la función al comprar. Mirando «Todas», cada renglón la dice. */
  branch_id: string | null
}

/** Las mismas columnas y el mismo embebido de siempre (una sola relación con la reserva), más la sucursal. */
const SALES_ORDER_COLUMNS = `branch_id, ${ADMIN_ORDER_COLUMNS}`

/**
 * Ventas online, una página (lib/ticketing/sales-days.ts): las compras que entraron entre
 * `fromIso` (inclusive) y `toIso` (exclusivo), de la más nueva a la más vieja, y cuándo entró la
 * anterior más nueva, para «Ver días anteriores». Las leen el dueño y la anfitriona, cada uno con
 * su sesión (policies ticket_orders_owner_select y ticket_orders_host_select).
 *
 * `undos: false` no busca los «Deshacer» de la puerta: es lo que ve la anfitriona, que no lee
 * audit_log. Lo pasa la página según el rol, así «Ver como» (lib/tenant/view-as.ts) muestra lo
 * mismo que ve ella aunque la sesión sea la del dueño.
 *
 * `branch`: las de la sucursal que se mira (`ticket_orders.branch_id`). «Ver días anteriores»
 * también, así salta a la venta anterior de esa sucursal y no a una semana vacía.
 */
export async function listOrdersBetween(
  tenantId: string,
  fromIso: string,
  toIso: string,
  options: { undos?: boolean; branch?: BranchFilter } = {},
): Promise<{ orders: SalesOrder[]; olderCreatedAt: string | null }> {
  const supabase = (await createClient()) as SBAny
  const branch = options.branch ?? WHOLE_BAR
  const [page, older] = await Promise.all([
    applyBranchFilter(
      supabase
        .from('ticket_orders')
        .select(SALES_ORDER_COLUMNS)
        .eq('tenant_id', tenantId)
        .gte('created_at', fromIso)
        .lt('created_at', toIso),
      branch,
    ).order('created_at', { ascending: false }),
    applyBranchFilter(
      supabase
        .from('ticket_orders')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .lt('created_at', fromIso),
      branch,
    )
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
  const rows = (page.data as Omit<SalesOrder, 'undo'>[] | null) ?? []
  return {
    orders:
      options.undos === false
        ? rows.map((o) => ({ ...o, undo: null }))
        : await withUndos(supabase, tenantId, rows),
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
