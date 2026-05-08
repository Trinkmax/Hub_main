import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { FlowStepType, FlowTriggerType } from '@/types/database'

export type FlowListRow = {
  id: string
  name: string
  trigger_type: FlowTriggerType
  active: boolean
  updated_at: string
  step_count: number
}

export async function listFlows(tenantId: string): Promise<FlowListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flows')
    .select('id, name, trigger_type, active, updated_at, steps:flow_steps(count)')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[flows.list]', error.message)
    return []
  }
  return (data ?? []).map((row) => {
    const stepsArr = (row as unknown as { steps?: Array<{ count: number }> }).steps ?? []
    return {
      id: row.id,
      name: row.name,
      trigger_type: row.trigger_type,
      active: row.active,
      updated_at: row.updated_at,
      step_count: stepsArr[0]?.count ?? 0,
    }
  })
}

export type FlowDetail = {
  id: string
  name: string
  trigger_type: FlowTriggerType
  trigger_config: unknown
  active: boolean
  steps: Array<{ id: string; position: number; type: FlowStepType; config: unknown }>
}

export async function getFlow(tenantId: string, id: string): Promise<FlowDetail | null> {
  const supabase = await createClient()
  const { data: flow } = await supabase
    .from('flows')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!flow) return null
  const { data: steps } = await supabase
    .from('flow_steps')
    .select('id, position, type, config')
    .eq('flow_id', id)
    .order('position', { ascending: true })
  return {
    id: flow.id,
    name: flow.name,
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config,
    active: flow.active,
    steps: (steps ?? []) as FlowDetail['steps'],
  }
}
