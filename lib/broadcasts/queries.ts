import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { BroadcastStatus, RecipientStatus } from '@/types/database'

export type BroadcastListRow = {
  id: string
  name: string
  status: BroadcastStatus
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  stats: Record<string, number>
}

export async function listBroadcasts(tenantId: string): Promise<BroadcastListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id, name, status, scheduled_at, started_at, completed_at, stats')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[broadcasts.list]', error.message)
    return []
  }
  return (data ?? []).map((row) => ({
    ...row,
    stats: (row.stats ?? {}) as Record<string, number>,
  }))
}

export async function getBroadcastDetail(tenantId: string, id: string) {
  const supabase = await createClient()
  const { data: broadcast } = await supabase
    .from('broadcasts')
    .select(
      'id, name, status, scheduled_at, started_at, completed_at, stats, channel:channels(display_name, type), template:message_templates(name, language), audience:audiences(name, customer_count_cached)',
    )
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!broadcast) return null
  const { data: recipients } = await supabase
    .from('broadcast_recipients')
    .select(
      'id, status, sent_at, delivered_at, read_at, replied_at, error, customer:customers(first_name, last_name, phone)',
    )
    .eq('broadcast_id', id)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(200)
  return {
    broadcast,
    recipients: (recipients ?? []) as Array<{
      id: string
      status: RecipientStatus
      sent_at: string | null
      delivered_at: string | null
      read_at: string | null
      replied_at: string | null
      error: string | null
      customer:
        | { first_name: string; last_name: string; phone: string }
        | { first_name: string; last_name: string; phone: string }[]
        | null
    }>,
  }
}
