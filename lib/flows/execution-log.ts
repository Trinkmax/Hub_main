import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import {
  CHANNEL_LABEL,
  type FlowActionType,
  type FlowEventStatus,
  formatWaitLabel,
} from './execution-log-labels'

// Historial paso a paso de las automatizaciones (tabla flow_execution_events).
// Lo escribe SOLO el runtime con service_role y lo lee el dueño en la pestaña
// "Registros de ejecución" de cada flow.
//
// REGLA DE ORO: este módulo nunca puede voltear un flow. Si el insert falla, el
// mensaje ya se mandó igual — perder una fila de log es infinitamente más barato
// que reintentar un envío. Por eso todo va envuelto en try/catch y sólo emite
// console.error SIN PII (CLAUDE.md §9): ids sí, teléfonos y nombres nunca.

export type { FlowActionType, FlowEventStatus }

/**
 * Datos que sólo el runtime puede resolver (viven en otras tablas) y que el
 * label necesita para leerse en castellano en vez de mostrar uuids.
 */
export type FlowActionLookups = {
  templateName?: string | null
  tagName?: string | null
  channelType?: string | null
}

// ---------------------------------------------------------------------------
// Derivación del label — pura, exportada para testear
// ---------------------------------------------------------------------------

// Espejo de CONDITION_FIELDS / OP_LABEL en flows/_components/step-meta.ts. No se
// importan de ahí porque ese módulo es de cliente (arrastra lucide-react) y esto
// corre en el cron; mantenerlos en sync si se agrega un campo nuevo al editor.
const CONDITION_FIELD_LABEL: Record<string, string> = {
  'customer.opt_in_marketing': 'Acepta recibir promos',
  'customer.total_visits': 'Cantidad de visitas',
  'customer.points_balance': 'Puntos que tiene',
  'customer.total_spent_cents': 'Plata gastada en total',
}

const CONDITION_OP_LABEL: Record<string, string> = {
  eq: 'es exactamente',
  neq: 'es distinto de',
  gt: 'es más de',
  gte: 'es como mínimo',
  lt: 'es menos de',
  lte: 'es como máximo',
}

const arsFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

function asRecord(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {}
}

function describeCondition(config: Record<string, unknown>): string {
  const field = typeof config.field === 'string' ? config.field : ''
  if (!field) return 'Condición'
  const label = CONDITION_FIELD_LABEL[field] ?? field
  const op = typeof config.op === 'string' ? config.op : ''
  if (op === 'is_true') return `¿${label}: Sí?`
  if (op === 'is_false') return `¿${label}: No?`
  const opLabel = CONDITION_OP_LABEL[op]
  if (!opLabel) return `¿${label}?`
  const raw = config.value
  const num = Number(raw)
  const shown =
    field === 'customer.total_spent_cents' && Number.isFinite(num)
      ? arsFormatter.format(num / 100)
      : raw === undefined || raw === null || raw === ''
        ? '…'
        : String(raw)
  return `¿${label} ${opLabel} ${shown}?`
}

/**
 * Qué se lee en la columna "Acción" del registro. Se congela en la fila al
 * momento de ejecutar: si mañana borran la plantilla o cambian el nodo, el
 * histórico tiene que seguir contando lo que pasó ese día.
 */
export function describeFlowAction(
  kind: FlowActionType,
  config: unknown = {},
  lookups: FlowActionLookups = {},
): string {
  const cfg = asRecord(config)

  switch (kind) {
    case 'trigger':
      return 'Inicio'
    case 'enrolled':
      return 'Entró al flujo'
    case 'completed':
      return 'Terminó el flujo'
    case 'failed':
      return 'Se cortó por un error'
    case 'send_template': {
      const channel = CHANNEL_LABEL[(lookups.channelType ?? '').toLowerCase()] ?? 'Mensaje'
      const name = lookups.templateName?.trim()
      return name ? `${channel}: ${name}` : channel
    }
    case 'wait': {
      const minutes = Number(cfg.minutes)
      const human = formatWaitLabel(minutes)
      return human ? `Esperar ${human}` : 'Esperar'
    }
    case 'condition':
      return describeCondition(cfg)
    case 'add_tag': {
      const name = lookups.tagName?.trim()
      return name ? `Etiquetar: ${name}` : 'Etiquetar'
    }
  }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export type LogFlowEventInput = {
  execution: {
    id: string
    tenant_id: string
    flow_id: string
    customer_id: string | null
  }
  /** Modo grafo. */
  nodeId?: string | null
  /** Modo lineal heredado (flow_steps). */
  stepPosition?: number | null
  actionType: FlowActionType
  actionLabel: string
  status: FlowEventStatus
  /** Sólo referencias (ids, nombres de plantilla/etiqueta, rama, fechas). Sin PII. */
  detail?: Record<string, Json>
  error?: string | null
}

export async function logFlowEvent(input: LogFlowEventInput): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service.from('flow_execution_events').insert({
      tenant_id: input.execution.tenant_id,
      flow_id: input.execution.flow_id,
      execution_id: input.execution.id,
      customer_id: input.execution.customer_id,
      node_id: input.nodeId ?? null,
      step_position: input.stepPosition ?? null,
      action_type: input.actionType,
      action_label: input.actionLabel,
      status: input.status,
      detail: (input.detail ?? {}) as Json,
      error: input.error ?? null,
    })
    if (error) {
      console.error(
        `[flows.log] insert falló (execution=${input.execution.id}, action=${input.actionType}): ${error.message}`,
      )
    }
  } catch (e) {
    console.error(
      `[flows.log] excepción al registrar (execution=${input.execution.id}, action=${input.actionType}): ${(e as Error).message}`,
    )
  }
}
