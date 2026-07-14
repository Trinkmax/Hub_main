import 'server-only'
import type { TierBenefitCadence, TierBenefitKind } from '@/lib/points/benefits'
import { hasItemBonus, resolveEarnRate } from '@/lib/points/earn-rate'
import type { LoyaltyTier } from '@/lib/points/tiers'
import type { PointsRule } from '@/lib/points/types'
import { createServiceClient } from '@/lib/supabase/service'
import type { WalletBenefit, WalletData, WalletEarn } from './queries'

// Config de fidelización del tenant SIN cliente: alimenta el simulador de wallet
// del admin. El simulador arma un WalletData sintético con puntos ajustables y
// re-renderiza el MISMO componente de wallet, sin tocar la DB (todo client-side).

export type SimReward = {
  id: string
  name: string
  description: string | null
  costPoints: number
  imageUrl: string | null
  stock: number | null
  category: string | null
  minTierId: string | null
}

export type SimConfig = {
  tenant: { id: string; name: string; logoUrl: string | null; brandAccent: string | null }
  windowMonths: number
  earn: WalletEarn
  tiers: LoyaltyTier[]
  benefitsByTier: Record<string, WalletBenefit[]>
  rewards: SimReward[]
  partners: WalletData['partners']
}

type PartnerJoin = {
  name: string
  logo_url: string | null
  discount_label: string | null
  category: string | null
  url: string | null
}
type RewardJoin = { image_url: string | null }

export async function getSimulatorConfig(tenantSlug: string): Promise<SimConfig | null> {
  const service = createServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, logo_url, brand_accent, category_window_months')
    .eq('slug', tenantSlug)
    .maybeSingle()
  if (!tenant) return null
  const tenantId = tenant.id

  const [
    { data: tiersData },
    { data: benefitsData },
    { data: rewardsData },
    { data: partnersData },
    { data: rulesData },
  ] = await Promise.all([
    service
      .from('loyalty_tiers')
      .select('id, name, color, badge_icon, min_category_points, sort, perks, active')
      .eq('tenant_id', tenantId),
    service
      .from('tier_benefits')
      .select(
        'id, tier_id, kind, label, description, icon, quantity, cadence, discount_pct, discount_scope, sort, reward:rewards(image_url), partner:partners(name, logo_url, discount_label, category, url)',
      )
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort', { ascending: true }),
    service
      .from('rewards')
      .select('id, name, description, cost_points, stock, image_url, min_tier_id, category')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('visible_in_catalog', true)
      .order('cost_points', { ascending: true }),
    service
      .from('partners')
      .select('id, name, logo_url, discount_label, category, url, active, sort')
      .eq('tenant_id', tenantId)
      .order('active', { ascending: false })
      .order('sort', { ascending: true }),
    service
      .from('points_rules')
      .select('id, type, config, priority, active')
      .eq('tenant_id', tenantId)
      .eq('active', true),
  ])

  const benefitsByTier: Record<string, WalletBenefit[]> = {}
  for (const b of (benefitsData ?? []) as Array<{
    id: string
    tier_id: string
    kind: string
    label: string
    description: string | null
    icon: string | null
    quantity: number
    cadence: string
    discount_pct: number | null
    discount_scope: string | null
    reward: RewardJoin | RewardJoin[] | null
    partner: PartnerJoin | PartnerJoin[] | null
  }>) {
    const p = Array.isArray(b.partner) ? b.partner[0] : b.partner
    const rw = Array.isArray(b.reward) ? b.reward[0] : b.reward
    const mapped: WalletBenefit = {
      id: b.id,
      kind: b.kind as TierBenefitKind,
      label: b.label,
      description: b.description,
      icon: b.icon,
      imageUrl: rw?.image_url ?? null,
      quantity: b.quantity,
      cadence: b.cadence as TierBenefitCadence,
      discountPct: b.discount_pct,
      discountScope: b.discount_scope,
      partner: p
        ? {
            name: p.name,
            logoUrl: p.logo_url,
            discountLabel: p.discount_label,
            category: p.category,
            url: p.url,
          }
        : null,
    }
    const arr = benefitsByTier[b.tier_id]
    if (arr) arr.push(mapped)
    else benefitsByTier[b.tier_id] = [mapped]
  }

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      logoUrl: tenant.logo_url,
      brandAccent: tenant.brand_accent,
    },
    windowMonths:
      (tenant as { category_window_months?: number | null }).category_window_months ?? 4,
    earn: ((): WalletEarn => {
      const rules = (rulesData ?? []) as unknown as PointsRule[]
      return { rate: resolveEarnRate(rules), itemBonus: hasItemBonus(rules) }
    })(),
    tiers: (tiersData ?? []) as LoyaltyTier[],
    benefitsByTier,
    rewards: (
      (rewardsData ?? []) as Array<{
        id: string
        name: string
        description: string | null
        cost_points: number
        stock: number | null
        image_url: string | null
        min_tier_id: string | null
        category: string | null
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      costPoints: r.cost_points,
      imageUrl: r.image_url,
      stock: r.stock,
      category: r.category,
      minTierId: r.min_tier_id,
    })),
    partners: (
      (partnersData ?? []) as Array<{
        id: string
        name: string
        logo_url: string | null
        discount_label: string | null
        category: string | null
        url: string | null
        active: boolean
      }>
    ).map((p) => ({
      id: p.id,
      name: p.name,
      logoUrl: p.logo_url,
      discountLabel: p.discount_label,
      category: p.category,
      url: p.url,
      active: p.active,
    })),
  }
}
