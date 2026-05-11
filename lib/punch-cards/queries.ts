import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PunchCardTemplateRow = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  trigger_type: 'item' | 'category' | 'tag' | 'visit_window'
  trigger_ref_id: string | null
  threshold: number
  reward_id: string
  reward_name?: string
  expires_after_days: number | null
  active: boolean
  config: Record<string, unknown>
  created_at: string
}

export async function listPunchCardTemplates(tenantId: string): Promise<PunchCardTemplateRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('punch_card_templates')
    .select(
      'id, name, description, image_url, trigger_type, trigger_ref_id, threshold, reward_id, expires_after_days, active, config, created_at, rewards(name)',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
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
