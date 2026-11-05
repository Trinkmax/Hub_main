import {
  CATEGORY_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
  type TaskCategory,
  type TaskKind,
  type TaskStatus,
} from '@/lib/marketing/constants'
import type { MarketingTaskRow, RoutineRow, TeamMember } from '@/lib/marketing/queries'
import {
  BUCKET_LABELS,
  type DateBucket,
  dateBucket,
  formatDayShort,
  weekLabel,
} from '@/lib/marketing/week'
import { cappedBySize } from '../read/common'
import { dayText, type TexTicketDraft } from '../types'
import { safeText } from './_common'

/** El tablero de marketing, puro: con las palabras de las tarjetas (`constants.ts`). */

const LIST_MAX = 30
const DETAIL_MAX = 160
const LINK_MAX = 300

export const CATEGORY_WORDS = ['eventos', 'promociones', 'impresiones'] as const

/** La solapa donde queda una tarea, para que no «desaparezca» después de guardarla. */
export const CATEGORY_SCREEN: Readonly<Record<TaskCategory, string>> = {
  eventos: 'marketing.tareas',
  promociones: 'marketing.tareas_promociones',
  impresiones: 'marketing.tareas_impresiones',
}

export const STATUS_OF_WORD = {
  por_hacer: 'todo',
  en_proceso: 'in_progress',
  interrumpido: 'blocked',
  terminado: 'done',
} as const satisfies Record<string, TaskStatus>

export type StatusWord = keyof typeof STATUS_OF_WORD
export const STATUS_WORDS = Object.keys(STATUS_OF_WORD) as [StatusWord, ...StatusWord[]]

export const KIND_OF_WORD = {
  disenar: 'design',
  grabar: 'shoot',
  editar: 'edit',
  guion: 'script',
  pautar: 'ads',
  subir: 'publish',
  imprimir: 'print',
  coordinar: 'coordinate',
  otro: 'other',
} as const satisfies Record<string, TaskKind>

export type KindWord = keyof typeof KIND_OF_WORD
export const KIND_WORDS = Object.keys(KIND_OF_WORD) as [KindWord, ...KindWord[]]

export const BUCKET_OF_WORD = {
  atrasadas: 'past',
  hoy: 'today',
  esta_semana: 'this_week',
  proxima_semana: 'next_week',
  mas_adelante: 'later',
} as const satisfies Record<string, DateBucket>

export type BucketWord = keyof typeof BUCKET_OF_WORD
export const BUCKET_WORDS = Object.keys(BUCKET_OF_WORD) as [BucketWord, ...BucketWord[]]

/** La fecha que manda: la definida, o si no, la ideal. */
export function effectiveDate(task: Pick<MarketingTaskRow, 'definedDate' | 'idealDate'>) {
  return task.definedDate ?? task.idealDate
}

export function taskRow(task: MarketingTaskRow, team: readonly TeamMember[], today: string) {
  const nameOf = (id: string | null) => team.find((member) => member.id === id)?.name
  const date = effectiveDate(task)
  const responsible = nameOf(task.responsibleId)
  const involved = nameOf(task.involvedId)
  const specifications = safeText(task.specifications, DETAIL_MAX)
  const notes = safeText(task.notes, DETAIL_MAX)
  return {
    id: task.id,
    tarea: task.title,
    seccion: CATEGORY_LABELS[task.category],
    tipo: KIND_LABELS[task.kind],
    estado: STATUS_LABELS[task.status],
    ...(responsible ? { responsable: responsible } : {}),
    ...(involved ? { involucrado: involved } : {}),
    ...(date ? { fecha: dayText(date) } : {}),
    cuando: BUCKET_LABELS[dateBucket(date, today)],
    ...(specifications ? { especificaciones: specifications } : {}),
    ...(notes ? { comentarios: notes } : {}),
    ...(task.fileUrl
      ? task.fileUrl.length <= LINK_MAX
        ? { link: task.fileUrl }
        : { tiene_link: true }
      : {}),
  }
}

export type TaskFilters = {
  category?: TaskCategory
  status?: TaskStatus
  personId?: string
  bucket?: DateBucket
  text?: string
  includeDone: boolean
}

function plainKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function filterTasks(
  tasks: readonly MarketingTaskRow[],
  filters: TaskFilters,
  today: string,
): MarketingTaskRow[] {
  const key = filters.text ? plainKey(filters.text.trim()) : null
  return tasks.filter((task) => {
    if (filters.category && task.category !== filters.category) return false
    if (filters.status) {
      if (task.status !== filters.status) return false
    } else if (!filters.includeDone && task.status === 'done') {
      return false
    }
    if (
      filters.personId &&
      task.responsibleId !== filters.personId &&
      task.involvedId !== filters.personId
    ) {
      return false
    }
    if (filters.bucket && dateBucket(effectiveDate(task), today) !== filters.bucket) return false
    if (key) {
      const haystack = plainKey([task.title, task.specifications ?? '', task.notes ?? ''].join(' '))
      if (!haystack.includes(key)) return false
    }
    return true
  })
}

/** De lo más urgente a lo que no tiene fecha: como se leen los cajones del tablero. */
export function tasksData(
  tasks: readonly MarketingTaskRow[],
  team: readonly TeamMember[],
  today: string,
) {
  const sorted = [...tasks].sort((a, b) =>
    (effectiveDate(a) ?? '9999-12-31').localeCompare(effectiveDate(b) ?? '9999-12-31'),
  )
  const byStatus: Partial<Record<string, number>> = {}
  for (const task of tasks) {
    const label = STATUS_LABELS[task.status]
    byStatus[label] = (byStatus[label] ?? 0) + 1
  }
  const { filas, hay_mas } = cappedBySize(
    sorted.map((task) => taskRow(task, team, today)),
    LIST_MAX,
  )
  return { cuantas: tasks.length, por_estado: byStatus, filas, hay_mas }
}

export type TaskValues = {
  title: string
  category: TaskCategory
  kind: TaskKind
  status: TaskStatus
  specifications: string | null
  notes: string | null
  file_url: string | null
  responsible_user_id: string | null
  involved_user_id: string | null
  ideal_date: string | null
  defined_date: string | null
}

/** Una tarea que ya existe, en lo que manda el diálogo: una edición reemplaza todo. */
export function taskValuesOf(task: MarketingTaskRow): TaskValues {
  return {
    title: task.title,
    category: task.category,
    kind: task.kind,
    status: task.status,
    specifications: task.specifications,
    notes: task.notes,
    file_url: task.fileUrl,
    responsible_user_id: task.responsibleId,
    involved_user_id: task.involvedId,
    ideal_date: task.idealDate,
    defined_date: task.definedDate,
  }
}

export function taskTicket(
  values: TaskValues,
  extra: { editing: boolean; responsible: string | null; involved: string | null },
): TexTicketDraft {
  const optional = (label: string, value: string | null | undefined) =>
    value ? [{ label, value }] : []
  return {
    kind: 'tarea',
    title: extra.editing ? 'Editar tarea' : 'Nueva tarea de marketing',
    subtitle: values.title,
    rows: [
      { label: 'Sección', value: CATEGORY_LABELS[values.category] },
      { label: 'Tipo', value: KIND_LABELS[values.kind] },
      { label: 'Estado', value: STATUS_LABELS[values.status] },
      { label: 'Responsable', value: extra.responsible ?? 'Sin asignar' },
      ...optional('Involucrado', extra.involved),
      ...optional('Fecha ideal', dayText(values.ideal_date)),
      ...optional('Fecha definida', dayText(values.defined_date)),
      ...optional('Especificaciones', values.specifications),
      ...optional('Comentarios', values.notes),
      ...optional('Link', values.file_url),
    ],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: extra.editing ? 'Guardar los cambios' : 'Crear la tarea',
  }
}

export function taskStatusTicket(task: MarketingTaskRow, status: TaskStatus): TexTicketDraft {
  return {
    kind: 'estado_tarea',
    title: status === 'done' ? 'Terminar una tarea' : 'Cambiar el estado de una tarea',
    subtitle: task.title,
    rows: [
      { label: 'Estaba', value: STATUS_LABELS[task.status] },
      { label: 'Queda', value: STATUS_LABELS[status] },
    ],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: status === 'done' ? 'Marcar terminada' : `Pasar a ${STATUS_LABELS[status]}`,
  }
}

// ─── El checklist de Orgánico ────────────────────────────────────────────────

export function routinesData(routines: readonly RoutineRow[], weekStart: string) {
  const total = routines.reduce((sum, routine) => sum + routine.slots, 0)
  const done = routines.reduce((sum, routine) => sum + doneCount(routine), 0)
  return {
    semana: weekLabel(weekStart),
    lunes: dayText(weekStart),
    hechas: done,
    total,
    filas: routines.map((routine) => ({
      id: routine.id,
      rutina: routine.title,
      veces_por_semana: routine.slots,
      hechas: doneCount(routine),
      ...(routine.description ? { descripcion: safeText(routine.description, DETAIL_MAX) } : {}),
    })),
  }
}

/** Un tilde de más (de cuando la rutina pedía más veces) no se cuenta: la pantalla tampoco lo dibuja. */
export function doneCount(routine: Pick<RoutineRow, 'slots' | 'doneSlots'>): number {
  return routine.doneSlots.filter((slot) => slot < routine.slots).length
}

/** Cuál casillero se toca: el primero libre al tildar, el último hecho al destildar. */
export function routineSlot(
  routine: Pick<RoutineRow, 'slots' | 'doneSlots'>,
  done: boolean,
): number | null {
  const taken = routine.doneSlots.filter((slot) => slot < routine.slots)
  if (!done) return taken.length > 0 ? Math.max(...taken) : null
  for (let slot = 0; slot < routine.slots; slot += 1) {
    if (!taken.includes(slot)) return slot
  }
  return null
}

export function routineTicket(
  routine: Pick<RoutineRow, 'title' | 'slots' | 'doneSlots'>,
  done: boolean,
  weekStart: string,
): TexTicketDraft {
  const before = doneCount(routine)
  const after = done ? before + 1 : before - 1
  return {
    kind: 'rutina',
    title: done ? 'Tildar en Orgánico' : 'Destildar en Orgánico',
    subtitle: routine.title,
    rows: [
      { label: 'Semana', value: `${weekLabel(weekStart)} (lunes ${formatDayShort(weekStart)})` },
      { label: 'Queda', value: `${after} de ${routine.slots}` },
    ],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: done ? 'Tildar' : 'Destildar',
  }
}
