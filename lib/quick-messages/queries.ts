import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type QuickMessageRow = {
  id: string
  title: string
  shortcut: string
  body: string
  sort_order: number
}

export async function listQuickMessages(tenantId: string): Promise<QuickMessageRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('quick_messages')
    .select('id, title, shortcut, body, sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })

  if (error) {
    console.error('[quick-messages.list]', error.message)
    return []
  }

  return data ?? []
}
