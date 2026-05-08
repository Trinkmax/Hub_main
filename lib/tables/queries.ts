import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type PhysicalTableRow = {
  id: string
  label: string
  capacity: number | null
  qr_token: string
  active: boolean
  created_at: string
}

export async function listPhysicalTables(tenantId: string): Promise<PhysicalTableRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('physical_tables')
    .select('id, label, capacity, qr_token, active, created_at')
    .eq('tenant_id', tenantId)
    .order('label', { ascending: true })

  if (error) {
    console.error('[tables.listPhysicalTables]', error.message)
    return []
  }
  return data ?? []
}
