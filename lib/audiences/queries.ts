import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type AudienceListRow = {
  id: string
  name: string
  customer_count_cached: number
  last_calculated_at: string | null
  updated_at: string
}

export async function listAudiences(tenantId: string): Promise<AudienceListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audiences')
    .select('id, name, customer_count_cached, last_calculated_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[audiences.list]', error.message)
    return []
  }
  return data ?? []
}

export async function getAudience(tenantId: string, id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audiences')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return data
}
