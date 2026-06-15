import { z } from 'zod'
import { flowStepConfigSchema, flowTriggerConfigSchema } from './schemas'

// Node kinds that can appear in a flow graph
export type FlowNodeKind = 'trigger' | 'send_template' | 'wait' | 'condition' | 'add_tag'

const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID')

export const flowGraphNodeSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['trigger', 'send_template', 'wait', 'condition', 'add_tag']),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type FlowGraphNode = z.infer<typeof flowGraphNodeSchema>

export const flowGraphEdgeSchema = z.object({
  id: uuidSchema,
  source: uuidSchema,
  target: uuidSchema,
  sourceHandle: z.union([z.literal('true'), z.literal('false'), z.null()]).default(null),
})
export type FlowGraphEdge = z.infer<typeof flowGraphEdgeSchema>

export const saveFlowGraphPayloadSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(false),
  trigger: flowTriggerConfigSchema,
  nodes: z.array(flowGraphNodeSchema).min(1).max(50),
  edges: z.array(flowGraphEdgeSchema).max(100),
})
export type SaveFlowGraphPayload = z.infer<typeof saveFlowGraphPayloadSchema>

/**
 * Pure validation of the graph structure (no DB). Returns an error message
 * string or null if valid. Exported so it can be used in tests and the server action.
 */
export function validateFlowGraph(payload: SaveFlowGraphPayload): string | null {
  const triggerNodes = payload.nodes.filter((n) => n.kind === 'trigger')
  if (triggerNodes.length === 0) return 'El flow debe tener exactamente un nodo Trigger.'
  if (triggerNodes.length > 1) return 'El flow no puede tener más de un nodo Trigger.'

  const nodeIds = new Set(payload.nodes.map((n) => n.id))
  for (const edge of payload.edges) {
    if (!nodeIds.has(edge.source)) {
      return `El edge ${edge.id} referencia un nodo fuente inexistente (${edge.source}).`
    }
    if (!nodeIds.has(edge.target)) {
      return `El edge ${edge.id} referencia un nodo destino inexistente (${edge.target}).`
    }
  }

  return null
}

// Re-export step config schema for the node config panel
export { flowStepConfigSchema, flowTriggerConfigSchema }
