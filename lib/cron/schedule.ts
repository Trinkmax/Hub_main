// Tareas de fondo "periódicas" gateadas por el reloj. El dispatcher corre cada
// minuto (pg_cron → /api/cron/dispatch); estas tareas se gatean por minuto/hora
// UTC para no correr en cada tick. Las de ALTA FRECUENCIA (promover broadcasts,
// drenar job_queue, tick de flow_executions) NO están acá: corren siempre.
export type GatedTask = 'evaluate_time_triggers' | 'sync_templates' | 'refresh_meta_tokens'

// Orden determinístico de evaluación y de salida.
const GATED_TASKS: GatedTask[] = ['evaluate_time_triggers', 'sync_templates', 'refresh_meta_tokens']

// Devuelve las tareas gated que corresponden correr en el tick de `date` (UTC).
// Idempotente y tolerante a ticks perdidos: cada tarea subyacente filtra por
// `due <= now`, así que saltarse un tick solo retrasa, no rompe.
export function gatedTasksDue(date: Date): GatedTask[] {
  const minute = date.getUTCMinutes()
  const hour = date.getUTCHours()
  return GATED_TASKS.filter((task) => {
    switch (task) {
      case 'evaluate_time_triggers':
        // Enrolar candidatos de flows por tiempo (inactividad/cumple/evento).
        return minute % 15 === 0
      case 'sync_templates':
        // Refrescar templates aprobados desde Meta.
        return minute % 30 === 0
      case 'refresh_meta_tokens':
        // Una vez al día, 04:20 UTC (01:20 ART). El minuto 20 evita solaparse
        // con los gates de 15/30 min, repartiendo la carga del tick diario.
        return hour === 4 && minute === 20
      default:
        return false
    }
  })
}
