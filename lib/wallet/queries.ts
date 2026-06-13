import 'server-only'
import { type LoyaltyTier, progressToNext, resolveTier } from '@/lib/points/tiers'
import { createServiceClient } from '@/lib/supabase/service'
import { computeRewardState } from './reward-state'

export { computeRewardState } from './reward-state'

// ──────────────────────────────────────────────────────────
// Wallet del cliente — lectura pública por qr_token (capability).
// REGLA ANTI-LEAK: el único input externo es `token`; resuelve UN customer y
// TODA lectura downstream filtra por customer_id + tenant_id de ESE customer.
// Nunca se acepta un customer/tenant id del request. Service-role (no hay sesión
// del cliente), igual que /c y /m hoy.
// ──────────────────────────────────────────────────────────

export type WalletReward = {
  id: string
  name: string
  description: string | null
  costPoints: number
  imageUrl: string | null
  stock: number | null
  affordable: boolean
  tierLocked: boolean
  minTierName: string | null
}

export type WalletPunchCard = {
  id: string
  templateName: string
  imageUrl: string | null
  currentStamps: number
  threshold: number
  rewardName: string | null
}

export type WalletData = {
  customer: {
    id: string
    firstName: string
    lastName: string
    qrToken: string
    pointsBalance: number
    lifetimePoints: number
  }
  tenant: {
    id: string
    slug: string
    name: string
    logoUrl: string | null
    brandAccent: string | null
  }
  tier: {
    current: { id: string; name: string; color: string | null; perks: string | null } | null
    next: { id: string; name: string; thresholdPoints: number } | null
    pointsToNext: number | null
    progressPct: number
  }
  rewards: WalletReward[]
  punchCards: WalletPunchCard[]
  visits: Array<{ id: string; visitedAt: string; totalAmountCents: number }>
  redemptions: Array<{
    id: string
    rewardName: string
    pointsSpent: number
    redeemedAt: string
    status: string
  }>
  ledger: Array<{ id: string; delta: number; reason: string; createdAt: string }>
  events: Array<{ id: string; name: string; startsAt: string }>
  pendingBenefits: Array<{
    redemptionId: string
    rewardName: string
    imageUrl: string | null
    kind: 'welcome' | 'tier' | 'reward'
  }>
}

function benefitKind(notes: string | null): 'welcome' | 'tier' | 'reward' {
  if (!notes) return 'reward'
  if (notes.includes('bienvenida')) return 'welcome'
  if (notes.includes('nivel')) return 'tier'
  return 'reward'
}

export async function getWalletByToken(token: string): Promise<WalletData | null> {
  if (!token || token.length < 16 || token.length > 128) return null
  const service = createServiceClient()

  const { data: customer } = await service
    .from('customers')
    .select(
      'id, first_name, last_name, qr_token, points_balance, lifetime_points_earned, current_tier_id, tenant_id',
    )
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null

  const customerId = customer.id
  const tenantId = customer.tenant_id
  const lifetime = customer.lifetime_points_earned
  const balance = customer.points_balance

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const [
    { data: tenant },
    { data: tiersData },
    { data: rewardsData },
    { data: cardsData },
    { data: visitsData },
    { data: redemptionsData },
    { data: ledgerData },
    { data: eventsData },
    { data: pendingData },
  ] = await Promise.all([
    service
      .from('tenants')
      .select('id, slug, name, logo_url, brand_accent')
      .eq('id', tenantId)
      .maybeSingle(),
    service
      .from('loyalty_tiers')
      .select(
        'id, name, color, badge_icon, min_lifetime_points, sort, benefit_cadence, benefit_reward_id, perks, active',
      )
      .eq('tenant_id', tenantId),
    service
      .from('rewards')
      .select('id, name, description, cost_points, stock, image_url, min_tier_id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('cost_points', { ascending: true }),
    service
      .from('customer_punch_cards')
      .select(
        'id, current_stamps, threshold_snapshot, template:punch_card_templates!inner(name, image_url, reward:rewards(name))',
      )
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .is('completed_at', null)
      .is('expired_at', null),
    service
      .from('visits')
      .select('id, visited_at, total_amount_cents')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('visited_at', { ascending: false })
      .limit(50),
    service
      .from('reward_redemptions')
      .select('id, points_spent, redeemed_at, status, reward:rewards(name)')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('redeemed_at', { ascending: false })
      .limit(50),
    service
      .from('points_transactions')
      .select('id, delta, reason, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50),
    service
      .from('scheduled_events')
      .select(
        'id, name_override, event_date, starts_at_local, template:scheduled_event_templates(name)',
      )
      .eq('tenant_id', tenantId)
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(5),
    service
      .from('reward_redemptions')
      .select('id, notes, reward:rewards(name, image_url)')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'pending')
      .order('redeemed_at', { ascending: false }),
  ])

  if (!tenant) return null

  const tiers = (tiersData ?? []) as LoyaltyTier[]
  const current = resolveTier(lifetime, tiers)
  const progress = progressToNext(lifetime, tiers)

  const pickName = (reward: { name: string } | { name: string }[] | null): string =>
    (Array.isArray(reward) ? reward[0]?.name : reward?.name) ?? 'Recompensa'

  const rewards: WalletReward[] = (
    (rewardsData ?? []) as Array<{
      id: string
      name: string
      description: string | null
      cost_points: number
      stock: number | null
      image_url: string | null
      min_tier_id: string | null
    }>
  ).map((r) => {
    const state = computeRewardState(r, { pointsBalance: balance, lifetimePoints: lifetime, tiers })
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      costPoints: r.cost_points,
      imageUrl: r.image_url,
      stock: r.stock,
      ...state,
    }
  })

  type CardRow = {
    id: string
    current_stamps: number
    threshold_snapshot: number
    template:
      | {
          name: string
          image_url: string | null
          reward: { name: string } | { name: string }[] | null
        }
      | Array<{
          name: string
          image_url: string | null
          reward: { name: string } | { name: string }[] | null
        }>
      | null
  }
  const punchCards: WalletPunchCard[] = ((cardsData ?? []) as unknown as CardRow[]).map((c) => {
    const tpl = Array.isArray(c.template) ? c.template[0] : c.template
    return {
      id: c.id,
      templateName: tpl?.name ?? 'Tarjeta',
      imageUrl: tpl?.image_url ?? null,
      currentStamps: c.current_stamps,
      threshold: c.threshold_snapshot,
      rewardName: tpl ? pickName(tpl.reward) : null,
    }
  })

  return {
    customer: {
      id: customer.id,
      firstName: customer.first_name,
      lastName: customer.last_name,
      qrToken: customer.qr_token,
      pointsBalance: balance,
      lifetimePoints: lifetime,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenant.logo_url,
      brandAccent: tenant.brand_accent,
    },
    tier: {
      current: current
        ? { id: current.id, name: current.name, color: current.color, perks: current.perks }
        : null,
      next: progress.next
        ? {
            id: progress.next.id,
            name: progress.next.name,
            thresholdPoints: progress.next.min_lifetime_points,
          }
        : null,
      pointsToNext: progress.pointsToNext,
      progressPct: progress.pct,
    },
    rewards,
    punchCards,
    visits: (
      (visitsData ?? []) as Array<{ id: string; visited_at: string; total_amount_cents: number }>
    ).map((v) => ({
      id: v.id,
      visitedAt: v.visited_at,
      totalAmountCents: v.total_amount_cents,
    })),
    redemptions: (
      (redemptionsData ?? []) as Array<{
        id: string
        points_spent: number
        redeemed_at: string
        status: string
        reward: { name: string } | { name: string }[] | null
      }>
    ).map((r) => ({
      id: r.id,
      rewardName: pickName(r.reward),
      pointsSpent: r.points_spent,
      redeemedAt: r.redeemed_at,
      status: r.status,
    })),
    ledger: (
      (ledgerData ?? []) as Array<{ id: string; delta: number; reason: string; created_at: string }>
    ).map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, createdAt: l.created_at })),
    events: (
      (eventsData ?? []) as Array<{
        id: string
        name_override: string | null
        event_date: string
        starts_at_local: string
        template: { name: string } | { name: string }[] | null
      }>
    ).map((e) => {
      const tpl = Array.isArray(e.template) ? e.template[0] : e.template
      return {
        id: e.id,
        name: e.name_override ?? tpl?.name ?? 'Evento',
        startsAt: `${e.event_date}T${e.starts_at_local}`,
      }
    }),
    pendingBenefits: (
      (pendingData ?? []) as Array<{
        id: string
        notes: string | null
        reward:
          | { name: string; image_url: string | null }
          | { name: string; image_url: string | null }[]
          | null
      }>
    ).map((p) => {
      const reward = Array.isArray(p.reward) ? p.reward[0] : p.reward
      return {
        redemptionId: p.id,
        rewardName: reward?.name ?? 'Beneficio',
        imageUrl: reward?.image_url ?? null,
        kind: benefitKind(p.notes),
      }
    }),
  }
}
