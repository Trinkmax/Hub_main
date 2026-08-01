import 'server-only'
import { subMonths } from 'date-fns'
import QRCode from 'qrcode'
import { getAppUrl } from '@/lib/app-url'
import type { TierBenefitCadence, TierBenefitKind } from '@/lib/points/benefits'
import { computeExpiry, wouldDropTier } from '@/lib/points/category'
import { hasItemBonus } from '@/lib/points/earn-rate'
import {
  type LoyaltyTier,
  progressToNext,
  resolveTier,
  sortedActiveTiers,
} from '@/lib/points/tiers'
import type { PointsRule } from '@/lib/points/types'
import { createServiceClient } from '@/lib/supabase/service'
import {
  buildPartnerTiers,
  groupBenefitsByTier,
  type PartnerBenefitRow,
  type PartnerBenefitTierRow,
  resolvePartnersForTier,
  type WalletPartnerBenefit,
  type WalletPartnerTierEntry,
} from './partner-benefits'
import { loadWalletPunchCards, type WalletPunchCard } from './punch-cards'
import { computeRewardState } from './reward-state'

export type { WalletPartnerBenefit, WalletPartnerTierEntry } from './partner-benefits'
export type { WalletPunchCard } from './punch-cards'
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
  /** Orden manual del dueño (ITEM 7). Desempata dentro de "lo que ya podés canjear". */
  sort: number
  affordable: boolean
  tierLocked: boolean
  minTierName: string | null
}

export type WalletBenefit = {
  id: string
  kind: TierBenefitKind
  label: string
  description: string | null
  icon: string | null
  /**
   * Foto de la tarjeta. Prioridad: la propia del beneficio (ITEM 6), y si no
   * tiene, la de la recompensa vinculada (recurring_reward).
   */
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

/**
 * Cómo suma puntos el socio (para "Cómo funciona").
 *
 * OJO — acá NO va la tasa ($ por punto). Es información de administración: el
 * socio tiene que sentir que consumir suma, no poder calcular el tipo de cambio.
 * Y no alcanza con sacarla del JSX: este objeto se serializa entero en el payload
 * RSC y queda legible en el HTML, así que la tasa no entra al payload. La tasa sí
 * se muestra, y así tiene que seguir, en el panel del dueño (/club?tab=programa).
 */
export type WalletEarn = {
  /** Hay reglas por producto activas → "algunos productos suman extra". */
  itemBonus: boolean
}

/**
 * Canje con QR vivo. Es UNO SOLO por socio a la vez (lo enforcea la RPC): los
 * puntos se descuentan cuando el mozo valida, no al generar el código, así que
 * permitir varios abiertos dejaría prometer más de lo que el saldo banca.
 */
export type WalletActiveRedemption = {
  redemptionId: string
  rewardName: string
  imageUrl: string | null
  costPoints: number
  redeemToken: string
  expiresAt: string
  /** QR ya renderizado en el server (apunta a `${appUrl}/v/<token>`). */
  qrDataUrl: string
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
    /** Lo que esta marca le da en SU nivel (null = en su nivel no le da nada). */
    myBenefit: WalletPartnerBenefit | null
    /** Nivel más bajo donde esta marca sí da algo, cuando `myBenefit` es null. */
    unlockTierName: string | null
  }>
  /**
   * Aliados por categoría, en el mismo orden que `progression` (vista 'niveles').
   * Opcional: el simulador del club arma un WalletData sintético y todavía no lo
   * completa — ver nota en simulator.ts.
   */
  partnerTiers?: Array<{ tierId: string; entries: WalletPartnerTierEntry[] }>
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
    /** Puntos que se descuentan al entregarlo (0 en regalos y beneficios de nivel). */
    costPoints?: number
  }>
  /** El canje con QR vivo, si hay uno. Va arriba de todo en la wallet. */
  activeRedemption?: WalletActiveRedemption | null
  /**
   * Hash del estado visible en el momento de renderizar. El cliente lo compara
   * contra `wallet_pulse` cada pocos segundos y refresca sólo si cambió — así el
   * canje entregado y los puntos recién acreditados aparecen solos, sin que el
   * socio tenga que recargar.
   */
  rev: string | null
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
    punchCards,
    { data: visitsData },
    { data: redemptionsData },
    { data: ledgerData },
    { data: earnData },
    { data: eventsData },
    { data: pendingData },
    { data: partnersData },
    { data: rulesData },
    { data: partnerBenefitsData },
    { data: partnerBenefitTiersData },
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
      .select('id, name, description, cost_points, stock, image_url, min_tier_id, category, sort')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('visible_in_catalog', true)
      // ITEM 7: manda el orden que el dueño armó arrastrando en el editor. El
      // costo queda de desempate para las filas que nunca se tocaron.
      .order('sort', { ascending: true })
      .order('cost_points', { ascending: true }),
    service
      .from('tier_benefits')
      .select(
        'id, tier_id, kind, label, description, icon, image_url, quantity, cadence, discount_pct, discount_scope, sort, reward:rewards(image_url), partner:partners(name, logo_url, discount_label, category, url)',
      )
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort', { ascending: true }),
    loadWalletPunchCards(service, tenantId, customerId),
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
      .select(
        'id, notes, points_spent, redeem_token, token_expires_at, reward:rewards(name, image_url)',
      )
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
    // Reglas de acumulación → sólo para saber si hay bonus por producto.
    // La tasa por monto NO se lee acá a propósito: ver WalletEarn.
    service
      .from('points_rules')
      .select('id, type, config, priority, active')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    // Beneficios de aliados + a qué niveles corresponden.
    service
      .from('partner_benefits')
      .select('id, partner_id, label, description, discount_pct, image_url, sort')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort', { ascending: true }),
    service.from('partner_benefit_tiers').select('benefit_id, tier_id').eq('tenant_id', tenantId),
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
  const earn: WalletEarn = { itemBonus: hasItemBonus(rules) }

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
      sort: number | null
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
      sort: r.sort ?? 0,
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
    image_url: string | null
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
      // La foto PROPIA del beneficio (ITEM 6) le gana a la prestada de la
      // recompensa vinculada: si el dueño se tomó el trabajo de subirla, es la
      // que quiere ver. La de la recompensa queda de fallback.
      imageUrl: b.image_url ?? rw?.image_url ?? null,
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

  // ── Aliados: qué le toca en SU nivel + la escalera completa ────────────
  const partnerRows = (partnersData ?? []) as Array<{
    id: string
    name: string
    logo_url: string | null
    discount_label: string | null
    category: string | null
    url: string | null
    active: boolean
  }>
  const partnerBenefitsByTier = groupBenefitsByTier(
    (partnerBenefitsData ?? []) as PartnerBenefitRow[],
    (partnerBenefitTiersData ?? []) as PartnerBenefitTierRow[],
  )
  // Una marca pausada NO promete nada: sale como "Próximamente" y punto. Los
  // beneficios nacen `active = true` mientras que la marca nace `active = false`
  // (el dueño la carga como borrador y la prende cuando cierra el acuerdo), así
  // que sin este filtro el socio vería el 30% de una marca que todavía no existe.
  const activePartnerIds = partnerRows.filter((p) => p.active).map((p) => p.id)
  const partnerResolution = resolvePartnersForTier(
    activePartnerIds,
    partnerBenefitsByTier,
    tiers,
    current?.id ?? null,
  )
  const partners: WalletData['partners'] = partnerRows.map((p) => {
    const resolved = p.active ? partnerResolution.get(p.id) : undefined
    return {
      id: p.id,
      name: p.name,
      logoUrl: p.logo_url,
      discountLabel: p.discount_label,
      category: p.category,
      url: p.url,
      active: p.active,
      myBenefit: resolved?.myBenefit ?? null,
      unlockTierName: resolved?.unlockTierName ?? null,
    }
  })
  const partnerTiers = buildPartnerTiers(
    partners.filter((p) => p.active),
    partnerBenefitsByTier,
    tiers,
  )

  // ── Canjes pendientes + el que ya tiene QR vivo ────────────────────────
  type PendingRow = {
    id: string
    notes: string | null
    points_spent: number
    redeem_token: string | null
    token_expires_at: string | null
    reward:
      | { name: string; image_url: string | null }
      | { name: string; image_url: string | null }[]
      | null
  }
  const pendingRows = (pendingData ?? []) as PendingRow[]
  const nowMs = now.getTime()
  const liveRow = pendingRows.find(
    (p) =>
      p.redeem_token !== null &&
      p.token_expires_at !== null &&
      new Date(p.token_expires_at).getTime() > nowMs,
  )
  let activeRedemption: WalletActiveRedemption | null = null
  if (liveRow?.redeem_token && liveRow.token_expires_at) {
    const reward = Array.isArray(liveRow.reward) ? liveRow.reward[0] : liveRow.reward
    const appUrl = await getAppUrl()
    activeRedemption = {
      redemptionId: liveRow.id,
      rewardName: reward?.name ?? 'Beneficio',
      imageUrl: reward?.image_url ?? null,
      costPoints: liveRow.points_spent,
      redeemToken: liveRow.redeem_token,
      expiresAt: liveRow.token_expires_at,
      qrDataUrl: await QRCode.toDataURL(`${appUrl}/v/${liveRow.redeem_token}`, {
        width: 420,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      }),
    }
  }

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
    partners,
    partnerTiers,
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
    // El que ya tiene QR vivo se muestra aparte (activeRedemption), no dos veces.
    pendingBenefits: pendingRows
      .filter((p) => p.id !== activeRedemption?.redemptionId)
      .map((p) => {
        const reward = Array.isArray(p.reward) ? p.reward[0] : p.reward
        return {
          redemptionId: p.id,
          rewardName: reward?.name ?? 'Beneficio',
          imageUrl: reward?.image_url ?? null,
          kind: benefitKind(p.notes),
          costPoints: p.points_spent,
        }
      }),
    activeRedemption,
    rev: await computeWalletRev(service, token),
  }
}

/**
 * Baseline del pulso. Usa la MISMA función que consulta el cliente: si el hash
 * se calculara en dos lugares distintos, cualquier divergencia daría un refresh
 * infinito (el cliente vería "cambió" en cada tick) o ninguno.
 */
async function computeWalletRev(
  service: ReturnType<typeof createServiceClient>,
  token: string,
): Promise<string | null> {
  const { data, error } = await service.rpc('wallet_pulse', { p_qr_token: token })
  if (error) {
    console.error('[wallet] pulse baseline', error.message)
    return null
  }
  const rev = (data as { rev?: string | null } | null)?.rev
  return typeof rev === 'string' ? rev : null
}
