// Vocabulario compartido del registro de ejecuciones: tipos de acción, estados
// y cómo se llaman en castellano. Módulo PURO (sin server-only) porque lo usan
// tanto el runtime al escribir el log como la tabla del cliente al mostrarlo —
// una sola fuente de verdad para que la DB y la pantalla no se desalineen.

export type FlowActionType =
  | 'trigger'
  | 'send_template'
  | 'wait'
  | 'condition'
  | 'add_tag'
  | 'enrolled'
  | 'completed'
  | 'failed'

export type FlowEventStatus = 'executed' | 'waiting' | 'skipped' | 'error'

/**
 * Minutos → texto humano ("45 min", "2 h", "1 h 30 min", "3 días"). El dueño
 * lee la grilla de un vistazo: nunca mostrarle "120 minutos".
 */
export function formatWaitLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  const total = Math.round(minutes)
  if (total % 1440 === 0) {
    const days = total / 1440
    return `${days} ${days === 1 ? 'día' : 'días'}`
  }
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export const ACTION_LABEL: Record<FlowActionType, string> = {
  enrolled: 'Entró al flujo',
  trigger: 'Inicio',
  send_template: 'Mensaje',
  wait: 'Espera',
  condition: 'Condición',
  add_tag: 'Etiqueta',
  completed: 'Fin del flujo',
  failed: 'Error',
}

// El disparador no se lista: es ruido para filtrar (siempre hay uno solo y ya
// aparece como "Entró al flujo").
export const ACTION_OPTIONS: Array<{ value: FlowActionType; label: string }> = (
  ['enrolled', 'send_template', 'wait', 'condition', 'add_tag', 'completed', 'failed'] as const
).map((value) => ({ value, label: ACTION_LABEL[value] }))

// Variantes del Badge del design system — nada de hex hardcodeado.
export const STATUS_META: Record<
  FlowEventStatus,
  { label: string; variant: 'success' | 'warning' | 'muted' | 'destructive' }
> = {
  executed: { label: 'Ejecutado', variant: 'success' },
  waiting: { label: 'Esperando', variant: 'warning' },
  skipped: { label: 'Omitido', variant: 'muted' },
  error: { label: 'Error', variant: 'destructive' },
}

export const STATUS_OPTIONS: Array<{ value: FlowEventStatus; label: string }> = (
  ['executed', 'waiting', 'skipped', 'error'] as const
).map((value) => ({ value, label: STATUS_META[value].label }))

/**
 * Motivos por los que un envío no salió. En la DB guardamos la clave estable
 * (no el texto) para poder reescribir la explicación sin migrar filas viejas.
 */
export const SKIP_REASON_LABEL: Record<string, string> = {
  blocked: 'El cliente está bloqueado: no se le manda nada',
  no_opt_in: 'No aceptó recibir promos y la plantilla es de marketing',
}

/** Claves conocidas de `detail`, para mostrarlas con nombre y no como JSON crudo. */
export const DETAIL_LABEL: Record<string, string> = {
  template_name: 'Plantilla',
  template_id: 'ID de plantilla',
  channel_type: 'Canal',
  skip_reason: 'Motivo',
  branch: 'Camino',
  field: 'Campo',
  op: 'Comparación',
  wait_minutes: 'Tiempo de espera',
  next_run_at: 'Sigue el',
  tag_name: 'Etiqueta',
  tag_id: 'ID de etiqueta',
}

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
}
