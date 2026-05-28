import 'server-only'
import { createClient } from '@/lib/supabase/server'

// Tag plano — alias canónico que va a la UI del cliente y del admin (cards).
// Es el mismo shape que devuelve el RPC get_session_state en cada item.
export type ItemTag = {
  id: string
  tenant_id: string
  name: string
  color: string
}

export type ItemTagRow = {
  id: string
  name: string
  color: string
  created_at: string
  // assignment_count es opcional para mantener compatibilidad con consumers
  // existentes. listItemTags lo incluye siempre; quienes lo necesiten leerlo
  // pueden hacerlo con ?? 0.
  assignment_count?: number
}

// Lista todos los tags del tenant + cuántos ítems los tienen asignados.
// Se hace en dos pasos (tags + grouped count) para evitar joins complicados.
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
  const tags = data ?? []
  if (tags.length === 0) return []

  // Contamos assignments por tag_id. Hacemos un query simple a la tabla de
  // join restringida a los tag_ids del tenant; RLS de menu_item_tag_assignments
  // ya filtra por tenant pero el filtro explícito por tag_ids in (...) ayuda
  // al planner.
  const tagIds = tags.map((t) => t.id)
  const { data: assignments, error: assignErr } = await supabase
    .from('menu_item_tag_assignments')
    .select('tag_id')
    .in('tag_id', tagIds)
  if (assignErr) {
    console.error('[item-tags.list.counts]', assignErr.message)
    return tags.map((t) => ({ ...t, assignment_count: 0 }))
  }

  const counts = new Map<string, number>()
  for (const row of (assignments ?? []) as Array<{ tag_id: string }>) {
    counts.set(row.tag_id, (counts.get(row.tag_id) ?? 0) + 1)
  }

  return tags.map((t) => ({ ...t, assignment_count: counts.get(t.id) ?? 0 }))
}

// Trae las tags asignadas a un ítem puntual. Incluye tenant_id para que
// los consumers puedan validar pertenencia sin volver a la DB.
export async function getTagsForItem(menuItemId: string): Promise<ItemTag[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_item_tag_assignments')
    .select('tag:item_tags(id, tenant_id, name, color)')
    .eq('menu_item_id', menuItemId)
  if (error || !data) {
    if (error) console.error('[item-tags.getTagsForItem]', error.message)
    return []
  }
  type Joined = { tag: ItemTag | ItemTag[] | null }
  const out: ItemTag[] = []
  for (const row of data as unknown as Joined[]) {
    const t = Array.isArray(row.tag) ? row.tag[0] : row.tag
    if (t) out.push(t)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Devuelve un Map indexado por menu_item_id con las tags de cada uno.
// Pensado para listMenu(): N items → 1 query → merge en memoria.
export async function getTagsByItemIds(itemIds: string[]): Promise<Map<string, ItemTag[]>> {
  const out = new Map<string, ItemTag[]>()
  if (itemIds.length === 0) return out

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('menu_item_tag_assignments')
    .select('menu_item_id, tag:item_tags(id, tenant_id, name, color)')
    .in('menu_item_id', itemIds)
  if (error || !data) {
    if (error) console.error('[item-tags.getTagsByItemIds]', error.message)
    return out
  }

  type Joined = { menu_item_id: string; tag: ItemTag | ItemTag[] | null }
  for (const row of data as unknown as Joined[]) {
    const t = Array.isArray(row.tag) ? row.tag[0] : row.tag
    if (!t) continue
    const list = out.get(row.menu_item_id)
    if (list) {
      list.push(t)
    } else {
      out.set(row.menu_item_id, [t])
    }
  }
  // Ordenamos cada lista por nombre para que la UI sea estable.
  for (const list of out.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return out
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
