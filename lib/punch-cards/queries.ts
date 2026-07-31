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
}

const TEMPLATE_COLUMNS =
  'id, name, description, image_url, stamp_icon, reward_label, trigger_type, trigger_ref_id, threshold, reward_id, expires_after_days, active, sort, config, created_at'

export async function listPunchCardTemplates(tenantId: string): Promise<PunchCardTemplateRow[]> {
  const supabase = await createClient()
  // El orden lo decide el dueño arrastrando (`sort`); `created_at` desempata
  // las que nunca se movieron.
  const { data, error } = await supabase
    .from('punch_card_templates')
    .select(`${TEMPLATE_COLUMNS}, rewards(name)`)
    .eq('tenant_id', tenantId)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !data) {
    console.error('[punch-cards.list]', error?.message)
    return []
  }
  type Joined = PunchCardTemplateRow & {
    rewards: { name: string } | { name: string }[] | null
  }
  return data.map((row) => {
    const r = row as unknown as Joined
    const rew = Array.isArray(r.rewards) ? r.rewards[0] : r.rewards
    return { ...r, reward_name: rew?.name }
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
  const { data: templates, error } = await supabase
    .from('punch_card_templates')
    .select('id, name, stamp_icon, image_url, threshold, sort, created_at')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !templates || templates.length === 0) {
    if (error) console.error('[punch-cards.listCustomer]', error.message)
    return []
  }

  const { data: cards } = await supabase
    .from('customer_punch_cards')
    .select('id, template_id, current_stamps, threshold_snapshot')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('completed_at', null)
    .is('expired_at', null)

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
    return {
      cardId: card?.id ?? null,
      templateId: t.id,
      templateName: t.name,
      stampIcon: t.stamp_icon,
      imageUrl: t.image_url,
      current,
      threshold,
      remaining: Math.max(0, threshold - current),
    }
  })
}
