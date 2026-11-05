import 'server-only'

import { z } from 'zod'
import { previewAudience } from '@/lib/audiences/actions'
import type { AudienceFilter } from '@/lib/audiences/schemas'
import { toggleFlowActive } from '@/lib/flows/actions'
import { flowLogFiltersSchema, resolveLogRange } from '@/lib/flows/execution-log-filters'
import { listFlowExecutionEvents } from '@/lib/flows/execution-log-queries'
import { type FlowDetail, getFlow, listFlows } from '@/lib/flows/queries'
import { flowTriggerConfigSchema } from '@/lib/flows/schemas'
import { createClient } from '@/lib/supabase/server'
import type { FlowTriggerType } from '@/types/database'
import { simpleExecutor } from '../../simple-action'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { defineTool, type TexExecutor, type TexToolContext } from '../types'
import { actionState, fail, formDataOf, OWNER_ROLES, placeOf } from './_common'
import {
  type FlowEventLite,
  type FlowGraphRows,
  flowActivationTicket,
  flowData,
  flowNumbersOf,
  flowPauseTicket,
  flowRepeatsProblem,
  flowRow,
  flowSteps,
  flowStepTexts,
  flowStructureProblem,
  flowsData,
  flowTemplateIds,
  templateNames,
} from './_flow-values'
import { API_ROWS_CAP, channelOf, listTemplates } from './_lookups'
import { channelProblem, templateUseProblem } from './_template-values'

/** Las automatizaciones: mirarlas, explicarlas, prenderlas y apagarlas. Armarlas es en el editor. */

const flowPayload = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
})

/**
 * El grafo con la sesión de la persona. No es `getFlowGraph`, que lee con el cliente de servicio; quien
 * llama ya verificó que la automatización es de este bar y la RLS lo vuelve a mirar.
 */
async function readGraph(flowId: string): Promise<FlowGraphRows> {
  const supabase = await createClient()
  const [nodes, edges] = await Promise.all([
    supabase
      .from('flow_nodes')
      .select('id, kind, position, config')
      .eq('flow_id', flowId)
      .order('created_at', { ascending: true }),
    supabase
      .from('flow_edges')
      .select('id, source_node_id, target_node_id, source_handle')
      .eq('flow_id', flowId),
  ])
  if (nodes.error || edges.error) throw new Error('tex.mensajeria.readGraph')
  return {
    nodes: (nodes.data ?? []) as FlowGraphRows['nodes'],
    edges: (edges.data ?? []) as FlowGraphRows['edges'],
  }
}

/** Quiénes están adentro de cada automatización, para la lista. */
async function readRunning(
  ctx: TexToolContext,
): Promise<{ byFlow: Map<string, number>; cut: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('flow_executions')
    .select('flow_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'running')
    .limit(API_ROWS_CAP)
  if (error) throw new Error('tex.mensajeria.readRunning')
  const rows = (data ?? []) as Array<{ flow_id: string }>
  const byFlow = new Map<string, number>()
  for (const row of rows) byFlow.set(row.flow_id, (byFlow.get(row.flow_id) ?? 0) + 1)
  return { byFlow, cut: rows.length >= API_ROWS_CAP }
}

/** Los que están adentro de una: el número exacto, para el tique y para explicarla. */
async function countRunning(ctx: TexToolContext, flowId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('flow_executions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('flow_id', flowId)
    .eq('status', 'running')
  if (error) throw new Error('tex.mensajeria.countRunning')
  return count ?? 0
}

/** Lo que pasó en los últimos 30 días: la misma ventana que abre «Registros». */
async function readEvents(
  ctx: TexToolContext,
  flowId?: string,
): Promise<{ events: FlowEventLite[]; cut: boolean }> {
  const supabase = await createClient()
  const { fromIso } = resolveLogRange({})
  let query = supabase
    .from('flow_execution_events')
    .select('flow_id, action_type, status')
    .eq('tenant_id', ctx.tenantId)
    .gte('occurred_at', fromIso)
    .in('action_type', ['enrolled', 'send_template', 'failed'])
  if (flowId) query = query.eq('flow_id', flowId)
  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(API_ROWS_CAP)
  if (error) throw new Error('tex.mensajeria.readEvents')
  const events = (data ?? []) as FlowEventLite[]
  return { events, cut: events.length >= API_ROWS_CAP }
}

async function readTags(ctx: TexToolContext): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customer_tags')
    .select('id, name')
    .eq('tenant_id', ctx.tenantId)
  if (error) throw new Error('tex.mensajeria.readTags')
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]))
}

/** Lo que tiene que estar bien para prenderla: el editor, la plantilla aprobada y el canal conectado. */
async function activationProblem(
  ctx: TexToolContext,
  flow: FlowDetail,
  graph: FlowGraphRows,
): Promise<string | null> {
  const structure = flowStructureProblem(flow, graph, flow.steps)
  if (structure) return structure
  const templates = await listTemplates(ctx)
  for (const id of flowTemplateIds(flowSteps(graph, flow.steps))) {
    const template = templates.find((row) => row.id === id)
    if (!template)
      return `«${flow.name}» manda una plantilla que ya no está: se cambia en el editor.`
    const problem =
      templateUseProblem(template) ??
      channelProblem(await channelOf(ctx, template.channel_id), 'whatsapp')
    if (problem) return `«${flow.name}»: ${problem}`
  }
  return flowRepeatsProblem(flow.name, flow.trigger_type)
}

/**
 * Cuántos entrarían apenas se prenda una de «hace tiempo que no viene»: los que cumplen y aceptan promos,
 * contados como una audiencia. Es para que la persona vea el tamaño: las otras dependen del día.
 */
async function enteringNow(
  ctx: TexToolContext,
  type: FlowTriggerType,
  rawTrigger: unknown,
): Promise<number | null> {
  if (type !== 'customer_inactive') return null
  const trigger = flowTriggerConfigSchema.safeParse(rawTrigger)
  if (!trigger.success || trigger.data.type !== 'customer_inactive') return null
  const filter: AudienceFilter = {
    kind: 'group',
    op: 'AND',
    nodes: [
      {
        kind: 'condition',
        field: 'days_since_last_visit',
        op: 'gte',
        value: trigger.data.days,
      },
      { kind: 'condition', field: 'opt_in_marketing', op: 'is_true', value: null },
    ],
  }
  const preview = await previewAudience(ctx.slug, filter)
  return preview.ok ? preview.total : null
}

export const flowsTools = [
  defineTool({
    name: 'ver_flows',
    description:
      'Las automatizaciones o flows (mensajes que salen solos: cumpleaños, clientes que no vienen): si están prendidas, qué las dispara y sus números de los últimos 30 días.',
    input: z.object({}),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando las automatizaciones',
    done: () => 'Miré las automatizaciones',
    run: async (_input, ctx) => {
      const flows = await listFlows(ctx.tenantId)
      const ids = flows.map((flow) => flow.id)
      const supabase = await createClient()
      const [running, events, nodes] = await Promise.all([
        readRunning(ctx),
        readEvents(ctx),
        // `step_count` solo cuenta las viejas: las de ahora guardan sus pasos como nodos.
        ids.length > 0
          ? supabase.from('flow_nodes').select('flow_id, kind').in('flow_id', ids)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (nodes.error) throw new Error('tex.mensajeria.flowNodes')
      const stepsByFlow = new Map<string, number>()
      for (const node of (nodes.data ?? []) as Array<{ flow_id: string; kind: string }>) {
        if (node.kind === 'trigger') continue
        stepsByFlow.set(node.flow_id, (stepsByFlow.get(node.flow_id) ?? 0) + 1)
      }
      const numbers = flowNumbersOf(events.events)
      return {
        kind: 'data',
        data: flowsData(
          flows.map((flow) =>
            flowRow(flow, {
              steps: stepsByFlow.get(flow.id) ?? flow.step_count,
              running: running.byFlow.get(flow.id) ?? 0,
              numbers: numbers.get(flow.id),
            }),
          ),
          events.cut || running.cut,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_flow',
    description:
      'Una automatización o flow: qué la dispara, sus pasos en orden, sus números de los últimos 30 días y qué hizo últimamente. Usala para explicar cómo funciona o a quién le mandó.',
    input: z.object({
      flow: z.string().min(1).max(80).describe('Su nombre o id.'),
    }),
    need: { roles: OWNER_ROLES },
    doing: () => 'Mirando la automatización',
    done: () => 'Miré la automatización',
    run: async (input, ctx) => {
      const flows = await listFlows(ctx.tenantId)
      const match = matchByName(flows, input.flow)
      if (!match.ok) return fail(noMatchText(match, input.flow))
      const flow = await getFlow(ctx.tenantId, match.value.id)
      if (!flow) return fail('Esa automatización no está.')
      const [graph, running, events, templates, tags, log] = await Promise.all([
        readGraph(flow.id),
        countRunning(ctx, flow.id),
        readEvents(ctx, flow.id),
        listTemplates(ctx),
        readTags(ctx),
        listFlowExecutionEvents({
          tenantId: ctx.tenantId,
          flowId: flow.id,
          filters: flowLogFiltersSchema.parse({}),
        }),
      ])
      return {
        kind: 'data',
        data: flowData({
          flow,
          steps: flowSteps(graph, flow.steps),
          names: { templates: templateNames(templates), tags },
          running,
          numbers: flowNumbersOf(events.events).get(flow.id),
          numbersCut: events.cut,
          events: log.rows,
          eventsTotal: log.total,
        }),
      }
    },
  }),

  defineTool({
    name: 'preparar_prender_o_apagar_flow',
    description:
      'Prepara prender o apagar una automatización o flow. Armarla o cambiarle los pasos se hace en su editor. No guarda nada ni manda nada: muestra un tique para confirmar.',
    input: z.object({
      flow: z.string().min(1).max(80).describe('Su nombre o id.'),
      accion: z.enum(['prender', 'apagar']),
    }),
    need: { roles: OWNER_ROLES },
    mood: 'working',
    doing: (input) =>
      input.accion === 'apagar' ? 'Preparando el apagado' : 'Preparando el prendido',
    done: (input) => (input.accion === 'apagar' ? 'Preparé el apagado' : 'Preparé el prendido'),
    run: async (input, ctx) => {
      const flows = await listFlows(ctx.tenantId)
      const match = matchByName(flows, input.flow)
      if (!match.ok) return fail(noMatchText(match, input.flow))
      const flow = await getFlow(ctx.tenantId, match.value.id)
      if (!flow) return fail('Esa automatización no está.')
      const active = input.accion === 'prender'
      if (flow.active === active) {
        return fail(`«${flow.name}» ya está ${active ? 'prendida' : 'apagada'}.`)
      }
      const payload = { id: flow.id, name: flow.name, active }

      if (!active) {
        return {
          kind: 'prepared',
          prepared: {
            executor: 'mensajeria.flow',
            payload,
            ticket: flowPauseTicket({ name: flow.name, running: await countRunning(ctx, flow.id) }),
          },
        }
      }

      const graph = await readGraph(flow.id)
      const problem = await activationProblem(ctx, flow, graph)
      if (problem) return fail(problem)
      const [templates, tags, entering] = await Promise.all([
        listTemplates(ctx),
        readTags(ctx),
        enteringNow(ctx, flow.trigger_type, flow.trigger_config),
      ])
      return {
        kind: 'prepared',
        prepared: {
          executor: 'mensajeria.flow',
          payload,
          ticket: flowActivationTicket({
            name: flow.name,
            type: flow.trigger_type,
            trigger: flow.trigger_config,
            stepTexts: flowStepTexts(flowSteps(graph, flow.steps), {
              templates: templateNames(templates),
              tags,
            }),
            enteringNow: entering,
          }),
        },
      }
    },
  }),
]

export const flowsExecutors: Readonly<Record<string, TexExecutor>> = {
  'mensajeria.flow': simpleExecutor(
    flowPayload,
    async (payload, ctx) => {
      if (payload.active) {
        // Pudieron tocarla en el editor mientras el tique esperaba.
        const flow = await getFlow(ctx.tenantId, payload.id)
        if (!flow) return { ok: false, code: 'error', message: 'Esa automatización ya no está.' }
        const problem = await activationProblem(ctx, flow, await readGraph(flow.id))
        if (problem) return { ok: false, code: 'error', message: problem }
      }
      const state = await toggleFlowActive(
        ctx.slug,
        { ok: true },
        formDataOf({ id: payload.id, active: payload.active ? 'true' : 'false' }),
      )
      return actionState(
        state,
        payload.active ? `Prendí «${payload.name}».` : `Apagué «${payload.name}».`,
        undefined,
      )
    },
    (_data, payload, ctx) => placeOf(ctx, 'mensajeria.flows', {}, payload.name),
  ),
}
