'use server'

import QRCode from 'qrcode'
import { getAppUrl } from '@/lib/app-url'
import { getRequestIp } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { redemptionRefSchema, requestRedemptionSchema } from './schemas'

// Canje AUTO-SERVICIO desde la billetera del socio. Acciones públicas (no hay
// sesión de Supabase del lado del socio): la capability es el `qr_token`, y las
// RPC `SECURITY DEFINER` resuelven el customer a partir de él. Mismo patrón y
// mismo rate limit por IP que lib/m-session/actions.ts.
//
// Los puntos se descuentan cuando el mozo VALIDA, no al generar el QR: así nadie
// pierde puntos por un código que no llegó a usar y no hace falta ningún cron de
// devolución. El precio de esa decisión es que hay UN SOLO canje activo por vez
// (lo enforcea la RPC con `redemption_already_pending`).

export type RedemptionTicket = {
  redemptionId: string
  redeemToken: string
  expiresAt: string
  rewardName: string
  costPoints: number
  /** QR renderizado en el server; apunta a `${appUrl}/v/<token>`. */
  qrDataUrl: string
}

export type RedemptionActionResult =
  | { ok: true; ticket: RedemptionTicket }
  | { ok: false; message: string }

const RPC_ERRORS: Record<string, string> = {
  insufficient_points: 'Todavía no te alcanzan los puntos para este beneficio.',
  tier_locked: 'Este beneficio es de otro nivel. Seguí sumando para desbloquearlo.',
  reward_out_of_stock: 'Se agotó por ahora. Probá con otro beneficio.',
  redemption_already_pending: 'Ya tenés un canje esperando. Usalo o cancelalo antes de pedir otro.',
  customer_not_found: 'No pudimos identificarte. Volvé a abrir tu billetera.',
  reward_not_found: 'Este beneficio ya no está disponible.',
  redemption_not_found: 'No encontramos ese beneficio.',
}

function messageFor(raw: string, fallback: string): string {
  for (const [code, message] of Object.entries(RPC_ERRORS)) {
    if (raw.includes(code)) return message
  }
  return fallback
}

async function limitByIp(bucket: string): Promise<string | null> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `${bucket}:${ip}`, limit: 20, windowMs: 60_000 })
    return null
  } catch (e) {
    if (e instanceof RateLimitedError) return 'Esperá un minuto antes de reintentar.'
    throw e
  }
}

type RpcTicket = {
  redemption_id: string
  redeem_token: string
  expires_at: string
  reward_name: string | null
  cost_points: number
}

async function toTicket(data: unknown): Promise<RedemptionTicket> {
  const raw = data as RpcTicket
  const appUrl = await getAppUrl()
  return {
    redemptionId: raw.redemption_id,
    redeemToken: raw.redeem_token,
    expiresAt: raw.expires_at,
    rewardName: raw.reward_name ?? 'Beneficio',
    costPoints: raw.cost_points ?? 0,
    qrDataUrl: await QRCode.toDataURL(`${appUrl}/v/${raw.redeem_token}`, {
      width: 420,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }),
  }
}

/** El socio pide un canje del catálogo → genera el QR que valida el mozo. */
export async function requestRedemption(input: {
  qrToken: string
  rewardId: string
}): Promise<RedemptionActionResult> {
  const limited = await limitByIp('wallet-redeem')
  if (limited) return { ok: false, message: limited }

  const parsed = requestRedemptionSchema.safeParse({
    qr_token: input.qrToken,
    reward_id: input.rewardId,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_reward_redemption', {
    p_qr_token: parsed.data.qr_token,
    p_reward_id: parsed.data.reward_id,
  })
  if (error) {
    const message = messageFor(error.message, 'No pudimos generar tu canje.')
    if (message === 'No pudimos generar tu canje.') {
      console.error('[wallet.requestRedemption]', error.message)
    }
    return { ok: false, message }
  }
  return { ok: true, ticket: await toTicket(data) }
}

/**
 * Beneficios que YA nacen pendientes (regalo de bienvenida, beneficio de nivel
 * del cron, premio de punch card completa) y hasta ahora no tenían ningún camino
 * de entrega: quedaban pendientes para siempre. Esto les da su QR.
 */
export async function claimPendingRedemption(input: {
  qrToken: string
  redemptionId: string
}): Promise<RedemptionActionResult> {
  const limited = await limitByIp('wallet-claim')
  if (limited) return { ok: false, message: limited }

  const parsed = redemptionRefSchema.safeParse({
    qr_token: input.qrToken,
    redemption_id: input.redemptionId,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('claim_pending_redemption', {
    p_qr_token: parsed.data.qr_token,
    p_redemption_id: parsed.data.redemption_id,
  })
  if (error) {
    const message = messageFor(error.message, 'No pudimos generar el código.')
    if (message === 'No pudimos generar el código.') {
      console.error('[wallet.claimPendingRedemption]', error.message)
    }
    return { ok: false, message }
  }
  return { ok: true, ticket: await toTicket(data) }
}

/** El socio se arrepiente: libera el canje activo para poder pedir otro. */
export async function cancelRedemption(input: {
  qrToken: string
  redemptionId: string
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const limited = await limitByIp('wallet-cancel')
  if (limited) return { ok: false, message: limited }

  const parsed = redemptionRefSchema.safeParse({
    qr_token: input.qrToken,
    redemption_id: input.redemptionId,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_reward_redemption', {
    p_qr_token: parsed.data.qr_token,
    p_redemption_id: parsed.data.redemption_id,
  })
  if (error) {
    const message = messageFor(error.message, 'No pudimos cancelar el canje.')
    if (message === 'No pudimos cancelar el canje.') {
      console.error('[wallet.cancelRedemption]', error.message)
    }
    return { ok: false, message }
  }
  return { ok: true }
}
