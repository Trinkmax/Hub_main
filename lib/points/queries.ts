import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Partner, PartnerBenefit, TierBenefit } from './benefits'
import type { LoyaltyTier } from './tiers'
import type { PointsRule } from './types'

export type { Partner, PartnerBenefit, TierBenefit } from './benefits'
export type { LoyaltyTier } from './tiers'

export type Reward = {
  id: string
  name: string
  description: string | null
  cost_points: number
  stock: number | null
  active: boolean
  image_url: string | null
  min_tier_id: string | null
  category: string | null
  visible_in_catalog: boolean
  sort: number
}

const REWARD_COLUMNS =
  'id, name, description, cost_points, stock, active, image_url, min_tier_id, category, visible_in_catalog, sort'

const TIER_COLUMNS = 'id, name, color, badge_icon, min_category_points, sort, perks, active'

const TIER_BENEFIT_COLUMNS =
  'id, tier_id, kind, label, description, icon, image_url, reward_id, cadence, quantity, discount_pct, discount_scope, partner_id, sort, active'

const PARTNER_COLUMNS = 'id, name, logo_url, discount_label, category, url, active, sort'

export async function listRules(opts: { tenantId: string }): Promise<PointsRule[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('points_rules')
    .select('id, type, config, priority, active')
    .eq('tenant_id', opts.tenantId)
    .order('priority', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as PointsRule[]
}

// El orden del catálogo lo decide el dueño arrastrando (`sort`), no el costo.
// `cost_points` queda como desempate estable para las que comparten sort.
export async function listRewards(opts: { tenantId: string }): Promise<Reward[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rewards')
    .select(REWARD_COLUMNS)
    .eq('tenant_id', opts.tenantId)
    .order('sort', { ascending: true })
    .order('cost_points', { ascending: true })
  if (error) throw error
  return (data ?? []) as Reward[]
}

export async function listActiveRewards(opts: { tenantId: string }): Promise<Reward[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('rewards')
    .select(REWARD_COLUMNS)
    .eq('tenant_id', opts.tenantId)
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('cost_points', { ascending: true })
  return (data ?? []) as Reward[]
}

export async function listTiers(opts: { tenantId: string }): Promise<LoyaltyTier[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('loyalty_tiers')
    .select(TIER_COLUMNS)
    .eq('tenant_id', opts.tenantId)
    .order('min_category_points', { ascending: true })
  if (error) throw error
  return (data ?? []) as LoyaltyTier[]
}

export async function listTierBenefits(opts: { tenantId: string }): Promise<TierBenefit[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tier_benefits')
    .select(TIER_BENEFIT_COLUMNS)
    .eq('tenant_id', opts.tenantId)
    .order('sort', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as TierBenefit[]
}

export async function listPartners(opts: { tenantId: string }): Promise<Partner[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', opts.tenantId)
    .order('sort', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Partner[]
}

/**
 * Beneficios de todas las marcas aliadas con los niveles a los que aplica cada
 * uno (N:N vía partner_benefit_tiers). Una sola query embebida: el editor
 * necesita el mapa completo para avisar qué nivel se queda sin nada.
 */
export async function listPartnerBenefits(opts: { tenantId: string }): Promise<PartnerBenefit[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('partner_benefits')
    .select(
      'id, partner_id, label, description, discount_pct, image_url, sort, active, partner_benefit_tiers(tier_id)',
    )
    .eq('tenant_id', opts.tenantId)
    .order('sort', { ascending: true })
  if (error) throw error

  type Row = Omit<PartnerBenefit, 'tier_ids'> & {
    partner_benefit_tiers: { tier_id: string }[] | null
  }
  return (data ?? []).map((row) => {
    const r = row as unknown as Row
    const { partner_benefit_tiers, ...rest } = r
    return { ...rest, tier_ids: (partner_benefit_tiers ?? []).map((t) => t.tier_id) }
  })
}

export type LedgerEntry = {
  id: string
  delta: number
  reason: string
  payload: Record<string, unknown>
  created_at: string
  visit_id: string | null
  redemption_id: string | null
}

export async function listCustomerLedger(opts: {
  tenantId: string
  customerId: string
  limit?: number
}): Promise<LedgerEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('points_transactions')
    .select('id, delta, reason, payload, created_at, visit_id, redemption_id')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw error
  return (data ?? []) as unknown as LedgerEntry[]
}

/**
 * Una acreditación por consumo ("qr_award") de un socio, tal como la muestra la
 * pantalla operativa: "ya sumó 120 pts a las 22:41".
 */
export type RecentQrAward = {
  customer_id: string
  points: number
  amount_cents: number
  created_at: string
}

/**
 * Las acreditaciones por consumo de HOY para un puñado de socios (los que
 * tienen reserva en el día). Sirve para que la pantalla operativa no ofrezca
 * "sumar puntos" como si nada a una mesa que ya pagó y sumó: la RPC no tiene
 * clave de idempotencia y el guard anti-duplicado de la action es de 3 min.
 *
 * Solo `reason = 'qr_award'`: los puntos automáticos por asistencia a un evento
 * (`event_attendance`) son otra cosa y no cuentan como "ya le cargaron el
 * consumo". Se queda con la ÚLTIMA por socio.
 */
export async function listRecentQrAwards(opts: {
  tenantId: string
  customerIds: ReadonlyArray<string>
  sinceIso: string
  /** Tope superior (exclusivo): mirando un día pasado, no traer noches posteriores. */
  untilIso?: string
}): Promise<RecentQrAward[]> {
  if (opts.customerIds.length === 0) return []
  const supabase = await createClient()
  let query = supabase
    .from('points_transactions')
    .select('customer_id, delta, payload, created_at')
    .eq('tenant_id', opts.tenantId)
    .eq('reason', 'qr_award')
    .in('customer_id', [...opts.customerIds])
    .gte('created_at', opts.sinceIso)
  if (opts.untilIso) query = query.lt('created_at', opts.untilIso)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(200)
  if (error) throw error

  const seen = new Set<string>()
  const out: RecentQrAward[] = []
  for (const row of data ?? []) {
    const r = row as {
      customer_id: string
      delta: number
      payload: { amount_cents?: number } | null
      created_at: string
    }
    if (seen.has(r.customer_id)) continue
    seen.add(r.customer_id)
    out.push({
      customer_id: r.customer_id,
      points: r.delta,
      amount_cents: Number(r.payload?.amount_cents ?? 0),
      created_at: r.created_at,
    })
  }
  return out
}

export type VisitListEntry = {
  id: string
  visited_at: string
  total_amount_cents: number
  notes: string | null
  source: string
}

export async function listCustomerVisits(opts: {
  tenantId: string
  customerId: string
  limit?: number
}): Promise<VisitListEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('visits')
    .select('id, visited_at, total_amount_cents, notes, source')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('visited_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (error) throw error
  return (data ?? []) as VisitListEntry[]
}

export type RedemptionListEntry = {
  id: string
  reward_id: string
  reward_name: string
  points_spent: number
  redeemed_at: string
  status: string
}

export async function listCustomerRedemptions(opts: {
  tenantId: string
  customerId: string
}): Promise<RedemptionListEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select('id, reward_id, points_spent, redeemed_at, status, reward:rewards(name)')
    .eq('tenant_id', opts.tenantId)
    .eq('customer_id', opts.customerId)
    .order('redeemed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      reward_id: string
      points_spent: number
      redeemed_at: string
      status: string
      reward: { name: string } | { name: string }[] | null
    }
    const reward = Array.isArray(r.reward) ? r.reward[0] : r.reward
    return {
      id: r.id,
      reward_id: r.reward_id,
      reward_name: reward?.name ?? 'Recompensa',
      points_spent: r.points_spent,
      redeemed_at: r.redeemed_at,
      status: r.status,
    }
  })
}

export type PointsRedemptionConfigRow = {
  enabled: boolean
  ratePointsToCents: number
  maxPct: number
}

export async function getPointsRedemptionConfig(
  tenantId: string,
): Promise<PointsRedemptionConfigRow> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('points_redemption_enabled, points_to_cents_rate, points_redemption_max_pct')
    .eq('id', tenantId)
    .maybeSingle()

  type Row = {
    points_redemption_enabled?: boolean | null
    points_to_cents_rate?: number | null
    points_redemption_max_pct?: number | string | null
  }
  const row = (data as Row | null) ?? null
  if (!row) return { enabled: false, ratePointsToCents: 100, maxPct: 50 }
  return {
    enabled: Boolean(row.points_redemption_enabled),
    ratePointsToCents: Number(row.points_to_cents_rate ?? 100),
    maxPct: Number(row.points_redemption_max_pct ?? 50),
  }
}
