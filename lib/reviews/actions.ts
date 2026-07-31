'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { getRequestIp } from '@/lib/ip'
import { RateLimitedError, rateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { buildFeedbackWhatsappUrl } from './feedback'
import { decideReviewRedirect } from './gating'
import { attachReviewCommentSchema, reviewSettingsSchema, submitReviewSchema } from './schemas'

export type SubmitReviewResult =
  | {
      ok: true
      reviewId: string
      /** URL de Google Maps si corresponde derivar (5★ con gating ON). */
      redirectTo: string | null
      /** wa.me con el feedback ya redactado, para los que NO van a Google. */
      feedbackWhatsappUrl: string | null
      awardedPoints: number
    }
  | { ok: false; message: string }

/**
 * Flujo PÚBLICO (sin auth) consumido por /r/[token]. Rate-limit por IP, resuelve
 * el customer por qr_token (capability) con service-role, inserta la reseña,
 * otorga puntos one-shot si está configurado, y decide la redirección a Maps.
 */
export async function submitReview(input: {
  token: string
  rating: number
  comment?: string | null
}): Promise<SubmitReviewResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `review:${ip}`, limit: 5, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = submitReviewSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const service = createServiceClient()
  const { data: customer } = await service
    .from('customers')
    .select('id, tenant_id, first_name, last_name')
    .eq('qr_token', parsed.data.token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { ok: false, message: 'No reconocimos el enlace.' }

  const { data: tenant } = await service
    .from('tenants')
    .select(
      'name, google_maps_review_url, feedback_whatsapp_phone, review_gating_enabled, review_reward_points',
    )
    .eq('id', customer.tenant_id)
    .maybeSingle()
  if (!tenant) return { ok: false, message: 'No encontramos el bar.' }

  const decision = decideReviewRedirect({
    rating: parsed.data.rating,
    gatingEnabled: tenant.review_gating_enabled,
    mapsUrl: tenant.google_maps_review_url,
  })

  const { data: review, error: insertErr } = await service
    .from('reviews')
    .insert({
      tenant_id: customer.tenant_id,
      customer_id: customer.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
      source: 'wallet',
      redirected_to_maps: decision.redirectedToMaps,
    })
    .select('id')
    .single()
  if (insertErr || !review) {
    console.error('[reviews.submit]', insertErr?.code, insertErr?.message)
    return { ok: false, message: 'No pudimos guardar tu reseña.' }
  }

  // Puntos por reseña (one-shot por customer para evitar farming).
  let awardedPoints = 0
  const rewardPoints = tenant.review_reward_points ?? 0
  if (rewardPoints > 0) {
    const { count } = await service
      .from('points_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id)
      .eq('reason', 'review')
    if ((count ?? 0) === 0) {
      const { error: ptErr } = await service.from('points_transactions').insert({
        tenant_id: customer.tenant_id,
        customer_id: customer.id,
        delta: rewardPoints,
        reason: 'review',
        payload: { review_id: review.id },
      })
      if (!ptErr) awardedPoints = rewardPoints
    }
  }

  // El brazo de WhatsApp es el de "no me fue bien": sólo para puntajes < 5 y
  // sólo si la reseña no se derivó a Google (si va a Maps, pedirle además que
  // escriba por WhatsApp sería pedirle dos cosas). Un 5★ sin enlace de Maps
  // cargado termina en el agradecimiento normal, no en WhatsApp.
  const feedbackWhatsappUrl =
    decision.redirectTo || parsed.data.rating >= 5
      ? null
      : buildFeedbackWhatsappUrl({
          phone: tenant.feedback_whatsapp_phone,
          tenantName: tenant.name,
          customerName: `${customer.first_name} ${customer.last_name}`.trim(),
          rating: parsed.data.rating,
          comment: parsed.data.comment,
        })

  return {
    ok: true,
    reviewId: review.id,
    redirectTo: decision.redirectTo,
    feedbackWhatsappUrl,
    awardedPoints,
  }
}

export type AttachReviewCommentResult = { ok: true } | { ok: false; message: string }

/**
 * Guarda el comentario que el cliente escribe en la pantalla puente de 5★
 * (la reseña ya se insertó al tocar la quinta estrella). Google no permite
 * pre-cargar el texto de una reseña por URL, así que igual se lo copiamos al
 * portapapeles — pero el bar se queda con el comentario aunque nunca lo pegue.
 */
export async function attachReviewComment(input: {
  token: string
  reviewId: string
  comment: string
}): Promise<AttachReviewCommentResult> {
  const ip = await getRequestIp()
  try {
    rateLimit({ key: `review-comment:${ip}`, limit: 10, windowMs: 60_000 })
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, message: 'Esperá un minuto antes de reintentar.' }
    }
    throw e
  }

  const parsed = attachReviewCommentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const service = createServiceClient()
  const { data: customer } = await service
    .from('customers')
    .select('id')
    .eq('qr_token', parsed.data.token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { ok: false, message: 'No reconocimos el enlace.' }

  // El token es la capability: sólo puede escribir sobre SU propia reseña.
  const { error } = await service
    .from('reviews')
    .update({ comment: parsed.data.comment })
    .eq('id', parsed.data.reviewId)
    .eq('customer_id', customer.id)
  if (error) {
    console.error('[reviews.attachComment]', error.code, error.message)
    return { ok: false, message: 'No pudimos guardar tu comentario.' }
  }
  return { ok: true }
}

// ──────────────────────────────────────────────────────────
// Config de reseñas (owner)
// ──────────────────────────────────────────────────────────

export type ReviewSettingsActionState =
  | { ok: true; message?: string }
  | { ok: false; message: string }

export async function updateReviewSettingsAction(
  slug: string,
  input: unknown,
): Promise<ReviewSettingsActionState> {
  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    tenantId = tenant.id
  } catch (e) {
    if (
      e instanceof RoleRequiredError ||
      e instanceof TenantNotFoundError ||
      e instanceof UnauthenticatedError
    ) {
      return { ok: false, message: 'No tenés permiso.' }
    }
    throw e
  }

  const parsed = reviewSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('tenants')
    .update({
      google_maps_review_url: parsed.data.google_maps_review_url,
      feedback_whatsapp_phone: parsed.data.feedback_whatsapp_phone,
      review_gating_enabled: parsed.data.review_gating_enabled,
      review_reward_points: parsed.data.review_reward_points,
    })
    .eq('id', tenantId)
  if (error) {
    console.error('[reviews.updateSettings]', error.message)
    return { ok: false, message: 'No se pudo guardar.' }
  }

  await logAudit({
    tenantId,
    userId: null,
    action: 'reviews.settings_updated',
    entity: 'tenant',
    entityId: tenantId,
    payload: {
      gating: parsed.data.review_gating_enabled,
      has_maps_url: parsed.data.google_maps_review_url !== null,
      // El teléfono es PII: registramos si está cargado, nunca el número.
      has_feedback_phone: parsed.data.feedback_whatsapp_phone !== null,
      reward_points: parsed.data.review_reward_points,
    },
  })

  revalidatePath(`/${slug}/reviews`)
  revalidatePath(`/${slug}/configuracion/resenas`)
  return { ok: true, message: 'Configuración guardada.' }
}
