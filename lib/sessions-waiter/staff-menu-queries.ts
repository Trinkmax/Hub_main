import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type StaffMenuItem = {
  id: string
  name: string
  description: string | null
  price_cents: number
  image_url: string | null
  position: number
}

export type StaffMenuCategory = {
  id: string
  name: string
  position: number
  items: StaffMenuItem[]
}

/**
 * Devuelve la carta del tenant para el panel del mozo, agrupada por categoría.
 * Mismo shape que `get_session_state.menu` para que la UI lo consuma indistintamente.
 *
 * RLS sobre menu_categories / menu_items ya filtra por tenant del caller. No hace
 * falta autorizar de nuevo — el row level security se encarga.
 */
export async function getStaffMenuForTenant(tenantId: string): Promise<StaffMenuCategory[]> {
  const supabase = await createClient()

  const { data: categories, error: catErr } = await supabase
    .from('menu_categories')
    .select('id, name, position')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('position', { ascending: true })

  if (catErr || !categories) {
    console.error('[staff-menu.categories]', catErr?.message)
    return []
  }

  const categoryIds = categories.map((c) => c.id)
  if (categoryIds.length === 0) return []

  const { data: items, error: itemsErr } = await supabase
    .from('menu_items')
    .select('id, category_id, name, description, price_cents, image_url, position')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categoryIds)
    .order('position', { ascending: true })

  if (itemsErr || !items) {
    console.error('[staff-menu.items]', itemsErr?.message)
    return []
  }

  const itemsByCategory = new Map<string, StaffMenuItem[]>()
  for (const it of items) {
    const arr = itemsByCategory.get(it.category_id) ?? []
    arr.push({
      id: it.id,
      name: it.name,
      description: it.description,
      price_cents: it.price_cents,
      image_url: it.image_url,
      position: it.position,
    })
    itemsByCategory.set(it.category_id, arr)
  }

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    items: itemsByCategory.get(c.id) ?? [],
  }))
}
