import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type ItemTagRow = {
  id: string
  name: string
  color: string
  created_at: string
}

export async function listItemTags(tenantId: string): Promise<ItemTagRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('item_tags')
    .select('id, name, color, created_at')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  if (error) {
    console.error('[item-tags.list]', error.message)
    return []
  }
  return data ?? []
}

export type ItemWithTags = {
  id: string
  name: string
  category_name: string | null
  tag_ids: string[]
}

export async function listMenuItemsWithTags(tenantId: string): Promise<ItemWithTags[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, menu_categories(name), menu_item_tag_assignments(tag_id)')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  if (error || !data) {
    console.error('[item-tags.listItems]', error?.message)
    return []
  }
  type Joined = {
    id: string
    name: string
    menu_categories: { name: string } | { name: string }[] | null
    menu_item_tag_assignments: Array<{ tag_id: string }> | null
  }
  return data.map((row) => {
    const r = row as unknown as Joined
    const cat = Array.isArray(r.menu_categories) ? r.menu_categories[0] : r.menu_categories
    return {
      id: r.id,
      name: r.name,
      category_name: cat?.name ?? null,
      tag_ids: (r.menu_item_tag_assignments ?? []).map((x) => x.tag_id),
    }
  })
}
