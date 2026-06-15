import 'server-only'
import { findOrCreateConversation } from '@/lib/meta/conversations'
import { sendTemplate, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/types/database'
import { type FlowStepConfig, flowStepConfigSchema } from './schemas'

type FlowExecutionRow = Database['public']['Tables']['flow_executions']['Row']
type FlowStepRow = Database['public']['Tables']['flow_steps']['Row']

export class RecoverableFlowError extends Error {
  readonly recoverable = true
}

export class FatalFlowError extends Error {
  readonly recoverable = false
}

// Procesa el step actual de una execution. Avanza, programa wait, o termina.
export async function tickFlowExecution(executionId: string): Promise<void> {
  const service = createServiceClient()
  const { data: execution } = await service
    .from('flow_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle()
  if (!execution) throw new FatalFlowError(`execution ${executionId} not found`)
  if (execution.status !== 'running') return // ya completed/failed/cancelled

  const { data: steps } = await service
    .from('flow_steps')
    .select('*')
    .eq('flow_id', execution.flow_id)
    .order('position', { ascending: true })
  const list = (steps ?? []) as FlowStepRow[]

  if (execution.current_step >= list.length) {
    await markCompleted(executionId)
    return
  }

  const stepRow = list[execution.current_step]
  if (!stepRow) {
    await markCompleted(executionId)
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

function parseStep(row: FlowStepRow): FlowStepConfig {
  const candidate = { type: row.type, ...(row.config as Record<string, unknown>) }
  return flowStepConfigSchema.parse(candidate)
}

async function runSendTemplate(
  execution: FlowExecutionRow,
  config: Extract<FlowStepConfig, { type: 'send_template' }>,
): Promise<void> {
  const service = createServiceClient()
  const [{ data: customer }, { data: channel }, { data: template }] = await Promise.all([
    service
      .from('customers')
      .select('id, phone, first_name, last_name')
      .eq('id', execution.customer_id)
      .maybeSingle(),
    service.from('channels').select('*').eq('id', config.channel_id).maybeSingle(),
    service
      .from('message_templates')
      .select('name, language')
      .eq('id', config.template_id)
      .maybeSingle(),
  ])
  if (!customer || !channel || !template) {
    throw new FatalFlowError('missing customer/channel/template')
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
  const ctx = (execution.context ?? {}) as Record<string, unknown>
  const [scope, key] = config.field.split('.')
  const lookup =
    scope === 'context'
      ? ctx[key ?? '']
      : scope === 'customer'
        ? (customer as unknown as Record<string, unknown> | null)?.[key ?? '']
        : undefined
  return compare(lookup, config.op, config.value)
}

function compare(left: unknown, op: string, right: unknown): boolean {
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
