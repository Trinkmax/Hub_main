import 'server-only'
import { subMonths } from 'date-fns'
import type { TierBenefitCadence, TierBenefitKind } from '@/lib/points/benefits'
import { computeExpiry, wouldDropTier } from '@/lib/points/category'
import { type EarnRate, hasItemBonus, resolveEarnRate } from '@/lib/points/earn-rate'
import {
  type LoyaltyTier,
  progressToNext,
  resolveTier,
  sortedActiveTiers,
} from '@/lib/points/tiers'
import type { PointsRule } from '@/lib/points/types'
import { createServiceClient } from '@/lib/supabase/service'
import { computeRewardState } from './reward-state'

export { computeRewardState } from './reward-state'

/** Cota generosa para traer el ledger positivo (la ventana real ≤ 24 meses). */
const MAX_WINDOW_MONTHS = 24

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
  category: string | null
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

export type WalletBenefit = {
  id: string
  kind: TierBenefitKind
  label: string
  description: string | null
  icon: string | null
  /** Foto del reward asociado (recurring_reward) para las tarjetas foto-forward. */
  imageUrl: string | null
  quantity: number
  cadence: TierBenefitCadence
  discountPct: number | null
  discountScope: string | null
  partner: {
    name: string
    logoUrl: string | null
    discountLabel: string | null
    category: string | null
    url: string | null
  } | null
}

export type WalletExpiry = {
  points: number
  /** ISO date del lote más próximo a vencer. */
  expiresAt: string
  /** ¿Bajaría de nivel si vence? */
  wouldDrop: boolean
  toTierName: string | null
}

/** Cómo suma puntos el socio (para "Cómo funciona"). Sale de la config real del tenant. */
export type WalletEarn = {
  /** Tasa por monto, si se puede enunciar sin mentir (ver resolveEarnRate). */
  rate: EarnRate | null
  /** Hay reglas por producto activas → "algunos productos suman extra". */
  itemBonus: boolean
}

/** Un escalón de la escalera de niveles con sus beneficios (para la vista aspiracional). */
export type WalletTierStep = {
  id: string
  name: string
  color: string | null
  badgeIcon: string | null
  minCategoryPoints: number
  /** El cliente ya alcanzó este nivel (categoryPoints >= umbral). */
  unlocked: boolean
  /** Es el nivel actual del cliente. */
  current: boolean
  /** Puntos de categoría que faltan para alcanzarlo (0 si ya está). */
  pointsToReach: number
  benefits: WalletBenefit[]
}

export type WalletData = {
  customer: {
    id: string
    firstName: string
    lastName: string
    qrToken: string
    birthdate: string | null
    pointsBalance: number
    categoryPoints: number
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
    current: {
      id: string
      name: string
      color: string | null
      badgeIcon: string | null
      perks: string | null
    } | null
    next: { id: string; name: string; thresholdPoints: number } | null
    pointsToNext: number | null
    progressPct: number
  }
  /** Ventana móvil (meses) con la que se calculan los puntos de categoría. */
  categoryWindowMonths: number
  /** Próximo vencimiento de puntos de categoría (o null si no hay nada por vencer). */
  expiry: WalletExpiry | null
  /** Cómo suma puntos (tasa por monto + bonus por producto) — para "Cómo funciona". */
  earn: WalletEarn
  /** Beneficios estructurados del nivel actual (ítems del mes / descuentos / perks / aliados). */
  benefits: WalletBenefit[]
  /** La escalera completa de niveles con beneficios por nivel (para la vista aspiracional). */
  progression: WalletTierStep[]
  /** Marcas aliadas del tenant ("Nuestros Aliados"); `active=false` = borrador/próximamente. */
  partners: Array<{
    id: string
    name: string
    logoUrl: string | null
    discountLabel: string | null
    category: string | null
    url: string | null
    active: boolean
  }>
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
      'id, first_name, last_name, qr_token, birthdate, points_balance, category_points, lifetime_points_earned, current_tier_id, tenant_id',
    )
    .eq('qr_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (!customer) return null

  const customerId = customer.id
  const tenantId = customer.tenant_id
  const lifetime = customer.lifetime_points_earned
  const categoryPoints = customer.category_points
  const balance = customer.points_balance

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const now = new Date()
  const earnCutoff = subMonths(now, MAX_WINDOW_MONTHS).toISOString()

  const [
    { data: tenant },
    { data: tiersData },
    { data: rewardsData },
    { data: benefitsData },
    { data: cardsData },
    { data: visitsData },
    { data: redemptionsData },
    { data: ledgerData },
    { data: earnData },
    { data: eventsData },
    { data: pendingData },
    { data: partnersData },
    { data: rulesData },
  ] = await Promise.all([
    service
      .from('tenants')
      .select('id, slug, name, logo_url, brand_accent, category_window_months')
      .eq('id', tenantId)
      .maybeSingle(),
    service
      .from('loyalty_tiers')
      .select('id, name, color, badge_icon, min_category_points, sort, perks, active')
      .eq('tenant_id', tenantId),
    service
      .from('rewards')
      .select('id, name, description, cost_points, stock, image_url, min_tier_id, category')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('visible_in_catalog', true)
      .order('cost_points', { ascending: true }),
    service
      .from('tier_benefits')
      .select(
        'id, tier_id, kind, label, description, icon, quantity, cadence, discount_pct, discount_scope, sort, reward:rewards(image_url), partner:partners(name, logo_url, discount_label, category, url)',
      )
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort', { ascending: true }),
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
    // Ledger positivo dentro de la cota máxima → cálculo de vencimiento.
    // Orden DESC (más nuevas primero): la ventana de vencimiento cae cerca de
    // now-windowMonths (reciente para ventanas chicas); si el límite corta, deja
    // fuera las más viejas, no la ventana relevante.
    service
      .from('points_transactions')
      .select('delta, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .gt('delta', 0)
      .gte('created_at', earnCutoff)
      .order('created_at', { ascending: false })
      .limit(1000),
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
    // Marcas aliadas (activas primero, luego el resto como "próximamente").
    service
      .from('partners')
      .select('id, name, logo_url, discount_label, category, url, active, sort')
      .eq('tenant_id', tenantId)
      .order('active', { ascending: false })
      .order('sort', { ascending: true }),
    // Reglas de acumulación → "cómo sumás" (la tasa real, no una hardcodeada).
    service
      .from('points_rules')
      .select('id, type, config, priority, active')
      .eq('tenant_id', tenantId)
      .eq('active', true),
  ])

  if (!tenant) return null

  const tiers = (tiersData ?? []) as LoyaltyTier[]
  const current = resolveTier(categoryPoints, tiers)
  const progress = progressToNext(categoryPoints, tiers)

  const windowMonths =
    (tenant as { category_window_months?: number | null }).category_window_months ?? 4
  const earnTxs = ((earnData ?? []) as Array<{ delta: number; created_at: string }>).map((t) => ({
    delta: t.delta,
    created_at: t.created_at,
  }))
  const expiryRaw = computeExpiry(earnTxs, now, windowMonths, 30)
  const drop = expiryRaw
    ? wouldDropTier(categoryPoints, expiryRaw.points, tiers)
    : { drops: false, toTierName: null }
  const expiry: WalletExpiry | null = expiryRaw
    ? {
        points: expiryRaw.points,
        expiresAt: expiryRaw.expiresAt.toISOString(),
        wouldDrop: drop.drops,
        toTierName: drop.toTierName,
      }
    : null

  const rules = (rulesData ?? []) as unknown as PointsRule[]
  const earn: WalletEarn = { rate: resolveEarnRate(rules), itemBonus: hasItemBonus(rules) }

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
      category: string | null
    }>
  ).map((r) => {
    const state = computeRewardState(r, { pointsBalance: balance, categoryPoints, tiers })
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      costPoints: r.cost_points,
      imageUrl: r.image_url,
      stock: r.stock,
      category: r.category,
      ...state,
    }
  })

  type PartnerJoin = {
    name: string
    logo_url: string | null
    discount_label: string | null
    category: string | null
    url: string | null
  }
  // Beneficios de TODOS los niveles (agrupados por tier para la vista aspiracional).
  const benefitsByTier = new Map<string, WalletBenefit[]>()
  type RewardJoin = { image_url: string | null }
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
    const arr = benefitsByTier.get(b.tier_id)
    if (arr) arr.push(mapped)
    else benefitsByTier.set(b.tier_id, [mapped])
  }

  const progression: WalletTierStep[] = sortedActiveTiers(tiers).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    badgeIcon: t.badge_icon,
    minCategoryPoints: t.min_category_points,
    unlocked: categoryPoints >= t.min_category_points,
    current: current?.id === t.id,
    pointsToReach: Math.max(0, t.min_category_points - categoryPoints),
    benefits: benefitsByTier.get(t.id) ?? [],
  }))

  const benefits: WalletBenefit[] = current ? (benefitsByTier.get(current.id) ?? []) : []

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
      birthdate: customer.birthdate,
      pointsBalance: balance,
      categoryPoints,
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
        ? {
            id: current.id,
            name: current.name,
            color: current.color,
            badgeIcon: current.badge_icon,
            perks: current.perks,
          }
        : null,
      next: progress.next
        ? {
            id: progress.next.id,
            name: progress.next.name,
            thresholdPoints: progress.next.min_category_points,
          }
        : null,
      pointsToNext: progress.pointsToNext,
      progressPct: progress.pct,
    },
    categoryWindowMonths: windowMonths,
    expiry,
    earn,
    benefits,
    progression,
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
