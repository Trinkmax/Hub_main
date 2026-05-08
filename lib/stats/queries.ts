import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type Kpis = {
  customers_total: number
  customers_active_30d: number
  visits_30d: number
  revenue_30d_cents: number
  avg_ticket_30d_cents: number
}

export async function getKpis(tenantId: string): Promise<Kpis> {
  const supabase = await createClient()
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  const [{ count: customersTotal }, dailyRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null),
    supabase
      .from('v_tenant_daily_metrics')
      .select('visits, revenue_cents, customers_active')
      .eq('tenant_id', tenantId)
      .gte('day', since),
  ])

  const rows = dailyRes.data ?? []
  const visits = rows.reduce((acc, r) => acc + (r.visits ?? 0), 0)
  const revenue = rows.reduce((acc, r) => acc + Number(r.revenue_cents ?? 0), 0)
  const activeSet = new Set<string>() // proxy: usamos sum de customers_active diarios — en MV ya es distinct por día
  // No tenemos lista de customers únicos directos en la MV; aproximamos con max() diario.
  const customersActive = rows.reduce((max, r) => Math.max(max, r.customers_active ?? 0), 0)
  void activeSet

  const avg = visits > 0 ? Math.floor(revenue / visits) : 0

  return {
    customers_total: customersTotal ?? 0,
    customers_active_30d: customersActive,
    visits_30d: visits,
    revenue_30d_cents: revenue,
    avg_ticket_30d_cents: avg,
  }
}

export async function getDailyMetrics(tenantId: string, days: number) {
  const supabase = await createClient()
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('v_tenant_daily_metrics')
    .select('day, visits, revenue_cents, customers_active, customers_new')
    .eq('tenant_id', tenantId)
    .gte('day', since)
    .order('day', { ascending: true })
  return data ?? []
}

export async function getHeatmap(tenantId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_visit_heatmap')
    .select('dow, hour, visit_count')
    .eq('tenant_id', tenantId)
  return data ?? []
}

export type TopCustomerRow = {
  customer_id: string
  first_name: string
  last_name: string
  total_visits: number
  total_spent_cents: number
  avg_ticket_cents: number
  last_visit_at: string | null
  favorite_item_name: string | null
}

export async function getTopCustomersBySpent(
  tenantId: string,
  limit = 50,
): Promise<TopCustomerRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_customer_stats')
    .select(
      'customer_id, first_name, last_name, total_visits, total_spent_cents, avg_ticket_cents, last_visit_at, favorite_item_name',
    )
    .eq('tenant_id', tenantId)
    .order('total_spent_cents', { ascending: false })
    .limit(limit)
  return (data ?? []) as TopCustomerRow[]
}

export type ChurnRiskRow = {
  customer_id: string
  first_name: string
  last_name: string
  phone: string
  total_visits: number
  visit_frequency_days: number
  days_since_last_visit: number
  last_visit_at: string
  total_spent_cents: number
}

export async function getChurnRisk(tenantId: string, limit = 200): Promise<ChurnRiskRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_churn_risk')
    .select(
      'customer_id, first_name, last_name, phone, total_visits, visit_frequency_days, days_since_last_visit, last_visit_at, total_spent_cents',
    )
    .eq('tenant_id', tenantId)
    .order('total_spent_cents', { ascending: false })
    .limit(limit)
  return (data ?? []) as ChurnRiskRow[]
}

export async function getCustomerInsights(tenantId: string, customerId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_customer_stats')
    .select(
      'total_visits, total_spent_cents, avg_ticket_cents, last_visit_at, days_since_last_visit, visit_frequency_days, favorite_item_name, favorite_category_name',
    )
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle()
  return data
}

export type EventRanking = {
  event_id: string
  event_name: string
  starts_at: string
  reservations: number
  attended: number
  no_show: number
  no_show_rate: number
}

export async function getEventsRanking(tenantId: string, limit = 20): Promise<EventRanking[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('events')
    .select('id, name, starts_at, reservations:reservations(status)')
    .eq('tenant_id', tenantId)
    .in('status', ['finished', 'cancelled', 'published'])
    .order('starts_at', { ascending: false })
    .limit(limit)
  type Joined = {
    id: string
    name: string
    starts_at: string
    reservations: Array<{ status: string }> | null
  }
  return ((data ?? []) as unknown as Joined[]).map((ev) => {
    const list = ev.reservations ?? []
    const reservations = list.filter((r) => r.status !== 'cancelled').length
    const attended = list.filter((r) => r.status === 'checked_in').length
    const noShow = list.filter((r) => r.status === 'no_show').length
    const denom = attended + noShow
    return {
      event_id: ev.id,
      event_name: ev.name,
      starts_at: ev.starts_at,
      reservations,
      attended,
      no_show: noShow,
      no_show_rate: denom > 0 ? noShow / denom : 0,
    }
  })
}

export type CommunicationStats = {
  total_recipients: number
  sent: number
  delivered: number
  read: number
  failed: number
  opt_outs: number // placeholder en v1
}

export async function getCommunicationStats(tenantId: string): Promise<CommunicationStats> {
  const supabase = await createClient()
  // Agregamos los recipients de todas las difusiones del tenant.
  // En la lectura RLS pasa: broadcast_recipients vía broadcasts.tenant_id.
  const { data: broadcasts } = await supabase
    .from('broadcasts')
    .select('id')
    .eq('tenant_id', tenantId)
  const ids = (broadcasts ?? []).map((b) => b.id)
  if (ids.length === 0) {
    return { total_recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, opt_outs: 0 }
  }
  const { data: recipients } = await supabase
    .from('broadcast_recipients')
    .select('status')
    .in('broadcast_id', ids)
  const counts = { sent: 0, delivered: 0, read: 0, failed: 0 }
  for (const r of recipients ?? []) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1
  }
  return {
    total_recipients: (recipients ?? []).length,
    ...counts,
    opt_outs: 0,
  }
}
