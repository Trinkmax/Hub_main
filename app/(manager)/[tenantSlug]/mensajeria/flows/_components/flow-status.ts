import type { StatusMap } from '@/components/ui/status-badge'
import { type FlowEventStatus, STATUS_META } from '@/lib/flows/execution-log-labels'

/**
 * Estados de la lista de automatizaciones y del registro de ejecuciones, para
 * `StatusBadge`. Las etiquetas del registro siguen saliendo de
 * `lib/flows/execution-log-labels` (una sola fuente de texto); acá se les
 * pone el tono del kit. Vive acá hasta que exista `lib/flows/status-meta.ts`
 * (el lote no toca `lib/`).
 */
export type FlowActiveStatus = 'active' | 'paused'

export const FLOW_ACTIVE_STATUS: StatusMap<FlowActiveStatus> = {
  active: {
    label: 'Activa',
    tone: 'success',
    description: 'Se les manda a tus clientes cuando corresponde.',
  },
  paused: {
    label: 'En pausa',
    tone: 'neutral',
    description: 'No manda nada aunque se cumpla el disparador.',
  },
}

export const FLOW_EVENT_STATUS: StatusMap<FlowEventStatus> = {
  executed: { label: STATUS_META.executed.label, tone: 'success' },
  waiting: { label: STATUS_META.waiting.label, tone: 'warning' },
  skipped: { label: STATUS_META.skipped.label, tone: 'neutral' },
  error: { label: STATUS_META.error.label, tone: 'danger' },
}
