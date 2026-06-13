import 'server-only'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { enqueueJob } from '@/lib/jobs/queue'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, FlowTriggerType } from '@/types/database'

type FlowRow = Database['public']['Tables']['flows']['Row']

const TZ = 'America/Argentina/Cordoba'

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

// Clientes con reserva (con CRM) para un evento del calendario que arranca en
// ~hoursBefore. Los scheduled_events guardan fecha + hora local, así que
// computamos el instante de inicio en el reloj del bar (TZ Córdoba).
async function customersForEventStarting(
  flow: FlowRow,
  hoursBefore: number,
): Promise<Array<{ customer_id: string }>> {
  const service = createServiceClient()
  const now = Date.now()
  const lower = new Date(now + (hoursBefore - 1) * 3600_000)
  const upper = new Date(now + hoursBefore * 3600_000)

  // La ventana abarca a lo sumo 2 fechas locales.
  const dates = Array.from(
    new Set([formatInTimeZone(lower, TZ, 'yyyy-MM-dd'), formatInTimeZone(upper, TZ, 'yyyy-MM-dd')]),
  )
  const { data: scheduled } = await service
    .from('scheduled_events')
    .select('id, event_date, starts_at_local')
    .eq('tenant_id', flow.tenant_id)
    .in('event_date', dates)
  const eventIds = (scheduled ?? [])
    .filter((e) => {
      const start = fromZonedTime(`${e.event_date}T${e.starts_at_local}`, TZ)
      return start >= lower && start <= upper
    })
    .map((e) => e.id)
  if (eventIds.length === 0) return []

  const { data } = await service
    .from('salon_reservations')
    .select('customer_id')
    .eq('tenant_id', flow.tenant_id)
    .in('scheduled_event_id', eventIds)
    .not('customer_id', 'is', null)
    .in('status', ['pending', 'arrived', 'seated'])
    .limit(1000)

  const seen = new Set<string>()
  const out: Array<{ customer_id: string }> = []
  for (const r of data ?? []) {
    if (r.customer_id && !seen.has(r.customer_id)) {
      seen.add(r.customer_id)
      out.push({ customer_id: r.customer_id })
    }
  }
  return out
}
