import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'
import { type FlowLogFilters, LOG_PAGE_SIZE, resolveLogRange } from './execution-log-filters'
import type { FlowActionType, FlowEventStatus } from './execution-log-labels'

// Lectura del historial paso a paso. Va con el cliente de sesión (no service):
// la RLS de flow_execution_events ya filtra por membresía del tenant, y arriba
// la page valida owner. Doble filtro por tenant_id igual, por las dudas.

export type FlowLogRow = {
  id: string
  occurred_at: string
  action_type: FlowActionType
  action_label: string
  status: FlowEventStatus
  detail: Json
  error: string | null
  customer: { id: string; first_name: string; last_name: string } | null
}

export type FlowLogContact = { id: string; first_name: string; last_name: string }

export async function listFlowExecutionEvents(params: {
  tenantId: string
  flowId: string
  filters: FlowLogFilters
}): Promise<{ rows: FlowLogRow[]; total: number }> {
  const supabase = await createClient()
  const { fromIso, toIso } = resolveLogRange(params.filters)
  const from = (params.filters.page - 1) * LOG_PAGE_SIZE

  let query = supabase
    .from('flow_execution_events')
    .select(
      'id, occurred_at, action_type, action_label, status, detail, error, customer:customers(id, first_name, last_name)',
      { count: 'exact' },
    )
    .eq('tenant_id', params.tenantId)
    .eq('flow_id', params.flowId)
    .gte('occurred_at', fromIso)
    .lt('occurred_at', toIso)

  if (params.filters.accion) query = query.eq('action_type', params.filters.accion)
  if (params.filters.estado) query = query.eq('status', params.filters.estado)
  if (params.filters.contacto) query = query.eq('customer_id', params.filters.contacto)

  const { data, error, count } = await query
    .order('occurred_at', { ascending: false })
    .range(from, from + LOG_PAGE_SIZE - 1)

  if (error) {
    console.error('[flows.log.list]', error.message)
    return { rows: [], total: 0 }
  }

  // El embed puede tipar `customer` como array (customers también lo referencian
  // las vistas de stats, así que PostgREST no lo resuelve a 1:1). Mismo apaño que
  // en lib/reviews/queries.ts.
  type Raw = Omit<FlowLogRow, 'customer'> & {
    customer: FlowLogContact | FlowLogContact[] | null
  }
  const rows = ((data ?? []) as unknown as Raw[]).map((row) => ({
    ...row,
    customer: (Array.isArray(row.customer) ? (row.customer[0] ?? null) : row.customer) ?? null,
  }))
  return { rows, total: count ?? 0 }
}

/**
 * Clientes que alguna vez entraron a este flow, para el selector "Contacto".
 * Se listan desde flow_executions (una fila por inscripción) porque es el
 * índice que existe; deduplicamos acá.
 */
export async function listFlowLogContacts(params: {
  tenantId: string
  flowId: string
}): Promise<FlowLogContact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flow_executions')
    .select('customer:customers(id, first_name, last_name)')
    .eq('tenant_id', params.tenantId)
    .eq('flow_id', params.flowId)
    .order('started_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[flows.log.contacts]', error.message)
    return []
  }

  const seen = new Set<string>()
  const out: FlowLogContact[] = []
  const raw = (data ?? []) as unknown as Array<{
    customer: FlowLogContact | FlowLogContact[] | null
  }>
  for (const row of raw) {
    const c = Array.isArray(row.customer) ? row.customer[0] : row.customer
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out.sort((a, b) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'es-AR'),
  )
}
