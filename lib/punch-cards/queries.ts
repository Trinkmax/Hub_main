import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PunchCardTemplateRow = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  trigger_type: 'item' | 'category' | 'tag'
  trigger_ref_id: string
  threshold: number
  reward_id: string
  reward_name?: string
  expires_after_days: number | null
  active: boolean
  created_at: string
}

export async function listPunchCardTemplates(tenantId: string): Promise<PunchCardTemplateRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('punch_card_templates')
    .select(
      'id, name, description, image_url, trigger_type, trigger_ref_id, threshold, reward_id, expires_after_days, active, created_at, rewards(name)',
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
