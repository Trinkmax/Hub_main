import 'server-only'
import { findOrCreateConversation } from '@/lib/meta/conversations'
import { sendTemplate, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'
import { describeFlowAction, logFlowEvent } from './execution-log'
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
  // En modo lineal no hay node_id: el registro se ancla a la posición del paso.
  const ref = { stepPosition: stepRow.position }

  switch (config.type) {
    case 'send_template': {
      const result = await runSendTemplate(execution, config)
      await logSendTemplate(execution, result, ref)
      await advance(execution, 1)
      return
    }
    case 'wait': {
      const nextRun = await scheduleWait(execution, config.minutes)
      await logFlowEvent({
        execution,
        ...ref,
        actionType: 'wait',
        actionLabel: describeFlowAction('wait', config),
        status: 'waiting',
        detail: { wait_minutes: config.minutes, next_run_at: nextRun },
      })
      return
    }
    case 'condition': {
      const branchTrue = await evalCondition(execution, config)
      await logFlowEvent({
        execution,
        ...ref,
        actionType: 'condition',
        actionLabel: describeFlowAction('condition', config),
        status: 'executed',
        detail: { branch: pickConditionBranch(branchTrue), field: config.field, op: config.op },
      })
      await advance(execution, branchTrue ? 1 : config.else_offset)
      return
    }
    case 'add_tag': {
      const { tagName } = await runAddTag(execution, config.tag_id)
      await logFlowEvent({
        execution,
        ...ref,
        actionType: 'add_tag',
        actionLabel: describeFlowAction('add_tag', config, { tagName }),
        status: 'executed',
        detail: { tag_id: config.tag_id, tag_name: tagName },
      })
      await advance(execution, 1)
      return
    }
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
      const result = await runSendTemplate(execution, config)
      await logSendTemplate(execution, result, { nodeId: node.id })
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
      // La fila "Esperando" del registro: el cliente quedó frenado acá hasta nextRun.
      await logFlowEvent({
        execution,
        nodeId: node.id,
        actionType: 'wait',
        actionLabel: describeFlowAction('wait', config),
        status: 'waiting',
        detail: { wait_minutes: config.minutes, next_run_at: nextRun },
      })
      return
    }

    case 'condition': {
      const config = parseNodeConfig(node, 'condition')
      const result = await evalConditionFromConfig(execution, config)
      const branch = pickConditionBranch(result)
      await logFlowEvent({
        execution,
        nodeId: node.id,
        actionType: 'condition',
        actionLabel: describeFlowAction('condition', config),
        status: 'executed',
        detail: { branch, field: config.field, op: config.op },
      })
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
      const { tagName } = await runAddTag(execution, config.tag_id)
      await logFlowEvent({
        execution,
        nodeId: node.id,
        actionType: 'add_tag',
        actionLabel: describeFlowAction('add_tag', config, { tagName }),
        status: 'executed',
        detail: { tag_id: config.tag_id, tag_name: tagName },
      })
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

/**
 * Resultado del envío para que el caller lo registre. Devolvemos el motivo del
 * salto (en vez de sólo loguear en consola) porque "¿por qué a este cliente no
 * le llegó?" es la pregunta que el dueño hace mirando la pantalla de registros.
 */
type SendTemplateResult = {
  status: 'executed' | 'skipped'
  reason?: 'blocked' | 'no_opt_in'
  templateId: string
  templateName: string | null
  channelType: string | null
}

async function runSendTemplate(
  execution: FlowExecutionRow,
  config: Extract<FlowStepConfig, { type: 'send_template' }>,
): Promise<SendTemplateResult> {
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

  const ref = {
    templateId: config.template_id,
    templateName: template.name,
    channelType: channel.type,
  }

  if (customer.is_blocked) {
    // No contactar (hard opt-out): ni siquiera un template transaccional.
    console.warn(`[flows.runSendTemplate] skip: cliente bloqueado (execution=${execution.id})`)
    return { status: 'skipped', reason: 'blocked', ...ref }
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
    return { status: 'skipped', reason: 'no_opt_in', ...ref }
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

  return { status: 'executed', ...ref }
}

// Motivos de salto en clave estable; la UI los traduce (nunca guardamos el
// texto visible en la DB para poder reescribirlo sin migrar filas viejas).
async function logSendTemplate(
  execution: FlowExecutionRow,
  result: SendTemplateResult,
  ref: { nodeId?: string | null; stepPosition?: number | null },
): Promise<void> {
  const detail: Record<string, Json> = {
    template_id: result.templateId,
    template_name: result.templateName,
    channel_type: result.channelType,
  }
  if (result.reason) detail.skip_reason = result.reason
  await logFlowEvent({
    execution,
    ...ref,
    actionType: 'send_template',
    actionLabel: describeFlowAction('send_template', null, {
      templateName: result.templateName,
      channelType: result.channelType,
    }),
    status: result.status,
    detail,
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

async function scheduleWait(execution: FlowExecutionRow, minutes: number): Promise<string> {
  const service = createServiceClient()
  // En wait: avanzamos el step (lo damos por consumido) y dejamos next_run_at en
  // el futuro. El cron volverá a procesar la execution cuando llegue el momento.
  const nextRun = new Date(Date.now() + minutes * 60 * 1000).toISOString()
  await service
    .from('flow_executions')
    .update({ current_step: execution.current_step + 1, next_run_at: nextRun })
    .eq('id', execution.id)
  return nextRun
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

async function runAddTag(
  execution: FlowExecutionRow,
  tagId: string,
): Promise<{ tagName: string | null }> {
  const service = createServiceClient()
  // El nombre se lee en paralelo sólo para el registro: en la grilla el dueño
  // tiene que ver "Etiquetar: VIP", no un uuid.
  const [, tagRes] = await Promise.all([
    service
      .from('customer_tag_assignments')
      .upsert(
        { customer_id: execution.customer_id, tag_id: tagId },
        { onConflict: 'customer_id,tag_id', ignoreDuplicates: true },
      ),
    service.from('customer_tags').select('name').eq('id', tagId).maybeSingle(),
  ])
  return { tagName: tagRes.data?.name ?? null }
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
  // El filtro por 'running' hace el cierre idempotente: si otra pasada ya la
  // completó, no vuelve fila y no duplicamos el evento de cierre.
  const { data } = await service
    .from('flow_executions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', executionId)
    .eq('status', 'running')
    .select('id, tenant_id, flow_id, customer_id')
    .maybeSingle()
  if (!data) return
  await logFlowEvent({
    execution: data,
    actionType: 'completed',
    actionLabel: describeFlowAction('completed'),
    status: 'executed',
  })
}

export async function markFailed(executionId: string, err: string): Promise<void> {
  const service = createServiceClient()
  const { data } = await service
    .from('flow_executions')
    .update({ status: 'failed', error: err, completed_at: new Date().toISOString() })
    .eq('id', executionId)
    .select('id, tenant_id, flow_id, customer_id')
    .maybeSingle()
  if (!data) return
  await logFlowEvent({
    execution: data,
    actionType: 'failed',
    actionLabel: describeFlowAction('failed'),
    status: 'error',
    error: err,
  })
}

// Marker export para que TS no se queje del Json import si fuera unused.
export const _flowsRuntimeMarker: Json = {}
