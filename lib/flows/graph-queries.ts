import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { FlowTriggerConfig } from './schemas'

export type FlowNode = {
  id: string
  kind: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export type FlowEdge = {
  id: string
  source_node_id: string
  target_node_id: string
  source_handle: string | null
}

export type FlowGraphDetail = {
  flow: {
    id: string
    name: string
    trigger_type: string
    trigger_config: FlowTriggerConfig
    active: boolean
  }
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export async function getFlowGraph(
  tenantId: string,
  flowId: string,
): Promise<FlowGraphDetail | null> {
  const service = createServiceClient()

  const { data: flow, error: flowErr } = await service
    .from('flows')
    .select('id, name, trigger_type, trigger_config, active')
    .eq('id', flowId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (flowErr || !flow) return null

  const [nodesRes, edgesRes] = await Promise.all([
    service
      .from('flow_nodes')
      .select('id, kind, position, config')
      .eq('flow_id', flowId)
      .order('created_at', { ascending: true }),
    service
      .from('flow_edges')
      .select('id, source_node_id, target_node_id, source_handle')
      .eq('flow_id', flowId),
  ])

  const nodes: FlowNode[] = (nodesRes.data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    position:
      n.position != null && typeof n.position === 'object' && !Array.isArray(n.position)
        ? {
            x: Number((n.position as { x?: unknown }).x ?? 0),
            y: Number((n.position as { y?: unknown }).y ?? 0),
          }
        : { x: 0, y: 0 },
    config: (n.config != null && typeof n.config === 'object' && !Array.isArray(n.config)
      ? n.config
      : {}) as Record<string, unknown>,
  }))

  const edges: FlowEdge[] = (edgesRes.data ?? []).map((e) => ({
    id: e.id,
    source_node_id: e.source_node_id,
    target_node_id: e.target_node_id,
    source_handle: e.source_handle,
  }))

  return {
    flow: {
      id: flow.id,
      name: flow.name,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config as unknown as FlowTriggerConfig,
      active: flow.active,
    },
    nodes,
    edges,
  }
}
