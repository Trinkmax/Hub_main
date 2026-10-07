import type { StatusMap } from '@/components/ui/status-badge'
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '@/lib/marketing/constants'

/**
 * Cómo se ve cada estado de una tarea (kit HUB §3.4): etiqueta y tono para la
 * etiqueta de estado y su menú. `blocked` va en aviso y no en peligro: está
 * trabada, no rota.
 *
 * El kit pide este mapa en `lib/marketing/status-meta.ts`; vive acá porque el
 * lote del panel no toca `lib/`. Reemplaza a `STATUS_DOT` y `STATUS_CHIP` de
 * `lib/marketing/constants` (clases de color sueltas), que quedan sin uso.
 */
export const TASK_STATUS_META: StatusMap<TaskStatus> = {
  todo: { label: STATUS_LABELS.todo, tone: 'neutral' },
  in_progress: { label: STATUS_LABELS.in_progress, tone: 'info' },
  blocked: {
    label: STATUS_LABELS.blocked,
    tone: 'warning',
    description: 'Está trabada: falta algo para poder seguir.',
  },
  done: { label: STATUS_LABELS.done, tone: 'success' },
}

/** El valor que devuelve un menú de radios es un string: esto lo vuelve a tipar. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}
