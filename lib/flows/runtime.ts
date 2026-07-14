import 'server-only'
import { findOrCreateConversation } from '@/lib/meta/conversations'
import { sendTemplate, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'
import { type FlowStepConfig, flowStepConfigSchema } from './schemas'

type FlowExecutionRow = Database['public']['Tables']['flow_executions']['Row']
type FlowStepRow = Database['public']['Tables']['flow_steps']['Row']
type FlowNodeRow = Database['public']['Tables']['flow_nodes']['Row']
type FlowEdgeRow = Database['public']['Tables']['flow_edges']['Row']

export class RecoverableFlowError extends Error {
  readonly recoverable = true
}

export class FatalFlowError extends Error {
  readonly recoverable = false
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Returns the target_node_id of the edge leaving `fromNodeId` with the given
 * branch handle. Pass `null` (or omit) for unconditional / non-branching edges.
 * Returns `null` when no matching edge exists.
 */
export function nextNodeId(
  edges: ReadonlyArray<Pick<FlowEdgeRow, 'source_node_id' | 'target_node_id' | 'source_handle'>>,
  fromNodeId: string,
  branch: 'true' | 'false' | null = null,
): string | null {
  const edge = edges.find(
    (e) => e.source_node_id === fromNodeId && (e.source_handle ?? null) === branch,
  )
  return edge?.target_node_id ?? null
}

/**
 * Maps a boolean condition result to the branch handle string.
 */
export function pickConditionBranch(result: boolean): 'true' | 'false' {
  return result ? 'true' : 'false'
}

/**
 * Compliance §8 — Meta sólo exige opt-in de marketing para templates de
 * categoría MARKETING. UTILITY/AUTHENTICATION son transaccionales y pueden ir
 * sin opt-in (ej. recordatorio de reserva). Cualquier categoría desconocida se
 * trata como marketing (default seguro: ante la duda, exigir opt-in).
 */
export function canSendFlowTemplate(params: {
  category: string | null | undefined
  optInMarketing: boolean
}): boolean {
  const cat = (params.category ?? '').trim().toUpperCase()
  const transactional = cat === 'UTILITY' || cat === 'AUTHENTICATION'
  return transactional || params.optInMarketing
}

// ---------------------------------------------------------------------------
// Dispatch — GRAPH vs LINEAR
// ---------------------------------------------------------------------------

/**
 * Procesa el step/node actual de una execution. Avanza, programa wait, o
 * termina. Si el flow tiene flow_nodes → modo grafo; de lo contrario → modo
 * lineal heredado.
 */
export async function tickFlowExecution(executionId: string): Promise<void> {
  const service = createServiceClient()
  // Claim atómico: empujamos next_run_at ~2min al futuro, condicionado a que la
  // ejecución siga 'running' y esté vencida. Dos ticks solapados: sólo el primero
  // matchea (el segundo ve next_run_at ya futuro) → el nodo no se reprocesa (no se
  // reenvía). El procesamiento de abajo re-setea next_run_at; si crashea, reintenta
  // en ~2min. Cierra el duplicado por ticks solapados del dispatcher.
  const nowIso = new Date().toISOString()
  const { data: execution } = await service
    .from('flow_executions')
    .update({ next_run_at: new Date(Date.now() + 2 * 60 * 1000).toISOString() })
    .eq('id', executionId)
    .eq('status', 'running')
    .lte('next_run_at', nowIso)
    .select('*')
    .maybeSingle()
  if (!execution) return // no vencida, ya completada, o reclamada por otro tick

  const { data: nodes } = await service
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', execution.flow_id)

  const nodeList = (nodes ?? []) as FlowNodeRow[]

  if (nodeList.length >= 1) {
    await tickGraph(execution, nodeList)
  } else {
    await tickLinear(execution)
  }
}

// ---------------------------------------------------------------------------
// LINEAR MODE (unchanged logic)
// ---------------------------------------------------------------------------

async function tickLinear(execution: FlowExecutionRow): Promise<void> {
  const service = createServiceClient()

  const { data: steps } = await service
    .from('flow_steps')
    .select('*')
    .eq('flow_id', execution.flow_id)
    .order('position', { ascending: true })
  const list = (steps ?? []) as FlowStepRow[]

  if (execution.current_step >= list.length) {
    await markCompleted(execution.id)
    return
  }

  const stepRow = list[execution.current_step]
  if (!stepRow) {
    await markCompleted(execution.id)
    return
  }
  const config = parseStep(stepRow)

  switch (config.type) {
    case 'send_template':
      await runSendTemplate(execution, config)
      await advance(execution, 1)
      return
    case 'wait':
      await scheduleWait(execution, config.minutes)
      return
    case 'condition': {
      const branchTrue = await evalCondition(execution, config)
      await advance(execution, branchTrue ? 1 : config.else_offset)
      return
    }
    case 'add_tag':
      await runAddTag(execution, config.tag_id)
      await advance(execution, 1)
      return
  }
}

// ---------------------------------------------------------------------------
// GRAPH MODE
// ---------------------------------------------------------------------------

async function tickGraph(execution: FlowExecutionRow, nodes: FlowNodeRow[]): Promise<void> {
  const service = createServiceClient()

  // Load all edges for this flow.
  const { data: edgesData } = await service
    .from('flow_edges')
    .select('*')
    .eq('flow_id', execution.flow_id)
  const edges = (edgesData ?? []) as FlowEdgeRow[]

  // Resolve current node.
  let currentNodeId = execution.current_node_id

  if (currentNodeId === null) {
    // Find the trigger node and follow its outgoing edge to reach the entry.
    const triggerNode = nodes.find((n) => n.kind === 'trigger')
    if (!triggerNode) {
      await markCompleted(execution.id)
      return
    }
    const entryNodeId = nextNodeId(edges, triggerNode.id, null)
    if (!entryNodeId) {
      await markCompleted(execution.id)
      return
    }
    currentNodeId = entryNodeId
    // Persist current_node_id so we can resume here if we crash mid-tick.
    await service
      .from('flow_executions')
      .update({ current_node_id: currentNodeId })
      .eq('id', execution.id)
  }

  const currentNode = nodes.find((n) => n.id === currentNodeId)
  if (!currentNode) {
    // Node was deleted; treat as completed.
    await markCompleted(execution.id)
    return
  }

  await executeGraphNode(execution, currentNode, nodes, edges)
}

async function executeGraphNode(
  execution: FlowExecutionRow,
  node: FlowNodeRow,
  _nodes: FlowNodeRow[],
  edges: FlowEdgeRow[],
): Promise<void> {
  const service = createServiceClient()

  switch (node.kind) {
    case 'trigger': {
      // Should not normally be the current node, but handle defensively.
      const nextId = nextNodeId(edges, node.id, null)
      if (!nextId) {
        await markCompleted(execution.id)
        return
      }
      await service
        .from('flow_executions')
        .update({ current_node_id: nextId, next_run_at: new Date().toISOString() })
        .eq('id', execution.id)
      return
    }

    case 'send_template': {
      const config = parseNodeConfig(node, 'send_template')
      await runSendTemplate(execution, config)
      const nextId = nextNodeId(edges, node.id, null)
      if (!nextId) {
        await markCompleted(execution.id)
        return
      }
      await service
        .from('flow_executions')
        .update({ current_node_id: nextId, next_run_at: new Date().toISOString() })
        .eq('id', execution.id)
      return
    }

    case 'wait': {
      const config = parseNodeConfig(node, 'wait')
      const nextId = nextNodeId(edges, node.id, null)
      // Wait sin sucesor = fin del flow. Sin esto current_node_id quedaría en
      // null y el próximo tick reiniciaría desde el trigger (loop de reenvío).
      if (!nextId) {
        await markCompleted(execution.id)
        return
      }
      const nextRun = new Date(Date.now() + config.minutes * 60 * 1000).toISOString()
      // Avanzar el puntero al nodo posterior al delay y programar next_run_at.
      await service
        .from('flow_executions')
        .update({ current_node_id: nextId, next_run_at: nextRun })
        .eq('id', execution.id)
      return
    }

    case 'condition': {
      const config = parseNodeConfig(node, 'condition')
      const result = await evalConditionFromConfig(execution, config)
      const branch = pickConditionBranch(result)
      const nextId = nextNodeId(edges, node.id, branch)
      if (!nextId) {
        await markCompleted(execution.id)
        return
      }
      await service
        .from('flow_executions')
        .update({ current_node_id: nextId, next_run_at: new Date().toISOString() })
        .eq('id', execution.id)
      return
    }

    case 'add_tag': {
      const config = parseNodeConfig(node, 'add_tag')
      await runAddTag(execution, config.tag_id)
      const nextId = nextNodeId(edges, node.id, null)
      if (!nextId) {
        await markCompleted(execution.id)
        return
      }
      await service
        .from('flow_executions')
        .update({ current_node_id: nextId, next_run_at: new Date().toISOString() })
        .eq('id', execution.id)
      return
    }

    default:
      // Unknown node kind — skip and complete defensively.
      await markCompleted(execution.id)
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseStep(row: FlowStepRow): FlowStepConfig {
  const candidate = { type: row.type, ...(row.config as Record<string, unknown>) }
  return flowStepConfigSchema.parse(candidate)
}

/**
 * Parse a graph node's config field into a typed FlowStepConfig variant.
 * node.kind maps 1:1 to FlowStepConfig type values.
 */
function parseNodeConfig<K extends FlowStepConfig['type']>(
  node: FlowNodeRow,
  expectedKind: K,
): Extract<FlowStepConfig, { type: K }> {
  const candidate = { type: expectedKind, ...(node.config as Record<string, unknown>) }
  const result = flowStepConfigSchema.parse(candidate)
  return result as Extract<FlowStepConfig, { type: K }>
}

async function runSendTemplate(
  execution: FlowExecutionRow,
  config: Extract<FlowStepConfig, { type: 'send_template' }>,
): Promise<void> {
  const service = createServiceClient()
  const [{ data: customer }, { data: channel }, { data: template }] = await Promise.all([
    service
      .from('customers')
      .select('id, phone, first_name, last_name, opt_in_marketing, is_blocked')
      .eq('id', execution.customer_id)
      .maybeSingle(),
    service.from('channels').select('*').eq('id', config.channel_id).maybeSingle(),
    service
      .from('message_templates')
      .select('name, language, category')
      .eq('id', config.template_id)
      .maybeSingle(),
  ])
  if (!customer || !channel || !template) {
    throw new FatalFlowError('missing customer/channel/template')
  }

  if (customer.is_blocked) {
    // No contactar (hard opt-out): ni siquiera un template transaccional.
    console.warn(`[flows.runSendTemplate] skip: cliente bloqueado (execution=${execution.id})`)
    return
  }

  if (
    !canSendFlowTemplate({
      category: template.category,
      optInMarketing: customer.opt_in_marketing,
    })
  ) {
    // Compliance §8: no mandamos un template MARKETING a quien no dio opt-in.
    // El flow sigue (el caller avanza al próximo nodo); sólo se suprime el envío.
    console.warn(
      `[flows.runSendTemplate] skip marketing sin opt-in (execution=${execution.id}, template=${template.name})`,
    )
    return
  }

  const variables =
    config.variables.length > 0
      ? config.variables.map((tpl) => resolveVariable(tpl, customer))
      : [customer.first_name]

  const { meta_message_id } = await sendTemplate(
    channel as WhatsAppChannelLike,
    customer.phone,
    template.name,
    template.language,
    variables,
  )

  // Insert message para auditar.
  await service.from('messages').insert({
    tenant_id: execution.tenant_id,
    conversation_id: await findOrCreateConversation({
      tenantId: execution.tenant_id,
      channelId: channel.id,
      externalUserId: customer.phone,
      customerId: customer.id,
    }),
    direction: 'outbound',
    content: `[template:${template.name}] ${variables.join(' | ')}`,
    meta_message_id,
    status: 'sent',
    sent_at: new Date().toISOString(),
    flow_execution_id: execution.id,
  })
}

function resolveVariable(
  tpl: string,
  customer: { first_name: string; last_name: string; phone: string },
): string {
  // Resolución simple v1: {{first_name}} | {{last_name}} | {{phone}}; cualquier
  // otra cosa se devuelve verbatim (queda en el template).
  return tpl
    .replace(/\{\{first_name\}\}/g, customer.first_name)
    .replace(/\{\{last_name\}\}/g, customer.last_name)
    .replace(/\{\{phone\}\}/g, customer.phone)
}

async function scheduleWait(execution: FlowExecutionRow, minutes: number): Promise<void> {
  const service = createServiceClient()
  // En wait: avanzamos el step (lo damos por consumido) y dejamos next_run_at en
  // el futuro. El cron volverá a procesar la execution cuando llegue el momento.
  const nextRun = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  await service
    .from('flow_executions')
    .update({ current_step: execution.current_step + 1, next_run_at: nextRun })
    .eq('id', execution.id)
}

async function evalCondition(
  execution: FlowExecutionRow,
  config: Extract<FlowStepConfig, { type: 'condition' }>,
): Promise<boolean> {
  const service = createServiceClient()
  const { data: customer } = await service
    .from('customers')
    .select('opt_in_marketing, total_visits, total_spent_cents, points_balance, last_visit_at')
    .eq('id', execution.customer_id)
    .maybeSingle()
  return evalConditionFromConfig(execution, config, customer)
}

/**
 * Shared condition evaluation that works for both linear and graph mode.
 * Accepts an optional pre-fetched customer row so graph mode can re-use it.
 */
async function evalConditionFromConfig(
  execution: FlowExecutionRow,
  config: Extract<FlowStepConfig, { type: 'condition' }>,
  customer?: Record<string, unknown> | null,
): Promise<boolean> {
  let customerData = customer
  if (customerData === undefined) {
    const service = createServiceClient()
    const { data } = await service
      .from('customers')
      .select('opt_in_marketing, total_visits, total_spent_cents, points_balance, last_visit_at')
      .eq('id', execution.customer_id)
      .maybeSingle()
    customerData = data as Record<string, unknown> | null
  }
  const ctx = (execution.context ?? {}) as Record<string, unknown>
  const [scope, key] = config.field.split('.')
  const lookup =
    scope === 'context'
      ? ctx[key ?? '']
      : scope === 'customer'
        ? (customerData as Record<string, unknown> | null)?.[key ?? '']
        : undefined
  return compare(lookup, config.op, config.value)
}

export function compare(left: unknown, op: string, right: unknown): boolean {
  if (op === 'is_true') return left === true
  if (op === 'is_false') return left === false
  if (op === 'eq') return left === right
  if (op === 'neq') return left !== right
  const a = Number(left)
  const b = Number(right)
  if (op === 'gt') return a > b
  if (op === 'gte') return a >= b
  if (op === 'lt') return a < b
  if (op === 'lte') return a <= b
  return false
}

async function runAddTag(execution: FlowExecutionRow, tagId: string): Promise<void> {
  const service = createServiceClient()
  await service
    .from('customer_tag_assignments')
    .upsert(
      { customer_id: execution.customer_id, tag_id: tagId },
      { onConflict: 'customer_id,tag_id', ignoreDuplicates: true },
    )
}

async function advance(execution: FlowExecutionRow, by: number): Promise<void> {
  const service = createServiceClient()
  await service
    .from('flow_executions')
    .update({
      current_step: execution.current_step + by,
      next_run_at: new Date().toISOString(),
    })
    .eq('id', execution.id)
}

async function markCompleted(executionId: string): Promise<void> {
  const service = createServiceClient()
  await service
    .from('flow_executions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', executionId)
}

export async function markFailed(executionId: string, err: string): Promise<void> {
  const service = createServiceClient()
  await service
    .from('flow_executions')
    .update({ status: 'failed', error: err, completed_at: new Date().toISOString() })
    .eq('id', executionId)
}

// Marker export para que TS no se queje del Json import si fuera unused.
export const _flowsRuntimeMarker: Json = {}
