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
  /** Eventos (shows) para el campo "Asistió a un evento". */
  events: { id: string; name: string }[]
}

/**
 * Opciones para los selects del builder de audiencias: niveles, tags y eventos
 * del tenant. Reemplaza los inputs de UUID crudo por dropdowns legibles.
 */
export async function getAudienceBuilderOptions(tenantId: string): Promise<AudienceBuilderOptions> {
  const supabase = await createClient()
  const [tiers, tags, events] = await Promise.all([
    supabase
      .from('loyalty_tiers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('min_lifetime_points', { ascending: true }),
    supabase.from('customer_tags').select('id, name').eq('tenant_id', tenantId).order('name'),
    supabase
      .from('events')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('status', ['published', 'finished'])
      .order('starts_at', { ascending: false })
      .limit(100),
  ])

  return {
    tiers: tiers.data ?? [],
    tags: tags.data ?? [],
    events: events.data ?? [],
  }
}
