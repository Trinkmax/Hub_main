import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import type { PunchTriggerType } from './schemas'
import { isPunchCardUnlocked } from './tier-gate'

export type PunchCardTemplateRow = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  stamp_icon: string | null
  reward_label: string | null
  trigger_type: PunchTriggerType
  trigger_ref_id: string | null
  threshold: number
  reward_id: string
  reward_name?: string
  expires_after_days: number | null
  active: boolean
  sort: number
  config: Record<string, unknown>
  created_at: string
  /** Niveles habilitados a sellarla. Vacío = todos. */
  tier_ids: string[]
  /** Qué ve el socio que no llega: bloqueada (true) o nada. */
  show_when_locked: boolean
}

const TEMPLATE_COLUMNS =
  'id, name, description, image_url, stamp_icon, reward_label, trigger_type, trigger_ref_id, threshold, reward_id, expires_after_days, active, sort, config, created_at, show_when_locked'

export async function listPunchCardTemplates(tenantId: string): Promise<PunchCardTemplateRow[]> {
  const supabase = await createClient()
  // El orden lo decide el dueño arrastrando (`sort`); `created_at` desempata
  // las que nunca se movieron.
  // Los niveles se filtran sólo por tenant (no dependen de los templates), así
  // que van en paralelo: 2 hops secuenciales → 1.
  const [{ data, error }, { data: links, error: linkError }] = await Promise.all([
    supabase
      .from('punch_card_templates')
      .select(`${TEMPLATE_COLUMNS}, rewards(name)`)
      .eq('tenant_id', tenantId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('punch_card_template_tiers')
      .select('template_id, tier_id')
      .eq('tenant_id', tenantId),
  ])
  if (error || !data) {
    console.error('[punch-cards.list]', error?.message)
    return []
  }
  type Joined = Omit<PunchCardTemplateRow, 'tier_ids'> & {
    rewards: { name: string } | { name: string }[] | null
  }
  const rows = data as unknown as Joined[]

  // Los niveles de todas las tarjetas en una sola consulta (no una por fila).
  const tierIdsByTemplate = new Map<string, string[]>()
  if (rows.length > 0) {
    if (linkError) console.error('[punch-cards.list.tiers]', linkError.message)
    for (const link of (links ?? []) as Array<{ template_id: string; tier_id: string }>) {
      const list = tierIdsByTemplate.get(link.template_id)
      if (list) list.push(link.tier_id)
      else tierIdsByTemplate.set(link.template_id, [link.tier_id])
    }
  }

  return rows.map((r) => {
    const rew = Array.isArray(r.rewards) ? r.rewards[0] : r.rewards
    return {
      ...r,
      reward_name: rew?.name,
      tier_ids: tierIdsByTemplate.get(r.id) ?? [],
      show_when_locked: r.show_when_locked !== false,
    }
  })
}

export type CustomerLunchCardSnapshot = {
  template_id: string
  template_name: string
  current_stamps: number
  threshold: number
  reward_name: string | null
  config: Record<string, unknown>
}

// Devuelve el primer punch_card visit_window activo del tenant + el estado
// (si hay card iniciada por el cliente). Si no hay card iniciada todavía,
// devuelve stamps=0 para que el mozo pueda marcar el primer almuerzo.
export async function getCustomerLunchSnapshot(opts: {
  tenantId: string
  customerId: string
}): Promise<CustomerLunchCardSnapshot | null> {
  const supabase = await createClient()
  const { data: template } = await supabase
    .from('punch_card_templates')
    .select('id, name, threshold, config, reward:rewards(name)')
    .eq('tenant_id', opts.tenantId)
    .eq('trigger_type', 'visit_window')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!template) return null

  const { data: card } = await supabase
    .from('customer_punch_cards')
    .select('current_stamps, threshold_snapshot')
    .eq('customer_id', opts.customerId)
    .eq('template_id', template.id)
    .is('completed_at', null)
    .is('expired_at', null)
    .maybeSingle()

  type Reward = { name: string | null } | { name: string | null }[] | null
  const reward: Reward = (template as unknown as { reward: Reward }).reward
  const rewardName = Array.isArray(reward) ? (reward[0]?.name ?? null) : (reward?.name ?? null)

  return {
    template_id: template.id as string,
    template_name: template.name as string,
    current_stamps: card?.current_stamps ?? 0,
    threshold: card?.threshold_snapshot ?? (template.threshold as number),
    reward_name: rewardName,
    config: (template.config as Record<string, unknown>) ?? {},
  }
}

export type CustomerPunchCard = {
  /** null mientras el cliente no tenga tarjeta iniciada (todavía va en 0). */
  cardId: string | null
  templateId: string
  templateName: string
  stampIcon: string | null
  imageUrl: string | null
  current: number
  threshold: number
  remaining: number
  /** La tarjeta es de otra categoría: el "+1" no va a poder sellarla. */
  lockedByTier: boolean
  /** Niveles que la habilitan, para explicarle al cajero por qué no puede. */
  requiredTierNames: string[]
}

/**
 * Tarjetas del cliente para la caja (/acreditar) y la ficha del socio.
 * Parte de los TEMPLATES activos y le pega la tarjeta en curso, así las que
 * están en cero también aparecen y el cajero puede sellar la primera.
 */
export async function listCustomerPunchCards(
  tenantSlug: string,
  customerId: string,
): Promise<CustomerPunchCard[]> {
  let tenantId: string
  try {
    const { tenant, role } = await requireTenantAccess(tenantSlug)
    requireRole(role, ['owner', 'cashier', 'waiter'])
    tenantId = tenant.id
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return []
    }
    throw error
  }

  const supabase = await createClient()
  // Nivel del socio + qué niveles habilita cada tarjeta: sin esto el cajero
  // aprieta "+1" y recién ahí se entera de que la tarjeta es de otra categoría.
  // Ninguna de las cuatro lecturas depende de otra (sólo tenantId/customerId),
  // así que los templates viajan en el mismo Promise.all: 2 hops → 1.
  const [{ data: templates, error }, { data: cards }, { data: tierLinks }, { data: myTier }] =
    await Promise.all([
      supabase
        .from('punch_card_templates')
        .select('id, name, stamp_icon, image_url, threshold, sort, created_at')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('sort', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('customer_punch_cards')
        .select('id, template_id, current_stamps, threshold_snapshot')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .is('completed_at', null)
        .is('expired_at', null),
      supabase
        .from('punch_card_template_tiers')
        .select('template_id, tier_id, loyalty_tiers(name)')
        .eq('tenant_id', tenantId),
      supabase.rpc('customer_effective_tier', { p_customer_id: customerId }),
    ])
  if (error || !templates || templates.length === 0) {
    if (error) console.error('[punch-cards.listCustomer]', error.message)
    return []
  }

  const currentTierId = typeof myTier === 'string' ? myTier : null
  const tiersByTemplate = new Map<string, Array<{ id: string; name: string }>>()
  type TierLink = {
    template_id: string
    tier_id: string
    loyalty_tiers: { name: string } | { name: string }[] | null
  }
  for (const link of (tierLinks ?? []) as TierLink[]) {
    const joined = Array.isArray(link.loyalty_tiers) ? link.loyalty_tiers[0] : link.loyalty_tiers
    const entry = { id: link.tier_id, name: joined?.name ?? '' }
    const list = tiersByTemplate.get(link.template_id)
    if (list) list.push(entry)
    else tiersByTemplate.set(link.template_id, [entry])
  }

  const byTemplate = new Map<string, { id: string; current: number; threshold: number }>()
  for (const c of cards ?? []) {
    byTemplate.set(c.template_id, {
      id: c.id,
      current: c.current_stamps,
      threshold: c.threshold_snapshot,
    })
  }

  return templates.map((t) => {
    const card = byTemplate.get(t.id)
    // El umbral vigente para el cliente es el congelado al iniciar la tarjeta:
    // subir el threshold del template no debe alargar una tarjeta ya empezada.
    const threshold = card?.threshold ?? t.threshold
    const current = card?.current ?? 0
    const allowed = tiersByTemplate.get(t.id) ?? []
    return {
      cardId: card?.id ?? null,
      templateId: t.id,
      templateName: t.name,
      stampIcon: t.stamp_icon,
      imageUrl: t.image_url,
      current,
      threshold,
      remaining: Math.max(0, threshold - current),
      lockedByTier: !isPunchCardUnlocked(
        allowed.map((a) => a.id),
        currentTierId,
      ),
      requiredTierNames: allowed.map((a) => a.name).filter((n) => n.length > 0),
    }
  })
}
