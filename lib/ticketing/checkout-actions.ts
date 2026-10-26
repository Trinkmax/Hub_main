'use server'

import { formatInTimeZone } from 'date-fns-tz'
import { getAppUrl } from '@/lib/app-url'
import { getRequestIp } from '@/lib/ip'
import { createPreference, type PreferenceInput } from '@/lib/mercadopago/client'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { mealTypeToSave } from '@/lib/salon/segments'
import { createServiceClient } from '@/lib/supabase/service'
import { getMercadoPagoCredentials } from './credentials'
import { DEFAULT_TZ, formatShortDate, formatTime } from './dates'
import { centsToMercadoPagoAmount } from './pricing'
import { isOrderExpired } from './queries'
import { type CheckoutInput, checkoutSchema, orderIdSchema } from './schemas'
import { reconcileOrder, reconcilePaymentById } from './settle'
import type { OrderStatus, TicketOrderRow } from './types'

/**
 * Las acciones de la compra pública: las llama gente SIN cuenta desde
 * /entradas/<bar>/<película>.
 *
 * Usan service_role del lado del server, igual que el resto de lo público del
 * bar (carta, club, landings): validan todo con zod, tienen rate limit por IP
 * y cada escritura pasa por las funciones de la base, que vuelven a chequear
 * cupo, precio y fecha (ticketing_create_order). El navegador nunca ve ni el
 * token de Mercado Pago ni nada del pedido más allá de su id.
 */

// biome-ignore lint/suspicious/noExplicitAny: tablas nuevas, sin tipos generados todavía
type SBAny = any

export type CheckoutResult =
  | { ok: true; redirectUrl: string; orderId: string }
  | { ok: false; message: string; field?: string; seatsLeft?: number }

const MP_DATE = "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"

function seatsMessage(left: number): string {
  if (left <= 0) return 'Se acaban de agotar los lugares de esta fecha. Probá con otra.'
  if (left === 1) return 'Queda solo 1 lugar para esta fecha.'
  return `Quedan solo ${left} lugares para esta fecha.`
}

function createOrderErrorMessage(message: string, details: string | null): CheckoutResult {
  if (message.includes('ticketing_not_enough_seats')) {
    const left = Number.parseInt(details ?? '0', 10)
    const seatsLeft = Number.isFinite(left) ? Math.max(0, left) : 0
    return { ok: false, message: seatsMessage(seatsLeft), field: 'party_size', seatsLeft }
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
  return {
    ok: false,
    message: 'Esta función ya no está a la venta. Elegí otra fecha.',
    field: 'event_id',
  }
}

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  const ip = await getRequestIp()
  try {
    // Cada intento guarda lugares unos minutos: sin techo, alguien podría
    // vaciar una función a fuerza de pedidos sin pagar.
    rateLimit({ key: `ticket-checkout:${ip}`, limit: 8, windowMs: 10 * 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Hiciste muchos intentos seguidos. Esperá unos minutos.' }
    }
    throw e
  }

  const parsed = checkoutSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      message: first?.message ?? 'Revisá los datos.',
      field: first?.path[0]?.toString(),
    }
  }
  const data = parsed.data

  const service = createServiceClient() as SBAny
  const { data: tenant } = await service
    .from('tenants')
    .select('id, slug, name, timezone')
    .eq('slug', data.tenant_slug)
    .maybeSingle()
  if (!tenant) return { ok: false, message: 'No encontramos este bar.' }
  const tz: string = tenant.timezone ?? DEFAULT_TZ

  const [{ data: experience }, { data: event }, creds] = await Promise.all([
    service
      .from('event_experiences')
      .select('id, title, poster_url, published')
      .eq('tenant_id', tenant.id)
      .eq('slug', data.experience_slug)
      .maybeSingle(),
    service
      .from('scheduled_events')
      .select('id, starts_at_local, event_date')
      .eq('tenant_id', tenant.id)
      .eq('id', data.event_id)
      .maybeSingle(),
    getMercadoPagoCredentials(tenant.id),
  ])
  if (!experience?.published || !event) {
    return { ok: false, message: 'Esta función ya no está a la venta.', field: 'event_id' }
  }
  if (!creds) {
    return {
      ok: false,
      message: 'Este bar todavía no cobra online. Escribinos por WhatsApp y te reservamos.',
    }
  }

  const { data: created, error: createError } = await service.rpc('ticketing_create_order', {
    p_tenant_id: tenant.id,
    p_experience_id: experience.id,
    p_event_id: event.id,
    p_party_size: data.party_size,
    p_option: data.option,
    p_guest_name: data.guest_name,
    p_guest_phone: data.guest_phone,
    p_marketing_opt_in: data.marketing_opt_in,
    p_client_ip: ip,
    // El servicio sale de la hora del evento (R2 de docs/reservas.md): Cine
    // y degustación a las 21:00 es cena y cobra la tarifa de cena.
    p_meal_type: mealTypeToSave('dinner', { starts_at_local: event.starts_at_local }),
  })
  if (createError) {
    return createOrderErrorMessage(createError.message ?? '', createError.details ?? null)
  }
  const order = created as TicketOrderRow

  const appUrl = await getAppUrl()
  const secure = appUrl.startsWith('https://')
  const ticketUrl = `${appUrl}/entradas/${tenant.slug}/mi-entrada/${order.id}`
  const [firstName, ...rest] = data.guest_name.split(/\s+/)

  const preference: PreferenceInput = {
    items: [
      {
        id: experience.id,
        title: `${experience.title} · ${formatShortDate(order.event_date)} ${formatTime(order.event_time)}`,
        description:
          order.payment_option === 'deposit'
            ? `Seña por persona · ${tenant.name}`
            : `Entrada por persona · ${tenant.name}`,
        picture_url:
          typeof experience.poster_url === 'string' && experience.poster_url.startsWith('https://')
            ? experience.poster_url
            : undefined,
        category_id: 'entertainment',
        quantity: order.party_size,
        currency_id: 'ARS',
        unit_price: centsToMercadoPagoAmount(order.unit_price_cents),
      },
    ],
    payer: { name: firstName, surname: rest.join(' ') || undefined },
    back_urls: { success: ticketUrl, pending: ticketUrl, failure: ticketUrl },
    // Mercado Pago solo vuelve solo a una URL https; en local se vuelve con el
    // botón «Volver al sitio».
    auto_return: secure ? 'approved' : undefined,
    notification_url: secure ? `${appUrl}/api/webhooks/mercadopago?t=${tenant.id}` : undefined,
    external_reference: order.id,
    // La preferencia vence junto con el lugar guardado: nadie puede pagar un
    // lugar que ya se liberó.
    expires: true,
    expiration_date_from: formatInTimeZone(new Date(), tz, MP_DATE),
    expiration_date_to: formatInTimeZone(new Date(order.hold_expires_at), tz, MP_DATE),
    // Aprobado o rechazado al instante: sin pagos «en revisión» que tengan el
    // lugar colgado. Y sin efectivo en Rapipago/Pago Fácil, que se acredita
    // días después (el lugar no se puede guardar tanto).
    binary_mode: true,
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
    metadata: { tenant_id: tenant.id, order_id: order.id },
  }

  try {
    const pref = await createPreference(creds.accessToken, preference, order.id)
    await service
      .from('ticket_orders')
      .update({ mp_preference_id: pref.id })
      .eq('id', order.id)
      .eq('tenant_id', tenant.id)
    const redirectUrl = creds.live ? pref.init_point : (pref.sandbox_init_point ?? pref.init_point)
    return { ok: true, redirectUrl, orderId: order.id }
  } catch (error) {
    // Sin preferencia no hay pago posible: se libera el lugar ya mismo.
    await service
      .from('ticket_orders')
      .update({ hold_expires_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('tenant_id', tenant.id)
    console.error('[ticketing.checkout] no se pudo crear la preferencia', {
      tenantId: tenant.id,
      orderId: order.id,
      error: error instanceof Error ? error.message : 'unknown',
    })
    return { ok: false, message: 'No pudimos abrir Mercado Pago. Probá de nuevo en un ratito.' }
  }
}

// ──────────────────────────────────────────────
// La entrada pregunta por su pedido
// ──────────────────────────────────────────────

export type OrderRefreshResult =
  | {
      ok: true
      status: OrderStatus
      expired: boolean
      paidCents: number | null
      statusDetail: string | null
    }
  | { ok: false }

/** Para no ir a Mercado Pago en cada vuelta del polling (por instancia). */
const lastRemoteCheck = new Map<string, number>()
const REMOTE_CHECK_EVERY_MS = 6_000

/**
 * La entrada del cliente pregunta cómo va su pedido. Si vuelve de Mercado Pago
 * con ?payment_id= se aplica ese pago (camino rápido: no espera al webhook);
 * si sigue pendiente, cada tanto busca los pagos del pedido en Mercado Pago.
 */
export async function refreshOrder(input: {
  tenantSlug: string
  orderId: string
  paymentId?: string | null
}): Promise<OrderRefreshResult> {
  const orderId = orderIdSchema.safeParse(input.orderId)
  if (!orderId.success) return { ok: false }
  const paymentId = input.paymentId && /^\d{1,24}$/.test(input.paymentId) ? input.paymentId : null

  const ip = await getRequestIp()
  try {
    rateLimit({ key: `ticket-refresh:${ip}`, limit: 60, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) return { ok: false }
    throw e
  }

  const service = createServiceClient() as SBAny
  const { data: tenant } = await service
    .from('tenants')
    .select('id')
    .eq('slug', input.tenantSlug)
    .maybeSingle()
  if (!tenant) return { ok: false }

  const read = async () => {
    const { data } = await service
      .from('ticket_orders')
      .select('status, hold_expires_at, paid_cents, mp_status_detail, created_at')
      .eq('tenant_id', tenant.id)
      .eq('id', orderId.data)
      .maybeSingle()
    return data as Pick<
      TicketOrderRow,
      'status' | 'hold_expires_at' | 'paid_cents' | 'mp_status_detail' | 'created_at'
    > | null
  }

  let order = await read()
  if (!order) return { ok: false }

  if (order.status === 'pending' || order.status === 'rejected') {
    const last = lastRemoteCheck.get(orderId.data) ?? 0
    if (paymentId || Date.now() - last > REMOTE_CHECK_EVERY_MS) {
      lastRemoteCheck.set(orderId.data, Date.now())
      try {
        if (paymentId) {
          await reconcilePaymentById({
            tenantId: tenant.id,
            paymentId,
            expectOrderId: orderId.data,
            source: 'return',
          })
        } else {
          await reconcileOrder({ tenantId: tenant.id, orderId: orderId.data, source: 'poll' })
        }
        order = (await read()) ?? order
      } catch (error) {
        // Si Mercado Pago no contesta, la entrada sigue esperando: el webhook
        // también va a llegar.
        console.error('[ticketing.refreshOrder] no pudimos consultar Mercado Pago', {
          tenantId: tenant.id,
          orderId: orderId.data,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
    }
  }

  return {
    ok: true,
    status: order.status,
    expired: isOrderExpired(order.status, order.hold_expires_at),
    paidCents: order.paid_cents === null ? null : Number(order.paid_cents),
    statusDetail: order.mp_status_detail,
  }
}
