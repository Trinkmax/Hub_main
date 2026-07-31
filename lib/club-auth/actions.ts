'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { walletCookieName } from '@/lib/capture/cookie'
import { getRequestIp } from '@/lib/ip'
import { findOrCreateConversation, recordOutboundMessage } from '@/lib/meta/conversations'
import { MetaApiError, mapMetaErrorToStatus } from '@/lib/meta/errors'
import { sendTemplate, sendText, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  buildClubOtpConversationPreview,
  buildClubOtpTemplateVariables,
  buildClubOtpText,
  CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE,
  countTemplateBodyVariables,
  getClubOtpTemplateName,
} from './message'
import {
  clubLoginSchema,
  clubLogoutSchema,
  clubResetRequestSchema,
  clubSetPasswordSchema,
  clubVerifyCodeSchema,
} from './schemas'

/**
 * Cuenta del socio del club (el cliente final del bar), sin Supabase Auth.
 *
 * Antes el alta era un login SIN autenticación: `submit_capture` hacía upsert
 * por (tenant_id, phone) y devolvía el `qr_token` existiera o no el socio, así
 * que con saber un teléfono cualquiera se llevaba la credencial que el staff
 * escanea para acreditar y canjear puntos. Ahora hay contraseña (bcrypt en
 * `customer_credentials`) y la única forma de recuperar la sesión es un código
 * de 6 dígitos que sale por el WhatsApp del propio bar.
 *
 * Todas las acciones de este archivo son PÚBLICAS (el socio no tiene sesión de
 * Supabase): la defensa es la RPC `SECURITY DEFINER` + rate limit por IP y por
 * teléfono + mensajes genéricos que no permiten enumerar socios.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000 // ventana de mensajes libres de WhatsApp
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 días — misma sesión larga que el alta

/** Mismo mensaje para "no existe" y para "contraseña mal": no se enumera. */
const GENERIC_LOGIN_ERROR = 'Teléfono o contraseña incorrectos.'
/** Misma respuesta exista o no el socio, y falle o no el envío. */
const GENERIC_RESET_SENT = 'Si ese teléfono está registrado, te llega un código por WhatsApp.'

export type ClubLoginState =
  | { ok: true }
  | {
      ok: false
      /** `no_password` no es un error del socio: es un socio viejo, sin contraseña. */
      reason: 'invalid_credentials' | 'locked' | 'no_password' | 'error'
      message: string
    }

export type ClubResetRequestState = { ok: true; message: string } | { ok: false; message: string }

export type ClubVerifyCodeState =
  | { ok: true; reset_ticket: string }
  | { ok: false; message: string }

export type ClubSetPasswordState = { ok: true } | { ok: false; message: string }

// ──────────────────────────────────────────────────────────
// Helpers de lectura del jsonb que devuelven las RPC
// ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Sesión del socio: cookie httpOnly con el `qr_token`, igual que en el alta. */
async function setWalletCookie(tenantId: string, qrToken: string): Promise<void> {
  const store = await cookies()
  store.set(walletCookieName(tenantId), qrToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
}

/** `true` si se pudo consumir el cupo; `false` si hay que frenar al usuario. */
function withinLimit(key: string, limit: number, windowMs: number): boolean {
  try {
    rateLimit({ key, limit, windowMs })
    return true
  } catch (e) {
    if (e instanceof RateLimitedError) return false
    throw e
  }
}

// ──────────────────────────────────────────────────────────
// Envío del código por WhatsApp
// ──────────────────────────────────────────────────────────

type OtpDispatchOutcome = 'sent' | 'no_channel' | 'send_failed'

/**
 * Manda el código por el WhatsApp del bar y lo deja registrado en la bandeja.
 *
 * Dentro de la ventana de 24 h va como texto libre (llega siempre y se lee
 * mejor). Fuera de la ventana Meta sólo acepta plantillas aprobadas, así que
 * cae en la UTILITY configurada en `CLUB_OTP_TEMPLATE_NAME`.
 *
 * El código no se loguea NUNCA (ni en la bandeja del bar): sólo viaja a Meta.
 */
async function dispatchOtpOverWhatsApp(opts: {
  tenantId: string
  customerId: string
  phone: string
  firstName: string | null
  code: string
}): Promise<OtpDispatchOutcome> {
  const service = createServiceClient()

  const [{ data: channel }, { data: tenant }] = await Promise.all([
    service
      .from('channels')
      .select('*')
      .eq('tenant_id', opts.tenantId)
      .eq('type', 'whatsapp')
      .eq('status', 'connected')
      .maybeSingle(),
    service.from('tenants').select('name').eq('id', opts.tenantId).maybeSingle(),
  ])

  if (!channel) return 'no_channel'
  const tenantName = tenant?.name ?? 'el club'

  const conversationId = await findOrCreateConversation({
    tenantId: opts.tenantId,
    channelId: channel.id,
    externalUserId: opts.phone,
    customerId: opts.customerId,
  })

  const { data: conversation } = await service
    .from('conversations')
    .select('last_inbound_at')
    .eq('id', conversationId)
    .maybeSingle()

  const lastInboundAt = conversation?.last_inbound_at
    ? new Date(conversation.last_inbound_at).getTime()
    : null
  const insideWindow = lastInboundAt !== null && Date.now() - lastInboundAt < WINDOW_MS

  const templateName = insideWindow ? null : getClubOtpTemplateName()
  const preview = buildClubOtpConversationPreview(templateName)

  try {
    if (insideWindow) {
      const text = buildClubOtpText({
        firstName: opts.firstName,
        tenantName,
        code: opts.code,
      })
      const { meta_message_id } = await sendText(channel as WhatsAppChannelLike, opts.phone, text)
      await recordOutboundMessage({
        tenantId: opts.tenantId,
        conversationId,
        // El cuerpo real lleva el código: guardamos sólo el rótulo.
        body: preview,
        metaMessageId: meta_message_id,
        status: 'sent',
      })
      return 'sent'
    }

    const approved = await resolveApprovedTemplate(opts.tenantId, templateName ?? '')
    const { meta_message_id } = await sendTemplate(
      channel as WhatsAppChannelLike,
      opts.phone,
      templateName ?? '',
      approved.language,
      buildClubOtpTemplateVariables({
        firstName: opts.firstName,
        code: opts.code,
        variableCount: approved.variableCount,
      }),
    )
    await recordOutboundMessage({
      tenantId: opts.tenantId,
      conversationId,
      body: preview,
      metaMessageId: meta_message_id,
      status: 'sent',
    })
    return 'sent'
  } catch (e) {
    const reason = e instanceof MetaApiError ? mapMetaErrorToStatus(e).reason : (e as Error).message
    await recordOutboundMessage({
      tenantId: opts.tenantId,
      conversationId,
      body: preview,
      metaMessageId: null,
      status: 'failed',
      error: reason,
    })
    // Sin PII: tenant + customer (ids internos) + motivo real, para que el dueño
    // pueda diagnosticar por qué no le llega el código a sus socios.
    console.error('[club-auth] otp send failed', {
      tenantId: opts.tenantId,
      customerId: opts.customerId,
      template: templateName,
      reason,
    })
    return 'send_failed'
  }
}

/**
 * Idioma y cantidad de variables con las que el tenant tiene aprobada la
 * plantilla. Si todavía no la sincronizó, mandamos igual con los defaults: Meta
 * es la autoridad final y su error queda registrado en la bandeja.
 */
async function resolveApprovedTemplate(
  tenantId: string,
  templateName: string,
): Promise<{ language: string; variableCount: number | null }> {
  if (!templateName) {
    return { language: CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE, variableCount: null }
  }
  const service = createServiceClient()
  const { data } = await service
    .from('message_templates')
    .select('language, components')
    .eq('tenant_id', tenantId)
    .eq('name', templateName)
    .eq('status', 'approved')
    .maybeSingle()
  return {
    language: data?.language ?? CLUB_OTP_TEMPLATE_FALLBACK_LANGUAGE,
    variableCount: countTemplateBodyVariables(data?.components),
  }
}

/**
 * Pide el código a la DB y lo despacha. `club_request_reset` devuelve el código
 * EN CLARO y sólo tiene grant para `service_role`: por eso va con service client
 * desde el server y el código nunca vuelve al browser.
 */
async function issueAndSendOtp(opts: {
  linkSlug: string
  phone: string
  ip: string
}): Promise<void> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('club_request_reset', {
    p_link_slug: opts.linkSlug,
    p_phone: opts.phone,
    p_ip: opts.ip,
  })

  if (error) {
    console.error('[club-auth] club_request_reset failed', error.message)
    return
  }

  const result = asRecord(data)
  if (!result || result.ok !== true) {
    // 'not_found' | 'blocked' | 'rate_limited' → el socio ve el mismo genérico.
    return
  }

  const code = readString(result, 'code')
  const tenantId = readString(result, 'tenant_id')
  const customerId = readString(result, 'customer_id')
  const phone = readString(result, 'phone')
  if (!code || !tenantId || !customerId || !phone) {
    console.error('[club-auth] club_request_reset devolvió un payload incompleto')
    return
  }

  await dispatchOtpOverWhatsApp({
    tenantId,
    customerId,
    phone,
    firstName: readString(result, 'first_name'),
    code,
  })
}

// ──────────────────────────────────────────────────────────
// 1. Login
// ──────────────────────────────────────────────────────────

export async function clubLogin(formData: FormData): Promise<ClubLoginState> {
  const ip = await getRequestIp()
  if (!withinLimit(`club-login:ip:${ip}`, 12, 60_000)) {
    return { ok: false, reason: 'error', message: 'Esperá un minuto antes de reintentar.' }
  }

  const parsed = clubLoginSchema.safeParse({
    link_slug: formData.get('link_slug'),
    phone: formData.get('phone'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'error',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
    }
  }
  const { link_slug, phone, password } = parsed.data

  // Segundo cupo por teléfono: la DB bloquea a los 8 intentos fallidos, pero eso
  // es por socio; este freno corta el barrido de contraseñas desde muchas IPs.
  if (!withinLimit(`club-login:phone:${phone}`, 8, 5 * 60_000)) {
    return {
      ok: false,
      reason: 'locked',
      message: 'Demasiados intentos. Probá de nuevo en unos minutos.',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('club_login', {
    p_link_slug: link_slug,
    p_phone: phone,
    p_password: password,
  })

  if (error) {
    console.error('[club-auth] club_login failed', error.message)
    return { ok: false, reason: 'error', message: 'No pudimos entrar. Probá de nuevo.' }
  }

  const result = asRecord(data)
  if (!result) {
    return { ok: false, reason: 'error', message: 'No pudimos entrar. Probá de nuevo.' }
  }

  if (result.ok !== true) {
    const reason = readString(result, 'reason')
    if (reason === 'locked') {
      return {
        ok: false,
        reason: 'locked',
        message: 'Por seguridad bloqueamos el ingreso 15 minutos. Probá más tarde.',
      }
    }
    if (reason === 'no_password') {
      // Socio viejo (se sumó antes de que existieran las contraseñas). Lo
      // llevamos a pedir el código, pero NO se lo mandamos solos: mandar un
      // WhatsApp como efecto de un intento de login convierte esta pantalla en
      // un cañón de spam contra el teléfono de cualquier socio (y contra la
      // cuota del WABA). El código lo pide él con un tap, y ese pedido sí pasa
      // por el rate limit por teléfono.
      return {
        ok: false,
        reason: 'no_password',
        message: 'Todavía no tenés contraseña. Pedí un código por WhatsApp para crear una.',
      }
    }
    return { ok: false, reason: 'invalid_credentials', message: GENERIC_LOGIN_ERROR }
  }

  const tenantId = readString(result, 'tenant_id')
  const qrToken = readString(result, 'qr_token')
  if (!tenantId || !qrToken) {
    console.error('[club-auth] club_login ok sin tenant_id/qr_token')
    return { ok: false, reason: 'error', message: 'No pudimos entrar. Probá de nuevo.' }
  }

  await setWalletCookie(tenantId, qrToken)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// 2. Pedir código de recuperación
// ──────────────────────────────────────────────────────────

export async function requestClubPasswordReset(formData: FormData): Promise<ClubResetRequestState> {
  const ip = await getRequestIp()
  if (!withinLimit(`club-reset:ip:${ip}`, 6, 10 * 60_000)) {
    return { ok: false, message: 'Pediste varios códigos seguidos. Esperá unos minutos.' }
  }

  const parsed = clubResetRequestSchema.safeParse({
    link_slug: formData.get('link_slug'),
    phone: formData.get('phone'),
  })
  if (!parsed.success) {
    // Un teléfono mal escrito sí se avisa: no revela nada sobre quién es socio.
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }
  const { link_slug, phone } = parsed.data

  if (!withinLimit(`club-reset:phone:${phone}`, 3, 60 * 60_000)) {
    return { ok: false, message: 'Pediste varios códigos seguidos. Esperá unos minutos.' }
  }

  await issueAndSendOtp({ linkSlug: link_slug, phone, ip })

  // Siempre lo mismo, exista o no el socio y llegue o no el WhatsApp.
  return { ok: true, message: GENERIC_RESET_SENT }
}

// ──────────────────────────────────────────────────────────
// 3. Verificar el código → ticket de un solo uso
// ──────────────────────────────────────────────────────────

export async function verifyClubResetCode(formData: FormData): Promise<ClubVerifyCodeState> {
  const ip = await getRequestIp()
  if (!withinLimit(`club-verify:ip:${ip}`, 20, 10 * 60_000)) {
    return { ok: false, message: 'Demasiados intentos. Esperá unos minutos.' }
  }

  const parsed = clubVerifyCodeSchema.safeParse({
    link_slug: formData.get('link_slug'),
    phone: formData.get('phone'),
    code: formData.get('code'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }
  const { link_slug, phone, code } = parsed.data

  if (!withinLimit(`club-verify:phone:${phone}`, 10, 10 * 60_000)) {
    return { ok: false, message: 'Demasiados intentos. Pedí un código nuevo en unos minutos.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('club_verify_reset_code', {
    p_link_slug: link_slug,
    p_phone: phone,
    p_code: code,
  })

  if (error) {
    console.error('[club-auth] club_verify_reset_code failed', error.message)
    return { ok: false, message: 'No pudimos verificar el código. Probá de nuevo.' }
  }

  const result = asRecord(data)
  if (!result) return { ok: false, message: 'No pudimos verificar el código. Probá de nuevo.' }

  if (result.ok !== true) {
    const reason = readString(result, 'reason')
    if (reason === 'expired') {
      return { ok: false, message: 'El código venció. Pedí uno nuevo.' }
    }
    if (reason === 'too_many_attempts') {
      return { ok: false, message: 'Demasiados intentos con ese código. Pedí uno nuevo.' }
    }
    return { ok: false, message: 'Ese código no coincide. Revisalo y probá otra vez.' }
  }

  // El ticket vuelve al browser a propósito: es opaco, de un solo uso y dura 10
  // minutos. Sin él habría que re-verificar el código para setear la contraseña.
  const ticket = readString(result, 'reset_ticket')
  if (!ticket) {
    console.error('[club-auth] club_verify_reset_code ok sin reset_ticket')
    return { ok: false, message: 'No pudimos verificar el código. Probá de nuevo.' }
  }
  return { ok: true, reset_ticket: ticket }
}

// ──────────────────────────────────────────────────────────
// 4. Setear la contraseña con el ticket (y quedar logueado)
// ──────────────────────────────────────────────────────────

export async function setClubPasswordWithTicket(formData: FormData): Promise<ClubSetPasswordState> {
  const ip = await getRequestIp()
  if (!withinLimit(`club-setpw:ip:${ip}`, 10, 10 * 60_000)) {
    return { ok: false, message: 'Demasiados intentos. Esperá unos minutos.' }
  }

  const parsed = clubSetPasswordSchema.safeParse({
    reset_ticket: formData.get('reset_ticket'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('club_set_password_with_ticket', {
    p_reset_ticket: parsed.data.reset_ticket,
    p_password: parsed.data.password,
  })

  if (error) {
    if (error.message.includes('weak_password')) {
      return { ok: false, message: 'La contraseña necesita al menos 6 caracteres.' }
    }
    console.error('[club-auth] club_set_password_with_ticket failed', error.message)
    return { ok: false, message: 'No pudimos guardar la contraseña. Probá de nuevo.' }
  }

  const result = asRecord(data)
  if (!result || result.ok !== true) {
    return { ok: false, message: 'El pedido venció. Pedí un código nuevo.' }
  }

  const tenantId = readString(result, 'tenant_id')
  const qrToken = readString(result, 'qr_token')
  if (!tenantId || !qrToken) {
    console.error('[club-auth] club_set_password_with_ticket ok sin tenant_id/qr_token')
    return { ok: false, message: 'No pudimos guardar la contraseña. Probá de nuevo.' }
  }

  await setWalletCookie(tenantId, qrToken)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// 5. Cerrar sesión
// ──────────────────────────────────────────────────────────

/**
 * Borra SÓLO la cookie del bar en el que está el socio: la identidad es
 * tenant-scoped y salir del club de un bar no puede desloguearlo de otro.
 */
export async function clubLogout(formData: FormData): Promise<void> {
  const parsed = clubLogoutSchema.safeParse({ tenant_slug: formData.get('tenant_slug') })
  if (!parsed.success) redirect('/')

  const service = createServiceClient()
  const { data: tenant } = await service
    .from('tenants')
    .select('id')
    .eq('slug', parsed.data.tenant_slug)
    .maybeSingle()

  if (tenant) {
    const store = await cookies()
    store.delete(walletCookieName(tenant.id))
  }

  redirect(`/carta/${parsed.data.tenant_slug}`)
}
