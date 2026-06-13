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
import { decideReviewRedirect } from './gating'
import { reviewSettingsSchema, submitReviewSchema } from './schemas'

export type SubmitReviewResult =
  | { ok: true; redirectTo: string | null; awardedPoints: number }
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
    .select('id, tenant_id')
    .eq('qr_token', parsed.data.token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return { ok: false, message: 'No reconocimos el enlace.' }

  const { data: tenant } = await service
    .from('tenants')
    .select('google_maps_review_url, review_gating_enabled, review_reward_points')
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

  return { ok: true, redirectTo: decision.redirectTo, awardedPoints }
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
      reward_points: parsed.data.review_reward_points,
    },
  })

  revalidatePath(`/${slug}/reviews`)
  revalidatePath(`/${slug}/configuracion/resenas`)
  return { ok: true, message: 'Configuración guardada.' }
}
