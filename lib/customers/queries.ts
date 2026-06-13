import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { ListFilters } from './schemas'

export type CustomerListRow = {
  id: string
  phone: string
  first_name: string
  last_name: string
  last_visit_at: string | null
  points_balance: number
  total_visits: number
  created_at: string
  tags: { id: string; name: string; color: string }[]
}

export const PAGE_SIZE = 25

export async function listCustomers(opts: {
  tenantId: string
  filters: ListFilters
}): Promise<{ rows: CustomerListRow[]; total: number }> {
  const supabase = await createClient()
  const { filters } = opts

  let query = supabase
    .from('customers')
    .select(
      `
      id, phone, first_name, last_name, last_visit_at,
      points_balance, total_visits, created_at,
      tags:customer_tag_assignments(
        tag:customer_tags(id, name, color)
      )
    `,
      { count: 'exact' },
    )
    .eq('tenant_id', opts.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (filters.q) {
    const q = filters.q
    const isDigits = /^[\d+\s\-()]+$/.test(q)
    if (isDigits) {
      // Match parcial sobre phone
      const digits = q.replace(/\D/g, '')
      query = query.ilike('phone', `%${digits}%`)
    } else {
      // Texto: trigram en first/last name
      const safe = q.replace(/[%,]/g, '')
      query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
    }
  }

  if (filters.since === '30d') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('last_visit_at', cutoff)
  } else if (filters.since === '90d') {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('last_visit_at', cutoff)
  } else if (filters.since === 'never') {
    query = query.is('last_visit_at', null)
  }

  // Pedido cliente: separar "Base de datos" (gente de reservas sin sistema de
  // puntos) de "Usuarios con puntos" (gente que ya consumió). Mantenemos una
  // sola tabla y derivamos la pertenencia del programa via total_visits.
  if (filters.programa === 'with_points') {
    query = query.gt('total_visits', 0)
  } else if (filters.programa === 'contact_only') {
    query = query.eq('total_visits', 0)
  }

  // Segmento de adquisición (nav Personas → Reservas / Walk-in).
  if (filters.segment === 'reserva') {
    query = query.eq('acquisition_channel', 'reservation')
  } else if (filters.segment === 'walkin') {
    query = query.neq('acquisition_channel', 'reservation')
  }

  const from = (filters.page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1
  query = query.range(from, to)

  const { data, error, count } = await query
  if (error) throw error

  let rows: CustomerListRow[] = (data ?? []).map((row) => {
    const raw = row as unknown as {
      id: string
      phone: string
      first_name: string
      last_name: string
      last_visit_at: string | null
      points_balance: number
      total_visits: number
      created_at: string
      tags: { tag: { id: string; name: string; color: string } | null }[] | null
    }
    return {
      id: raw.id,
      phone: raw.phone,
      first_name: raw.first_name,
      last_name: raw.last_name,
      last_visit_at: raw.last_visit_at,
      points_balance: raw.points_balance,
      total_visits: raw.total_visits,
      created_at: raw.created_at,
      tags: (raw.tags ?? [])
        .map((t) => t.tag)
        .filter((t): t is { id: string; name: string; color: string } => t !== null),
    }
  })

  // Filtro por tag — Supabase no soporta filtrar por relación N:M en una sola
  // query, así que hacemos un pass post-fetch. Aceptable para page size 25.
  if (filters.tag) {
    rows = rows.filter((r) => r.tags.some((t) => t.id === filters.tag))
  }

  return { rows, total: count ?? 0 }
}

export async function getCustomerById(opts: { tenantId: string; id: string }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select(`
      *,
      tags:customer_tag_assignments(
        tag:customer_tags(id, name, color)
      )
    `)
    .eq('tenant_id', opts.tenantId)
    .eq('id', opts.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const raw = data as unknown as {
    tags: { tag: { id: string; name: string; color: string } | null }[] | null
    [k: string]: unknown
  }

  return {
    ...raw,
    tags: (raw.tags ?? [])
      .map((t) => t.tag)
      .filter((t): t is { id: string; name: string; color: string } => t !== null),
  }
}

export async function listCustomerProgramaCounts(opts: { tenantId: string }): Promise<{
  all: number
  with_points: number
  contact_only: number
}> {
  const supabase = await createClient()
  // Tres counts por separado. RLS ya filtra al tenant; aún así pasamos tenant_id
  // explícito para que Postgres use el índice parcial (tenant_id, deleted_at).
  const [{ count: allCount }, { count: withCount }, { count: contactCount }] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', opts.tenantId)
      .is('deleted_at', null),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', opts.tenantId)
      .is('deleted_at', null)
      .gt('total_visits', 0),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', opts.tenantId)
      .is('deleted_at', null)
      .eq('total_visits', 0),
  ])

  return {
    all: allCount ?? 0,
    with_points: withCount ?? 0,
    contact_only: contactCount ?? 0,
  }
}

export async function getCustomerByQrToken(opts: { tenantId: string; token: string }): Promise<{
  id: string
  first_name: string
  last_name: string
  phone: string
  points_balance: number
} | null> {
  if (!opts.token || opts.token.length < 8 || opts.token.length > 128) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select('id, first_name, last_name, phone, points_balance, tenant_id')
    .eq('tenant_id', opts.tenantId)
    .eq('qr_token', opts.token)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id,
    first_name: data.first_name,
    last_name: data.last_name,
    phone: data.phone,
    points_balance: data.points_balance,
  }
}

export async function listTags(opts: { tenantId: string }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customer_tags')
    .select('id, name, color')
    .eq('tenant_id', opts.tenantId)
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listCaptureLinks(opts: { tenantId: string }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customer_capture_links')
    .select('id, slug, label, active, created_at')
    .eq('tenant_id', opts.tenantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
