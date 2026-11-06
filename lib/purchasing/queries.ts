import 'server-only'
import { addDays, todayInCordoba } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import { dataIssues } from './checks'
import { computeEventNeeds, type EventNeeds, type PlannedEvent, planEvent } from './events'
import {
  toCalendarEvent,
  toCount,
  toCountLine,
  toEventPlan,
  toItem,
  toOrder,
  toRecipe,
  toSettings,
  toSupplier,
  toZone,
} from './rows'
import { itemsForCount } from './suggest'
import {
  type CalendarEvent,
  expectedPacks,
  type OrderStatus,
  type PurCount,
  type PurCountLine,
  type PurEventPlan,
  type PurItem,
  type PurOrder,
  type PurRecipe,
  type PurSettings,
  type PurSupplier,
  type PurZone,
} from './types'
import { packsToUnits, roundQty } from './units'

/**
 * Lecturas de Compras con la sesión de quien mira (RLS: dueño, cocina y caja). Las páginas ya validaron el
 * rol con `requireRole`; la base lo vuelve a decidir.
 */

export type Catalog = {
  settings: PurSettings
  zones: PurZone[]
  suppliers: PurSupplier[]
  items: PurItem[]
  recipes: PurRecipe[]
}

function fail(what: string, error: { code?: string; message?: string } | null): never {
  console.error(`[purchasing.${what}]`, { code: error?.code })
  throw new Error(`No se pudo leer ${what}.`)
}

export async function getCatalog(tenantId: string): Promise<Catalog> {
  const db = await createClient()
  const [settings, zones, suppliers, items, recipes] = await Promise.all([
    db.from('pur_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
    db.from('pur_zones').select('*').eq('tenant_id', tenantId).order('sort_order').order('name'),
    db.from('pur_suppliers').select('*').eq('tenant_id', tenantId).order('name'),
    db.from('pur_items').select('*').eq('tenant_id', tenantId).order('name'),
    db.from('pur_recipes').select('*, pur_recipe_lines(*)').eq('tenant_id', tenantId).order('name'),
  ])
  if (settings.error) fail('los ajustes', settings.error)
  if (zones.error) fail('las zonas', zones.error)
  if (suppliers.error) fail('los proveedores', suppliers.error)
  if (items.error) fail('los insumos', items.error)
  if (recipes.error) fail('las recetas', recipes.error)
  return {
    settings: toSettings(settings.data),
    zones: zones.data.map(toZone),
    suppliers: suppliers.data.map(toSupplier),
    items: items.data.map(toItem),
    recipes: recipes.data.map(toRecipe),
  }
}

/** Las fechas del calendario entre dos días, con sus planes (variante y personas). */
export async function getEventsBetween(
  tenantId: string,
  from: string,
  to: string,
): Promise<{ events: CalendarEvent[]; plans: PurEventPlan[] }> {
  const db = await createClient()
  const { data, error } = await db.rpc('pur_events_between', {
    p_tenant_id: tenantId,
    p_from: from,
    p_to: to,
  })
  if (error) fail('el calendario', error)
  const events: CalendarEvent[] = []
  for (const row of data ?? []) events.push(toCalendarEvent(row))
  if (!events.length) return { events, plans: [] }
  const plans = await db
    .from('pur_event_plans')
    .select('*')
    .eq('tenant_id', tenantId)
    .in(
      'scheduled_event_id',
      events.map((e) => e.id),
    )
  if (plans.error) fail('los planes de los eventos', plans.error)
  return { events, plans: plans.data.map(toEventPlan) }
}

/** Lo que ya está pedido y no llegó, por insumo y en su unidad (para no pedirlo dos veces). */
export async function getInTransit(tenantId: string): Promise<Map<string, number>> {
  const db = await createClient()
  const { data, error } = await db
    .from('pur_orders')
    .select('id, status, pur_order_lines(item_id, ordered_packs, confirmed_packs, pack_size)')
    .eq('tenant_id', tenantId)
    .in('status', ['sent', 'confirmed'])
  if (error) fail('lo que está en camino', error)
  const out = new Map<string, number>()
  for (const order of data ?? []) {
    for (const line of order.pur_order_lines ?? []) {
      if (!line.item_id) continue
      const packs = expectedPacks({
        confirmedPacks: line.confirmed_packs == null ? null : Number(line.confirmed_packs),
        orderedPacks: line.ordered_packs == null ? null : Number(line.ordered_packs),
      })
      if (packs <= 0) continue
      const units = packsToUnits(packs, line.pack_size == null ? null : Number(line.pack_size))
      out.set(line.item_id, roundQty((out.get(line.item_id) ?? 0) + units))
    }
  }
  return out
}

/** El último día en que se contó cada insumo, en los conteos enviados de los últimos 45 días. */
export async function getLastCounted(
  tenantId: string,
  today: string,
): Promise<Map<string, string>> {
  const db = await createClient()
  const { data, error } = await db
    .from('pur_counts')
    .select('count_date, pur_count_lines(item_id)')
    .eq('tenant_id', tenantId)
    .eq('status', 'sent')
    .gte('count_date', addDays(today, -45))
    .order('count_date', { ascending: false })
  if (error) fail('los conteos anteriores', error)
  const out = new Map<string, string>()
  for (const count of data ?? []) {
    for (const line of count.pur_count_lines ?? []) {
      if (!out.has(line.item_id)) out.set(line.item_id, count.count_date)
    }
  }
  return out
}

export async function getOpenCount(tenantId: string): Promise<PurCount | null> {
  const db = await createClient()
  const { data, error } = await db
    .from('pur_counts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .maybeSingle()
  if (error) fail('el conteo abierto', error)
  return data ? toCount(data) : null
}

export async function getCountWithLines(
  tenantId: string,
  countId: string,
): Promise<{ count: PurCount; lines: PurCountLine[] } | null> {
  const db = await createClient()
  const [count, lines] = await Promise.all([
    db.from('pur_counts').select('*').eq('tenant_id', tenantId).eq('id', countId).maybeSingle(),
    db
      .from('pur_count_lines')
      .select('item_id, state, quantity')
      .eq('tenant_id', tenantId)
      .eq('count_id', countId),
  ])
  if (count.error) fail('el conteo', count.error)
  if (lines.error) fail('lo contado', lines.error)
  if (!count.data) return null
  return { count: toCount(count.data), lines: lines.data.map(toCountLine) }
}

export async function getOrders(
  tenantId: string,
  statuses: readonly OrderStatus[],
): Promise<PurOrder[]> {
  const db = await createClient()
  const { data, error } = await db
    .from('pur_orders')
    .select('*, pur_order_lines(*)')
    .eq('tenant_id', tenantId)
    .in('status', [...statuses])
    .order('expected_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) fail('los pedidos', error)
  return (data ?? []).map(toOrder)
}

export async function getOrder(tenantId: string, orderId: string): Promise<PurOrder | null> {
  const db = await createClient()
  const { data, error } = await db
    .from('pur_orders')
    .select('*, pur_order_lines(*)')
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .maybeSingle()
  if (error) fail('el pedido', error)
  return data ? toOrder(data) : null
}

/** Los pedidos que se cerraron en los últimos días (para el historial del panel). */
export async function getRecentlyClosed(tenantId: string, days = 14): Promise<PurOrder[]> {
  const db = await createClient()
  const since = `${addDays(todayInCordoba(), -days)}T00:00:00-03:00`
  const { data, error } = await db
    .from('pur_orders')
    .select('*, pur_order_lines(*)')
    .eq('tenant_id', tenantId)
    .in('status', ['completed', 'discarded'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(40)
  if (error) fail('el historial', error)
  return (data ?? []).map(toOrder)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que arma cada pantalla
// ─────────────────────────────────────────────────────────────────────────────

export type CountContext = {
  catalog: Catalog
  count: PurCount
  lines: PurCountLine[]
  /** Lo que aparece en este conteo, en el orden del recorrido. */
  items: PurItem[]
  eventNeeds: EventNeeds
  inTransit: Map<string, number>
}

/** Todo lo que necesita la cocina para contar y para ver el resumen. */
export async function getCountContext(
  tenantId: string,
  countId: string,
): Promise<CountContext | null> {
  const found = await getCountWithLines(tenantId, countId)
  if (!found) return null
  const { count, lines } = found
  const [catalog, calendar, inTransit, lastCounted] = await Promise.all([
    getCatalog(tenantId),
    getEventsBetween(tenantId, count.countDate, count.eventsUntil),
    getInTransit(tenantId),
    getLastCounted(tenantId, count.countDate),
  ])
  const itemsById = new Map(catalog.items.map((i) => [i.id, i]))
  const eventNeeds = computeEventNeeds({
    events: calendar.events,
    recipes: catalog.recipes,
    plans: calendar.plans,
    items: itemsById,
    baseGuests: catalog.settings.recipeBaseGuests,
  })
  // Lo que alguien ya contó aparece siempre, aunque hoy no le tocara (lo agregaron a mano o cambió la frecuencia).
  const counted = new Set(lines.map((l) => l.itemId))
  const items = itemsForCount({
    items: catalog.items,
    needs: eventNeeds.needs,
    lastCounted,
    countDate: count.countDate,
  })
  const shown = new Set(items.map((i) => i.id))
  for (const id of counted) {
    const item = itemsById.get(id)
    if (item && !shown.has(id)) items.push(item)
  }
  return { catalog, count, lines, items, eventNeeds, inTransit }
}

export type PanelData = {
  catalog: Catalog
  today: string
  drafts: PurOrder[]
  sent: PurOrder[]
  confirmed: PurOrder[]
  differences: PurOrder[]
  closed: PurOrder[]
  upcoming: PlannedEvent[]
  issues: ReturnType<typeof dataIssues>
  openCount: PurCount | null
}

/** El panel de quien compra: los cuatro estados, los próximos 7 días y los datos para corregir. */
export async function getPanelData(tenantId: string): Promise<PanelData> {
  const today = todayInCordoba()
  const [catalog, orders, closed, calendar, openCount] = await Promise.all([
    getCatalog(tenantId),
    getOrders(tenantId, ['draft', 'sent', 'confirmed', 'with_differences']),
    getRecentlyClosed(tenantId),
    getEventsBetween(tenantId, today, addDays(today, 13)),
    getOpenCount(tenantId),
  ])
  const planByEvent = new Map(calendar.plans.map((p) => [p.scheduledEventId, p]))
  const upcoming = calendar.events.map((event) =>
    planEvent({
      event,
      recipes: catalog.recipes,
      plan: planByEvent.get(event.id),
      baseGuests: catalog.settings.recipeBaseGuests,
    }),
  )
  const issues = dataIssues({
    items: catalog.items,
    suppliers: catalog.suppliers,
    recipes: catalog.recipes,
    upcoming,
  })
  return {
    catalog,
    today,
    drafts: orders.filter((o) => o.status === 'draft'),
    sent: orders.filter((o) => o.status === 'sent'),
    confirmed: orders.filter((o) => o.status === 'confirmed'),
    differences: orders.filter((o) => o.status === 'with_differences'),
    closed,
    upcoming,
    issues,
    openCount,
  }
}

export type KitchenHome = {
  settings: PurSettings
  today: string
  openCount: (PurCount & { counted: number }) | null
  /** Lo que la cocina puede recibir: confirmado o mandado (con el aviso de que no se confirmó). */
  receivable: PurOrder[]
  suppliers: PurSupplier[]
  week: PlannedEvent[]
}

export async function getKitchenHome(tenantId: string): Promise<KitchenHome> {
  const today = todayInCordoba()
  const db = await createClient()
  const [catalog, receivable, calendar, openCount] = await Promise.all([
    getCatalog(tenantId),
    getOrders(tenantId, ['sent', 'confirmed']),
    getEventsBetween(tenantId, today, addDays(today, 6)),
    getOpenCount(tenantId),
  ])
  let counted = 0
  if (openCount) {
    const { count, error } = await db
      .from('pur_count_lines')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('count_id', openCount.id)
    if (error) fail('el conteo abierto', error)
    counted = count ?? 0
  }
  const planByEvent = new Map(calendar.plans.map((p) => [p.scheduledEventId, p]))
  const week = calendar.events.map((event) =>
    planEvent({
      event,
      recipes: catalog.recipes,
      plan: planByEvent.get(event.id),
      baseGuests: catalog.settings.recipeBaseGuests,
    }),
  )
  return {
    settings: catalog.settings,
    today,
    openCount: openCount ? { ...openCount, counted } : null,
    receivable,
    suppliers: catalog.suppliers,
    week,
  }
}
