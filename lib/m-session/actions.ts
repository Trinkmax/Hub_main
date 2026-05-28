'use server'

import type { z } from 'zod'
import { getRequestIp, getRequestUserAgent } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import {
  cancelTicketSchema,
  joinSessionSchema,
  registerCustomerSchema,
  requestBillSchema,
  submitTicketSchema,
} from './schemas'

export type JoinSessionResult =
  | { ok: true; sessionId: string; guestId: string; wasNewGuest: boolean }
  | { ok: false; message: string }

export type RegisterCustomerResult =
  | {
      ok: true
      customerId: string
      wasNewCustomer: boolean
      // Cuando el RPC otorgó un welcome reward al cliente nuevo, devolvemos
      // los datos para que la UI muestre el toast/closing screen. null si no
      // hubo grant (ya tenía uno previo, config disabled, sin stock, etc).
      welcomeReward?: { name: string; imageUrl: string | null; redemptionId: string } | null
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function joinSession(params: {
  qrToken: string
  browserToken: string
  displayName?: string | null
}): Promise<JoinSessionResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `m-join:${ip}`, limit: 30, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = joinSessionSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
    display_name: params.displayName ?? null,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('join_session_as_guest', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_display_name: parsed.data.display_name,
  })

  if (error) {
    if (error.message.includes('invalid_qr_token')) {
      return { ok: false, message: 'El QR no es válido o la mesa no está activa.' }
    }
    console.error('[m-session.joinSession]', error.message)
    return { ok: false, message: 'No pudimos unirte a la mesa.' }
  }

  const result = data as {
    session_id: string
    guest_id: string
    was_new_guest: boolean
  }
  return {
    ok: true,
    sessionId: result.session_id,
    guestId: result.guest_id,
    wasNewGuest: result.was_new_guest,
  }
}

export async function registerCustomer(formData: FormData): Promise<RegisterCustomerResult> {
  const ip = await getRequestIp()
  const userAgent = await getRequestUserAgent()

  try {
    rateLimit({ key: `m-register:${ip}`, limit: 10, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = registerCustomerSchema.safeParse({
    qr_token: formData.get('qr_token'),
    browser_token: formData.get('browser_token'),
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    birthdate: formData.get('birthdate') ?? '',
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
    website: formData.get('website') ?? '',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  // Honeypot anti-bot
  if (parsed.data.website && parsed.data.website.length > 0) {
    return { ok: false, message: 'Solicitud rechazada' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('register_customer_for_session', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_phone: parsed.data.phone,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
    p_birthdate: parsed.data.birthdate ?? null,
    p_opt_in_marketing: parsed.data.opt_in_marketing,
    p_ip: ip,
    p_user_agent: userAgent ?? '',
  })

  if (error) {
    if (error.message.includes('no_active_session')) {
      return { ok: false, message: 'No hay una mesa activa para este QR.' }
    }
    if (error.message.includes('guest_not_found')) {
      return { ok: false, message: 'Volvé a escanear el QR.' }
    }
    if (error.message.includes('invalid_phone')) {
      return { ok: false, message: 'Teléfono inválido' }
    }
    console.error('[m-session.registerCustomer]', error.message)
    return { ok: false, message: 'No pudimos guardar tus datos.' }
  }

  // El RPC extendido devuelve también welcome_redemption_id + name + image_url
  // cuando se generó un welcome reward para este customer. Si no aplica, esos
  // 3 campos son null.
  const result = data as {
    customer_id: string
    was_new_customer: boolean
    welcome_redemption_id: string | null
    welcome_reward_name: string | null
    welcome_reward_image_url: string | null
  }
  const welcomeReward =
    result.welcome_redemption_id && result.welcome_reward_name
      ? {
          name: result.welcome_reward_name,
          imageUrl: result.welcome_reward_image_url,
          redemptionId: result.welcome_redemption_id,
        }
      : null
  return {
    ok: true,
    customerId: result.customer_id,
    wasNewCustomer: result.was_new_customer,
    welcomeReward,
  }
}

export type SubmitTicketResult =
  | {
      ok: true
      ticketId: string
      status: string
      idempotentReplay: boolean
      totalCents?: number
    }
  | { ok: false; message: string }

export type CancelTicketResult = { ok: true } | { ok: false; message: string }

export type RequestBillResult =
  | { ok: true; alreadyRequested: boolean }
  | { ok: false; message: string }

export type SessionStateData = {
  session_id: string
  tenant_id: string
  tenant_name: string
  // Logo del tenant para el header del QR del cliente. null si no está cargado.
  tenant_logo_url: string | null
  table_label: string
  guest_id: string | null
  customer_id: string | null
  guest_count: number
  was_new_session: boolean
  menu: Array<{
    id: string
    name: string
    position: number
    items: Array<{
      id: string
      name: string
      description: string | null
      price_cents: number
      image_url: string | null
      position: number
      // Campos del rediseño 2026 — siempre presentes.
      featured: boolean
      points_override: number | null
      tags: Array<{ id: string; name: string; color: string }>
    }>
  }>
  // Welcome reward disponible para el cliente actual cuando no se registró aún.
  // Si no hay config válida, queda null.
  welcome_reward: {
    enabled: boolean
    reward_id: string
    name: string
    description: string | null
    image_url: string | null
    headline: string
    subtext: string
  } | null
  // Welcome reward ya entregado a este customer. Útil para closing screen.
  welcome_reward_redeemed: {
    reward_id: string
    name: string
    image_url: string | null
    redemption_id: string
    granted_at: string
    status: 'pending' | 'delivered' | 'cancelled'
  } | null
  my_tickets: Array<{
    id: string
    status: string
    submitted_at: string
    total_cents: number
    cancellation_reason: string | null
    items: Array<{
      id: string
      menu_item_name: string | null
      quantity: number
      unit_price_cents: number
      line_total_cents: number
      notes: string | null
      cancelled_at: string | null
    }>
  }>
}

export type SessionStateResult =
  | { ok: true; data: SessionStateData }
  | { ok: false; message: string }

export async function refreshState(params: {
  qrToken: string
  browserToken: string
}): Promise<SessionStateResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_session_state', {
    p_qr_token: params.qrToken,
    p_browser_token: params.browserToken,
  })
  if (error) {
    if (error.message.includes('invalid_qr_token')) {
      return { ok: false, message: 'El QR no es válido.' }
    }
    console.error('[m-session.refreshState]', error.message)
    return { ok: false, message: 'No se pudo cargar la mesa.' }
  }
  return { ok: true, data: data as SessionStateData }
}

export async function submitTicket(params: {
  qrToken: string
  browserToken: string
  items: Array<{
    menu_item_id: string
    quantity: number
    notes?: string | null
    assigned_to_guest_id?: string | null
  }>
  idempotencyKey: string
}): Promise<SubmitTicketResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `m-submit:${ip}`, limit: 60, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Demasiados pedidos seguidos. Esperá un momento.' }
    }
    throw e
  }

  const parsed = submitTicketSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
    items: params.items,
    idempotency_key: params.idempotencyKey,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_ticket', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
    p_items: parsed.data.items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      notes: i.notes ?? null,
      assigned_to_guest_id: i.assigned_to_guest_id ?? null,
    })),
    p_idempotency_key: parsed.data.idempotency_key,
  })

  if (error) {
    if (error.message.includes('no_active_session')) {
      return { ok: false, message: 'La sesión no está activa.' }
    }
    if (error.message.includes('guest_not_found')) {
      return { ok: false, message: 'Volvé a escanear el QR.' }
    }
    if (error.message.includes('menu_item_not_available')) {
      return { ok: false, message: 'Algún ítem ya no está disponible.' }
    }
    if (error.message.includes('empty_cart')) {
      return { ok: false, message: 'Tu carrito está vacío.' }
    }
    console.error('[m-session.submitTicket]', error.message)
    return { ok: false, message: 'No pudimos enviar tu pedido.' }
  }

  const result = data as {
    ticket_id: string
    status: string
    total_cents?: number
    idempotent_replay: boolean
  }
  return {
    ok: true,
    ticketId: result.ticket_id,
    status: result.status,
    idempotentReplay: result.idempotent_replay,
    totalCents: result.total_cents,
  }
}

export async function cancelTicket(params: {
  ticketId: string
  browserToken: string
}): Promise<CancelTicketResult> {
  const parsed = cancelTicketSchema.safeParse({
    ticket_id: params.ticketId,
    browser_token: params.browserToken,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_pending_ticket', {
    p_ticket_id: parsed.data.ticket_id,
    p_browser_token: parsed.data.browser_token,
  })
  if (error) {
    if (error.message.includes('cancel_window_expired')) {
      return { ok: false, message: 'Ya pasó el tiempo para cancelar.' }
    }
    if (error.message.includes('ticket_not_cancellable')) {
      return { ok: false, message: 'Esta comanda ya no se puede cancelar.' }
    }
    console.error('[m-session.cancelTicket]', error.message)
    return { ok: false, message: 'No se pudo cancelar.' }
  }
  return { ok: true }
}

export type LoyaltyState = {
  registered: boolean
  customer_id?: string
  first_name?: string
  points_balance?: number
  active_cards?: Array<{
    card_id: string
    template_id: string
    template_name: string
    description: string | null
    image_url: string | null
    current_stamps: number
    threshold: number
    reward_name: string
  }>
}

export async function getLoyaltyState(params: {
  qrToken: string
  browserToken: string
}): Promise<{ ok: true; data: LoyaltyState } | { ok: false; message: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_loyalty_state', {
    p_qr_token: params.qrToken,
    p_browser_token: params.browserToken,
  })
  if (error) {
    console.error('[m-session.getLoyaltyState]', error.message)
    return { ok: false, message: 'No se pudo cargar tu cuenta de puntos.' }
  }
  return { ok: true, data: data as LoyaltyState }
}

export async function requestBill(params: {
  qrToken: string
  browserToken: string
}): Promise<RequestBillResult> {
  const parsed = requestBillSchema.safeParse({
    qr_token: params.qrToken,
    browser_token: params.browserToken,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_bill', {
    p_qr_token: parsed.data.qr_token,
    p_browser_token: parsed.data.browser_token,
  })
  if (error) {
    if (error.message.includes('no_active_session')) {
      return { ok: false, message: 'La sesión no está activa.' }
    }
    console.error('[m-session.requestBill]', error.message)
    return { ok: false, message: 'No se pudo avisar al mozo.' }
  }
  const result = data as { already_requested?: boolean; requested?: boolean }
  return { ok: true, alreadyRequested: Boolean(result.already_requested) }
}
