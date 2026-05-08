import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database } from '@/types/database'

export type ChannelRow = Database['public']['Tables']['channels']['Row']

export async function getChannelsForTenant(tenantId: string): Promise<ChannelRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('channels').select('*').eq('tenant_id', tenantId)
  if (error) {
    console.error('[channels.getChannelsForTenant]', error.message)
    return []
  }
  return data ?? []
}

export async function getChannelByTenantAndType(
  tenantId: string,
  type: 'whatsapp' | 'instagram',
): Promise<ChannelRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('type', type)
    .maybeSingle()
  if (error) {
    console.error('[channels.getChannelByTenantAndType]', error.message)
    return null
  }
  return data
}

export async function disconnectChannelService(channelId: string, tenantId: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service
    .from('channels')
    .update({
      status: 'disconnected',
      encrypted_access_token: null,
      token_expires_at: null,
      last_error: null,
    })
    .eq('id', channelId)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
}
