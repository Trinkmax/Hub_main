import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type AudienceListRow = {
  id: string
  name: string
  customer_count_cached: number
  last_calculated_at: string | null
  updated_at: string
}

export async function listAudiences(tenantId: string): Promise<AudienceListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audiences')
    .select('id, name, customer_count_cached, last_calculated_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[audiences.list]', error.message)
    return []
  }
  return data ?? []
}

export async function getAudience(tenantId: string, id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audiences')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return data
}

export type AudienceBuilderOptions = {
  /** Niveles del club para el campo "Nivel actual". */
  tiers: { id: string; name: string }[]
  /** Tags de clientes para el campo "Tiene tag". */
  tags: { id: string; name: string }[]
  /** Eventos del calendario para el campo "Asistió a un evento". */
  events: { id: string; name: string }[]
}

function shortEventDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(
    new Date(y, m - 1, d),
  )
}

/**
 * Opciones para los selects del builder de audiencias: niveles, tags y eventos
 * del calendario (scheduled_events) del tenant. Reemplaza UUIDs crudos por
 * dropdowns legibles.
 */
export async function getAudienceBuilderOptions(tenantId: string): Promise<AudienceBuilderOptions> {
  const supabase = await createClient()
  const [tiers, tags, scheduled] = await Promise.all([
    supabase
      .from('loyalty_tiers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('min_category_points', { ascending: true }),
    supabase.from('customer_tags').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase
      .from('scheduled_events')
      .select('id, name_override, event_date, template:scheduled_event_templates(name)')
      .eq('tenant_id', tenantId)
      .order('event_date', { ascending: false })
      .limit(100),
  ])

  const events = (scheduled.data ?? []).map((e) => {
    const tpl = e.template as { name: string } | { name: string }[] | null
    const tplName = Array.isArray(tpl) ? tpl[0]?.name : tpl?.name
    const label = e.name_override ?? tplName ?? 'Evento'
    return { id: e.id, name: `${label} · ${shortEventDate(e.event_date)}` }
  })

  return {
    tiers: tiers.data ?? [],
    tags: tags.data ?? [],
    events,
  }
}
