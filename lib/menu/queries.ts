import 'server-only'
import { getTagsByTenant, type ItemTag } from '@/lib/item-tags/queries'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { type Availability, parseAvailability } from './availability'

export type MenuCategory = {
  id: string
  name: string
  position: number
  active: boolean
  image_url: string | null
  parent_id: string | null
  /**
   * Cuándo se muestra en la carta (`lib/menu/availability.ts`): las franjas de días y horas del
   * rubro. `null` o ausente = siempre. Lo heredan sus subcategorías.
   */
  availability?: Availability
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

const CATEGORY_COLUMNS = 'id, name, position, active, image_url, parent_id'
/** Con el horario del rubro (`menu_categories.availability`, migración `pos_revisiones_socios`). */
const CATEGORY_COLUMNS_WITH_HOURS = `${CATEGORY_COLUMNS}, availability` as const

type CategoryRow = Omit<MenuCategory, 'availability'> & { availability?: unknown }
type CategoryClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>

/** La base no conoce la columna pedida (`42703`) o PostgREST todavía no la tiene en su caché. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

/**
 * Las categorías del bar, en orden, con su horario. Si la columna del horario todavía no existe (el
 * código salió antes que su migración) se leen sin él: la carta pública no puede quedar vacía por
 * eso, y sin horario todo se muestra siempre, como antes.
 */
async function readCategories(
  client: CategoryClient,
  tenantId: string,
  onlyActive: boolean,
): Promise<{ data: MenuCategory[]; error: { code?: string; message: string } | null }> {
  const query = (columns: typeof CATEGORY_COLUMNS | typeof CATEGORY_COLUMNS_WITH_HOURS) => {
    const base = client.from('menu_categories').select(columns).eq('tenant_id', tenantId)
    return (onlyActive ? base.eq('active', true) : base).order('position', { ascending: true })
  }
  let result: { data: unknown; error: { code?: string; message: string } | null } = await query(
    CATEGORY_COLUMNS_WITH_HOURS,
  )
  if (isMissingColumn(result.error)) result = await query(CATEGORY_COLUMNS)
  const rows = (Array.isArray(result.data) ? result.data : []) as CategoryRow[]
  return {
    data: rows.map((row) => ({ ...row, availability: parseAvailability(row.availability) })),
    error: result.error,
  }
}

export async function listMenu(opts: { tenantId: string }): Promise<{
  categories: MenuCategory[]
  items: MenuItem[]
}> {
  const supabase = await createClient()
  // Las tags se piden por tenant (no por ids de ítem) para que salgan en el
  // mismo Promise.all: 2 hops secuenciales → 1.
  const [{ data: cats, error: e1 }, { data: items, error: e2 }, tagsByItem] = await Promise.all([
    readCategories(supabase, opts.tenantId, false),
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
    categories: cats,
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
    readCategories(service, opts.tenantId, true),
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
    categories: cats,
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
    readCategories(supabase, opts.tenantId, true),
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
    categories: cats,
    items: mergedItems,
  }
}
