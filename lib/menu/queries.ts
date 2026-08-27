import 'server-only'
import { getTagsByTenant, type ItemTag } from '@/lib/item-tags/queries'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type MenuCategory = {
  id: string
  name: string
  position: number
  active: boolean
  image_url: string | null
  parent_id: string | null
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
  video_url: string | null
  // Campos del rediseño 2026 — siempre presentes; default false / []
  featured: boolean
  tags: ItemTag[]
}

// `featured` ya está tipado en database.ts: va en el mismo select y nos
// ahorramos la segunda lectura de menu_items que había antes.
const MENU_ITEM_COLUMNS =
  'id, category_id, name, description, price_cents, points_override, position, active, image_url, video_url, featured'

export async function listMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  // Las tags se piden por tenant (no por ids de ítem) para que salgan en el
  // mismo Promise.all: 2 hops secuenciales → 1.
  const [{ data: cats, error: e1 }, { data: items, error: e2 }, tagsByItem] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, position, active, image_url, parent_id')
      .eq('tenant_id', opts.tenantId)
      .order('position', { ascending: true }),
    supabase
      .from('menu_items')
      .select(MENU_ITEM_COLUMNS)
      .eq('tenant_id', opts.tenantId)
      .not('category_id', 'is', null)
      .order('position', { ascending: true }),
    getTagsByTenant(opts.tenantId),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const rawItems = (items ?? []) as Omit<MenuItem, 'tags'>[]

  const mergedItems: MenuItem[] = rawItems.map((i) => ({
    id: i.id,
    category_id: i.category_id,
    name: i.name,
    description: i.description,
    price_cents: i.price_cents,
    points_override: i.points_override,
    position: i.position,
    active: i.active,
    image_url: i.image_url,
    video_url: i.video_url,
    featured: i.featured ?? false,
    tags: tagsByItem.get(i.id) ?? [],
  }))

  return {
    categories: (cats ?? []) as MenuCategory[],
    items: mergedItems,
  }
}

/**
 * Variante PÚBLICA de la carta activa: lee con service-role porque la carta
 * read-only (/carta/[slug]) la ve un visitante anónimo y las tablas de menú no
 * están en el allow-list de `anon` (RLS las bloquearía). Sólo categorías/ítems
 * activos. Nunca expone datos sensibles del tenant.
 */
export async function listActiveMenuPublic(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const service = createServiceClient()
  // Tags vía service (bypass RLS) filtradas por tenant del tag, así van en el
  // mismo Promise.all que categorías e ítems: 2 hops secuenciales → 1.
  const [{ data: cats }, { data: items }, { data: assigns }] = await Promise.all([
    service
      .from('menu_categories')
      .select('id, name, position, active, image_url, parent_id')
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .order('position', { ascending: true }),
    service
      .from('menu_items')
      .select(MENU_ITEM_COLUMNS)
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .not('category_id', 'is', null)
      .order('position', { ascending: true }),
    service
      .from('menu_item_tag_assignments')
      .select('menu_item_id, tag:item_tags!inner(id, tenant_id, name, color)')
      .eq('tag.tenant_id', opts.tenantId),
  ])

  const rawItems = (items ?? []) as Array<Omit<MenuItem, 'tags'>>

  const tagsByItem = new Map<string, ItemTag[]>()
  type Joined = { menu_item_id: string; tag: ItemTag | ItemTag[] | null }
  for (const row of (assigns ?? []) as unknown as Joined[]) {
    const t = Array.isArray(row.tag) ? row.tag[0] : row.tag
    if (!t) continue
    const list = tagsByItem.get(row.menu_item_id)
    if (list) list.push(t)
    else tagsByItem.set(row.menu_item_id, [t])
  }
  for (const list of tagsByItem.values()) list.sort((a, b) => a.name.localeCompare(b.name))

  const mergedItems: MenuItem[] = rawItems.map((i) => ({
    id: i.id,
    category_id: i.category_id,
    name: i.name,
    description: i.description,
    price_cents: i.price_cents,
    points_override: i.points_override,
    position: i.position,
    active: i.active,
    image_url: i.image_url,
    video_url: i.video_url,
    featured: i.featured ?? false,
    tags: tagsByItem.get(i.id) ?? [],
  }))

  return {
    categories: (cats ?? []) as MenuCategory[],
    items: mergedItems,
  }
}

export async function listActiveMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  // Mismo criterio que listMenu: tags por tenant en paralelo, 2 hops → 1.
  const [{ data: cats }, { data: items }, tagsByItem] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name, position, active, image_url, parent_id')
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .order('position', { ascending: true }),
    supabase
      .from('menu_items')
      .select(MENU_ITEM_COLUMNS)
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .not('category_id', 'is', null)
      .order('position', { ascending: true }),
    getTagsByTenant(opts.tenantId),
  ])

  const rawItems = (items ?? []) as Omit<MenuItem, 'tags'>[]

  const mergedItems: MenuItem[] = rawItems.map((i) => ({
    id: i.id,
    category_id: i.category_id,
    name: i.name,
    description: i.description,
    price_cents: i.price_cents,
    points_override: i.points_override,
    position: i.position,
    active: i.active,
    image_url: i.image_url,
    video_url: i.video_url,
    featured: i.featured ?? false,
    tags: tagsByItem.get(i.id) ?? [],
  }))

  return {
    categories: (cats ?? []) as MenuCategory[],
    items: mergedItems,
  }
}
