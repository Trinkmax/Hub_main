import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { summarizeRatings } from './summary'

export type ReviewContext = {
  firstName: string
  tenantName: string
  brandAccent: string | null
  logoUrl: string | null
}

/** Contexto público de /r/[token] (service-role, capability por qr_token). */
export async function getReviewContextByToken(token: string): Promise<ReviewContext | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  const service = createServiceClient()
  // Un solo hop: el tenant viene embebido por FK en vez de un segundo round-trip
  // que dependía del `tenant_id` del cliente (2 → 1 hops secuenciales).
  const { data: customer } = await service
    .from('customers')
    .select('first_name, tenant:tenants!customers_tenant_id_fkey(name, brand_accent, logo_url)')
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null
  const tenantRaw = (customer as { tenant?: unknown }).tenant
  const tenant = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as {
    name: string
    brand_accent: string | null
    logo_url: string | null
  } | null
  if (!tenant) return null
  return {
    firstName: customer.first_name,
    tenantName: tenant.name,
    brandAccent: tenant.brand_accent,
    logoUrl: tenant.logo_url,
  }
}

export type ReviewSettings = {
  googleMapsReviewUrl: string | null
  feedbackWhatsappPhone: string | null
  reviewGatingEnabled: boolean
  reviewRewardPoints: number
}

export async function getReviewSettings(tenantId: string): Promise<ReviewSettings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select(
      'google_maps_review_url, feedback_whatsapp_phone, review_gating_enabled, review_reward_points',
    )
    .eq('id', tenantId)
    .maybeSingle()
  return {
    googleMapsReviewUrl: data?.google_maps_review_url ?? null,
    feedbackWhatsappPhone: data?.feedback_whatsapp_phone ?? null,
    reviewGatingEnabled: data?.review_gating_enabled ?? true,
    reviewRewardPoints: data?.review_reward_points ?? 0,
  }
}

export type ReviewListItem = {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  redirectedToMaps: boolean
  customerId: string | null
  customerName: string | null
}

export async function listReviews(opts: {
  tenantId: string
  /** Filtro por estrellas del panel (searchParam `?rating=`). undefined = todas. */
  rating?: 1 | 2 | 3 | 4 | 5
  limit?: number
}): Promise<ReviewListItem[]> {
  const supabase = await createClient()
  let query = supabase
    .from('reviews')
    .select(
      'id, rating, comment, created_at, redirected_to_maps, customer_id, customer:customers(first_name, last_name)',
    )
    .eq('tenant_id', opts.tenantId)
  if (opts.rating !== undefined) query = query.eq('rating', opts.rating)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
  if (error) {
    console.error('[reviews.list]', error.message)
    return []
  }
  type Row = {
    id: string
    rating: number
    comment: string | null
    created_at: string
    redirected_to_maps: boolean
    customer_id: string | null
    customer:
      | { first_name: string; last_name: string }
      | { first_name: string; last_name: string }[]
      | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer
    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      redirectedToMaps: r.redirected_to_maps,
      customerId: r.customer_id,
      customerName: c ? `${c.first_name} ${c.last_name}`.trim() : null,
    }
  })
}

export type CustomerReview = {
  id: string
  rating: number
  comment: string | null
  source: string
  createdAt: string
  visitId: string | null
  redirectedToMaps: boolean
}

export type CustomerReviewsSnapshot = {
  reviews: CustomerReview[]
  total: number
  average: number
}

/**
 * Reseñas de un cliente para su ficha del CRM. Una sola ida a la DB: el total y
 * el promedio se calculan sobre el mismo recorte (50 reseñas de un mismo cliente
 * es techo de sobra; si alguna vez se pasara, se ven las últimas).
 * Filtra por `tenant_id` además del cliente: defensa en profundidad sobre la RLS.
 */
export async function listCustomerReviews(
  tenantId: string,
  customerId: string,
  limit = 50,
): Promise<CustomerReviewsSnapshot> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, source, created_at, visit_id, redirected_to_maps')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  // La ficha del cliente no puede caerse porque falle este bloque: degradamos a vacío.
  if (error) {
    console.error('[reviews.listCustomer]', error.message)
    return { reviews: [], total: 0, average: 0 }
  }
  const reviews: CustomerReview[] = (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    source: r.source,
    createdAt: r.created_at,
    visitId: r.visit_id,
    redirectedToMaps: r.redirected_to_maps,
  }))
  return { reviews, ...summarizeRatings(reviews.map((r) => r.rating)) }
}

export type ReviewInsights = {
  total: number
  average: number
  fiveStarPct: number
  distribution: Record<1 | 2 | 3 | 4 | 5, number>
}

export async function getReviewInsights(tenantId: string): Promise<ReviewInsights> {
  const supabase = await createClient()
  const { data } = await supabase.from('reviews').select('rating').eq('tenant_id', tenantId)
  const rows = (data ?? []) as Array<{ rating: number }>
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sum = 0
  for (const r of rows) {
    const k = Math.min(5, Math.max(1, r.rating)) as 1 | 2 | 3 | 4 | 5
    distribution[k] += 1
    sum += r.rating
  }
  const total = rows.length
  return {
    total,
    average: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
    fiveStarPct: total > 0 ? Math.round((distribution[5] / total) * 100) : 0,
    distribution,
  }
}
