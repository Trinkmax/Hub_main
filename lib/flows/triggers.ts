import 'server-only'
import { enqueueJob } from '@/lib/jobs/queue'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, FlowTriggerType } from '@/types/database'

type FlowRow = Database['public']['Tables']['flows']['Row']

// Recorre flows activos por tipo y encola jobs `start_flow` para cada
// (flow, customer) que cumpla el criterio. Idempotencia garantizada por
// el RPC start_flow_for_customer.
export async function evaluateTimeTriggers(
  triggerTypes: FlowTriggerType[] = ['customer_inactive', 'birthday', 'event_starting'],
): Promise<{ enqueued: number }> {
  const service = createServiceClient()
  let enqueued = 0
  for (const type of triggerTypes) {
    const { data: flows } = await service
      .from('flows')
      .select('*')
      .eq('trigger_type', type)
      .eq('active', true)
    for (const flow of (flows ?? []) as FlowRow[]) {
      enqueued += await evaluateOneFlow(flow)
    }
  }
  return { enqueued }
}

async function evaluateOneFlow(flow: FlowRow): Promise<number> {
  const service = createServiceClient()
  const config = flow.trigger_config as Record<string, unknown>
  let candidates: Array<{ customer_id: string }> = []

  if (flow.trigger_type === 'customer_inactive') {
    const days = Number(config.days ?? 0)
    if (!Number.isFinite(days) || days < 1) return 0
    const { data } = await service.rpc('customers_for_inactive_flow', {
      p_flow_id: flow.id,
      p_days: days,
    })
    candidates = data ?? []
  } else if (flow.trigger_type === 'birthday') {
    const { data } = await service.rpc('customers_for_birthday_flow', {
      p_flow_id: flow.id,
    })
    candidates = data ?? []
  } else if (flow.trigger_type === 'event_starting') {
    const hoursBefore = Number(config.hours_before ?? 24)
    candidates = await customersForEventStarting(flow, hoursBefore)
  }

  for (const c of candidates) {
    await enqueueJob({
      tenantId: flow.tenant_id,
      kind: 'start_flow',
      payload: { flow_id: flow.id, customer_id: c.customer_id },
    })
  }
  return candidates.length
}

async function customersForEventStarting(
  flow: FlowRow,
  hoursBefore: number,
): Promise<Array<{ customer_id: string }>> {
  const service = createServiceClient()
  const lower = new Date(Date.now() + (hoursBefore - 1) * 3600_000).toISOString()
  const upper = new Date(Date.now() + hoursBefore * 3600_000).toISOString()
  const { data } = await service
    .from('reservations')
    .select('customer_id, event:events!inner(tenant_id, starts_at, status)')
    .eq('event.tenant_id', flow.tenant_id)
    .gt('event.starts_at', lower)
    .lte('event.starts_at', upper)
    .in('status', ['confirmed', 'checked_in'])
    .limit(1000)
  return (data ?? []).map((r) => ({ customer_id: r.customer_id }))
}
