import {
  conditionSummary,
  KIND_LABEL,
  type StepKind,
  TRIGGER_TYPE_LABEL,
  triggerSummary,
  waitSummary,
} from '@/app/(manager)/[tenantSlug]/mensajeria/flows/_components/step-meta'
import type { FlowEventStatus } from '@/lib/flows/execution-log-labels'
import {
  STATUS_META as EVENT_STATUS_META,
  SKIP_REASON_LABEL,
} from '@/lib/flows/execution-log-labels'
import type { FlowLogRow } from '@/lib/flows/execution-log-queries'
import {
  flowStepConfigSchema,
  flowTriggerConfigSchema,
  saveFlowGraphPayloadSchema,
  validateFlowGraph,
} from '@/lib/flows/graph-schemas'
import type { FlowDetail, FlowListRow } from '@/lib/flows/queries'
import type { FlowStepConfig, FlowTriggerConfig } from '@/lib/flows/schemas'
import type { FlowTriggerType } from '@/types/database'
import { capped, type TexTicketDraft } from '../types'
import { dateTimeText, noZeros, peopleText, safeText } from './_common'
import { templateTitle } from './_template-values'

/**
 * Las automatizaciones, puras. Prender una es lo más delicado del área: desde ese momento le manda
 * mensajes a los clientes sola. Antes de prenderla se le aplican las reglas del editor, y el tique dice
 * lo que hace el motor de verdad.
 */

const RECENT_EVENTS_MAX = 10
const ROWS_MAX = 30

export type FlowGraphRows = {
  nodes: ReadonlyArray<{ id: string; kind: string; position: unknown; config: unknown }>
  edges: ReadonlyArray<{
    id: string
    source_node_id: string
    target_node_id: string
    source_handle: string | null
  }>
}

function positionOf(raw: unknown): { x: number; y: number } {
  const position = raw && typeof raw === 'object' ? (raw as { x?: unknown; y?: unknown }) : {}
  return { x: Number(position.x ?? 0), y: Number(position.y ?? 0) }
}

function configOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/** Los pasos que el motor va a recorrer, en orden, desde el disparador. El disparador no cuenta. */
export function reachableSteps(graph: FlowGraphRows): FlowGraphRows['nodes'] {
  const trigger = graph.nodes.find((node) => node.kind === 'trigger')
  if (!trigger) return []
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const seen = new Set<string>([trigger.id])
  const order: Array<FlowGraphRows['nodes'][number]> = []
  const queue = [trigger.id]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of graph.edges) {
      if (edge.source_node_id !== current || seen.has(edge.target_node_id)) continue
      seen.add(edge.target_node_id)
      queue.push(edge.target_node_id)
      const node = byId.get(edge.target_node_id)
      if (node) order.push(node)
    }
  }
  return order
}

export type FlowSteps = Array<{ kind: string; config: Record<string, unknown> }>

/** Los pasos de los dos formatos: el grafo de ahora y la lista de las automatizaciones viejas. */
export function flowSteps(graph: FlowGraphRows, legacy: FlowDetail['steps']): FlowSteps {
  if (graph.nodes.length > 0) {
    return reachableSteps(graph).map((node) => ({
      kind: node.kind,
      config: configOf(node.config),
    }))
  }
  return legacy.map((step) => ({ kind: step.type, config: configOf(step.config) }))
}

/** Las plantillas que manda. */
export function flowTemplateIds(steps: FlowSteps): string[] {
  const ids = steps
    .filter((step) => step.kind === 'send_template')
    .map((step) => step.config.template_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return [...new Set(ids)]
}

/** Lo que el editor no dejaría guardar y lo que el motor no podría correr. `null`: se puede prender. */
export function flowStructureProblem(
  flow: Pick<FlowDetail, 'id' | 'name' | 'trigger_config'>,
  graph: FlowGraphRows,
  legacy: FlowDetail['steps'],
): string | null {
  const editor = 'Se completa en el editor (ir_a a mensajeria.flow).'
  if (graph.nodes.length > 0) {
    const payload = saveFlowGraphPayloadSchema.safeParse({
      id: flow.id,
      name: flow.name,
      active: true,
      trigger: flow.trigger_config,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        position: positionOf(node.position),
        config: configOf(node.config),
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        sourceHandle: edge.source_handle,
      })),
    })
    if (!payload.success) return `«${flow.name}» está incompleta. ${editor}`
    const structure = validateFlowGraph(payload.data)
    if (structure) return `${structure} ${editor}`
  } else if (!flowTriggerConfigSchema.safeParse(flow.trigger_config).success) {
    return `A «${flow.name}» le falta el disparador. ${editor}`
  }
  const steps = flowSteps(graph, legacy)
  if (steps.length === 0) return `«${flow.name}» todavía no tiene pasos: no haría nada. ${editor}`
  for (const step of steps) {
    const parsed = flowStepConfigSchema.safeParse({ ...step.config, type: step.kind })
    if (!parsed.success) {
      const word = KIND_LABEL[step.kind as StepKind] ?? step.kind
      return `En «${flow.name}» el paso «${word}» está incompleto. ${editor}`
    }
  }
  return null
}

function triggerOf(raw: unknown): FlowTriggerConfig | null {
  const parsed = flowTriggerConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function triggerText(type: FlowTriggerType, raw: unknown): string {
  const trigger = triggerOf(raw)
  return trigger ? triggerSummary(trigger) : TRIGGER_TYPE_LABEL[type]
}

/** Lo que hace el motor con cada disparador (`lib/flows/triggers.ts` y las funciones de la base). */
export function triggerWarnings(type: FlowTriggerType, raw: unknown) {
  const trigger = triggerOf(raw)
  const warning = (key: string, title: string) => ({ key, title, body: null })
  switch (type) {
    case 'customer_inactive': {
      const days = trigger?.type === 'customer_inactive' ? trigger.days : null
      return [
        warning(
          'enrols_now',
          `En los próximos 15 minutos entran todos los que ${days ? `hace más de ${days} días` : 'hace tiempo'} que no vienen y aceptan promos.`,
        ),
        warning(
          'enrols_once',
          'A cada uno le llega una vez cada vez que deja de venir: si vuelve y después vuelve a faltar, le llega de nuevo.',
        ),
      ]
    }
    case 'birthday':
      return [
        warning(
          'enrols_now',
          'Cada 15 minutos entran los que tocan ese día y aceptan promos, también hoy.',
        ),
        warning('enrols_once', 'A cada uno le llega una vez por cumpleaños.'),
      ]
    case 'event_starting':
      return [
        warning(
          'enrols_now',
          'Antes de cada evento, cuando se cumple el plazo, entran los que tienen una reserva a su nombre.',
        ),
        warning('enrols_once', 'A cada uno le llega una vez por evento.'),
      ]
    case 'after_visit':
      return [
        warning(
          'enrols_on_visit',
          'Entra cada cliente al que se le registra una visita, cada vez.',
        ),
      ]
    case 'tag_added':
      return [warning('enrols_on_tag', 'Entra cada cliente al que se le pone la etiqueta.')]
  }
}

function stepWords(
  step: FlowSteps[number],
  names: { templates: ReadonlyMap<string, string>; tags: ReadonlyMap<string, string> },
): string {
  const parsed = flowStepConfigSchema.safeParse({ ...step.config, type: step.kind })
  if (!parsed.success) return `${KIND_LABEL[step.kind as StepKind] ?? step.kind}: incompleto`
  const config: FlowStepConfig = parsed.data
  switch (config.type) {
    case 'send_template':
      return `Manda la plantilla ${names.templates.get(config.template_id) ?? 'que ya no está'}`
    case 'wait':
      return `Espera ${waitSummary(config.minutes)}`
    case 'condition':
      return `Si ${conditionSummary(config.field, config.op, config.value)}`
    case 'add_tag':
      return `Le pone la etiqueta ${names.tags.get(config.tag_id) ?? 'que ya no está'}`
  }
}

export function flowStepTexts(
  steps: FlowSteps,
  names: { templates: ReadonlyMap<string, string>; tags: ReadonlyMap<string, string> },
): string[] {
  return steps.map((step) => stepWords(step, names))
}

export function flowActivationTicket(input: {
  name: string
  type: FlowTriggerType
  trigger: unknown
  stepTexts: readonly string[]
  enteringNow: number | null
}): TexTicketDraft {
  return {
    kind: 'flow',
    title: 'Prender una automatización',
    subtitle: input.name,
    rows: [
      { label: 'Se activa', value: triggerText(input.type, input.trigger) },
      { label: 'Qué hace', value: input.stepTexts.join(' · ') },
      ...(input.enteringNow !== null
        ? [{ label: 'Entrarían ahora', value: `Cerca de ${peopleText(input.enteringNow)}` }]
        : []),
    ],
    total: null,
    entry: [],
    warnings: [
      {
        key: 'sends_alone',
        title:
          'Desde que se prende, les manda mensajes a los clientes sola. Lo que salió no se puede deshacer.',
        body: null,
      },
      ...triggerWarnings(input.type, input.trigger),
    ],
    confirmLabel: 'Prender la automatización',
  }
}

export function flowPauseTicket(input: { name: string; running: number }): TexTicketDraft {
  return {
    kind: 'flow',
    title: 'Apagar una automatización',
    subtitle: input.name,
    rows: [{ label: 'Adentro ahora', value: peopleText(input.running) }],
    total: null,
    entry: [],
    warnings: [
      ...(input.running > 0
        ? [
            {
              key: 'running_continue',
              title:
                'No entra nadie nuevo, pero los que ya están adentro siguen hasta el final: si tenían un mensaje por salir, les llega igual.',
              body: null,
            },
          ]
        : []),
    ],
    confirmLabel: 'Apagar la automatización',
  }
}

// ─── Lo que lee Tex ──────────────────────────────────────────────────────────

export type FlowEventLite = { flow_id: string; action_type: string; status: string }

export type FlowNumbers = {
  entraron: number
  mensajes_enviados: number
  mensajes_salteados: number
  errores: number
}

const emptyNumbers = (): FlowNumbers => ({
  entraron: 0,
  mensajes_enviados: 0,
  mensajes_salteados: 0,
  errores: 0,
})

/** Lo que pasó en cada automatización, a partir de sus registros. */
export function flowNumbersOf(events: readonly FlowEventLite[]): Map<string, FlowNumbers> {
  const out = new Map<string, FlowNumbers>()
  for (const event of events) {
    const numbers = out.get(event.flow_id) ?? emptyNumbers()
    if (event.action_type === 'enrolled') numbers.entraron += 1
    if (event.action_type === 'send_template' && event.status === 'executed') {
      numbers.mensajes_enviados += 1
    }
    if (event.action_type === 'send_template' && event.status === 'skipped') {
      numbers.mensajes_salteados += 1
    }
    if (event.status === 'error') numbers.errores += 1
    out.set(event.flow_id, numbers)
  }
  return out
}

export function flowRow(
  flow: FlowListRow,
  extra: { steps: number; running: number; numbers: FlowNumbers | undefined },
) {
  const numbers = extra.numbers ?? emptyNumbers()
  return {
    id: flow.id,
    nombre: flow.name,
    estado: flow.active ? 'Prendida' : 'En pausa',
    se_activa: TRIGGER_TYPE_LABEL[flow.trigger_type],
    pasos: extra.steps,
    ...(extra.running > 0 ? { adentro_ahora: extra.running } : {}),
    ...noZeros(numbers),
  }
}

/** Los números salen de leer los registros: si son demasiados, se dice que son parciales. */
const PARTIAL_NUMBERS =
  'Son más registros de los que se pueden leer de una vez: estos números cuentan solo los últimos. Los exactos están en sus Registros.'

export function flowsData(rows: ReadonlyArray<ReturnType<typeof flowRow>>, cut = false) {
  const { filas, hay_mas } = capped(rows, ROWS_MAX)
  return {
    cuantas: rows.length,
    prendidas: rows.filter((row) => row.estado === 'Prendida').length,
    numeros_de: 'los últimos 30 días',
    ...(cut ? { numeros_parciales: PARTIAL_NUMBERS } : {}),
    filas,
    hay_mas,
  }
}

function eventRow(event: FlowLogRow) {
  const reason = (event.detail as { skip_reason?: unknown } | null)?.skip_reason
  const motive = typeof reason === 'string' ? SKIP_REASON_LABEL[reason] : undefined
  const name = event.customer
    ? `${event.customer.first_name} ${event.customer.last_name}`.trim()
    : ''
  return {
    cuando: dateTimeText(event.occurred_at),
    que: safeText(event.action_label, 120),
    resultado: EVENT_STATUS_META[event.status as FlowEventStatus]?.label ?? event.status,
    ...(name ? { cliente: safeText(name, 60) } : {}),
    ...(motive ? { motivo: motive } : {}),
  }
}

export function flowData(input: {
  flow: Pick<FlowDetail, 'id' | 'name' | 'active' | 'trigger_type' | 'trigger_config'>
  steps: FlowSteps
  names: { templates: ReadonlyMap<string, string>; tags: ReadonlyMap<string, string> }
  running: number
  numbers: FlowNumbers | undefined
  numbersCut: boolean
  events: readonly FlowLogRow[]
  eventsTotal: number
}) {
  const { filas } = capped(input.events.map(eventRow), RECENT_EVENTS_MAX)
  return {
    id: input.flow.id,
    nombre: input.flow.name,
    estado: input.flow.active ? 'Prendida' : 'En pausa',
    se_activa: triggerText(input.flow.trigger_type, input.flow.trigger_config),
    pasos: flowStepTexts(input.steps, input.names),
    ...(input.running > 0 ? { adentro_ahora: input.running } : {}),
    ultimos_30_dias: noZeros(input.numbers ?? emptyNumbers()),
    ...(input.numbersCut ? { numeros_parciales: PARTIAL_NUMBERS } : {}),
    registros_en_30_dias: input.eventsTotal,
    ultimos_registros: filas,
  }
}

export function templateNames(
  templates: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string> {
  return new Map(templates.map((template) => [template.id, templateTitle(template)]))
}
