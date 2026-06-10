import 'server-only'
import { getTagsByItemIds, type ItemTag } from '@/lib/item-tags/queries'
import { createClient } from '@/lib/supabase/server'

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
  // Campos del rediseño 2026 — siempre presentes; default false / []
  featured: boolean
  tags: ItemTag[]
}

// Columnas estables que sí tipa database.ts. Para leer `featured` (mig
// posterior, todavía no regenerada) usamos una segunda lectura en paralelo
// indexada por id — así evitamos cast a `any` en el .select() y la query
// pega un solo round-trip a Postgres (Promise.all).
const MENU_ITEM_COLUMNS =
  'id, category_id, name, description, price_cents, points_override, position, active, image_url'

type FeaturedRow = { id: string; featured: boolean | null }

export async function listMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  const [{ data: cats, error: e1 }, { data: items, error: e2 }, { data: featuredRows, error: e3 }] =
    await Promise.all([
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
      // featured no está aún en database.ts → cast aditivo al row tipo FeaturedRow.
      supabase
        .from('menu_items')
        .select('id, featured')
        .eq('tenant_id', opts.tenantId)
        .returns<FeaturedRow[]>(),
    ])
  if (e1) throw e1
  if (e2) throw e2
  if (e3) throw e3

  const featuredById = new Map<string, boolean>()
  for (const row of (featuredRows ?? []) as FeaturedRow[]) {
    featuredById.set(row.id, row.featured ?? false)
  }

  const rawItems = (items ?? []) as Omit<MenuItem, 'featured' | 'tags'>[]
  const tagsByItem = await getTagsByItemIds(rawItems.map((i) => i.id))

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
    featured: featuredById.get(i.id) ?? false,
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
  const [{ data: cats }, { data: items }, { data: featuredRows }] = await Promise.all([
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
    supabase
      .from('menu_items')
      .select('id, featured')
      .eq('tenant_id', opts.tenantId)
      .eq('active', true)
      .returns<FeaturedRow[]>(),
  ])

  const featuredById = new Map<string, boolean>()
  for (const row of (featuredRows ?? []) as FeaturedRow[]) {
    featuredById.set(row.id, row.featured ?? false)
  }

  const rawItems = (items ?? []) as Omit<MenuItem, 'featured' | 'tags'>[]
  const tagsByItem = await getTagsByItemIds(rawItems.map((i) => i.id))

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
    featured: featuredById.get(i.id) ?? false,
    tags: tagsByItem.get(i.id) ?? [],
  }))

  return {
    categories: (cats ?? []) as MenuCategory[],
    items: mergedItems,
  }
}
