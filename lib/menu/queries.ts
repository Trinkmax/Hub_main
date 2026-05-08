import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type MenuCategory = {
  id: string
  name: string
  position: number
  active: boolean
}

export type MenuItem = {
  id: string
  category_id: string
  name: string
  description: string | null
  price_cents: number
  points_override: number | null
  position: number
  active: boolean
  image_url: string | null
}

export async function listMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  const [{ data: cats, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, position, active')
      .eq('tenant_id', opts.tenantId)
      .order('position', { ascending: true }),
    supabase
      .from('menu_items')
      .select(
        'id, category_id, name, description, price_cents, points_override, position, active, image_url',
      )
      .eq('tenant_id', opts.tenantId)
      .order('position', { ascending: true }),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return {
    categories: (cats ?? []) as MenuCategory[],
    items: (items ?? []) as MenuItem[],
  }
}

export async function listActiveMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  const [{ data: cats }, { data: items }] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, position, active')
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .order('position', { ascending: true }),
    supabase
      .from('menu_items')
      .select(
        'id, category_id, name, description, price_cents, points_override, position, active, image_url',
      )
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .order('position', { ascending: true }),
  ])
  return {
    categories: (cats ?? []) as MenuCategory[],
    items: (items ?? []) as MenuItem[],
  }
}
