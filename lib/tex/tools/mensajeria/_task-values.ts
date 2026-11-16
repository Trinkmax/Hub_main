import {
  type BoardGroup,
  type BoardTask,
  compareByCompletion,
  compareByPosition,
  dueState,
  matchesPerson,
  matchesSearch,
  normalizeText,
  type TeamMember,
} from '@/lib/marketing/board'
import { STATUS_LABELS, type TaskStatus } from '@/lib/marketing/constants'
import type { RoutineRow } from '@/lib/marketing/queries'
import type { TaskPatch } from '@/lib/marketing/schemas'
import { type DateBucket, dateBucket, formatDayShort, weekLabel } from '@/lib/marketing/week'
import type { TexTicketWarning } from '../../protocol'
import { matchByName, noMatchText } from '../actions/_gastos-values'
import { cappedBySize } from '../read/common'
import { dayText, type TexTicketDraft } from '../types'
import { dateTimeText, redactContact, safeText } from './_common'

/**
 * El tablero de tareas de marketing (estilo Monday), puro: las palabras de Tex, cómo lee cada tarea y
 * los tiques. Las reglas son las del tablero (`lib/marketing/board.ts`): qué está vencido, a qué grupo
 * va una tarea cuyo grupo no llegó, qué se busca con el texto. Lo prueba `tex-mensajeria.test.ts`.
 */

const LIST_MAX = 30
const NOTES_MAX = 160
const OPTIONS_MAX = 8
/** Lo que no tiene vencimiento va al fondo. */
const NO_DATE_LAST = '9999-12-31'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Picked<T> = { ok: true; value: T } | { ok: false; message: string }

// ─── Las palabras ────────────────────────────────────────────────────────────

/** Los seis estados del tablero, como los dice Tex. `en_proceso` es como se decía antes «En curso». */
export const STATUS_OF_WORD = {
  por_hacer: 'todo',
  en_curso: 'in_progress',
  interrumpido: 'blocked',
  terminado: 'done',
  backlog: 'backlog',
  esperando_feedback: 'waiting_feedback',
  en_proceso: 'in_progress',
} as const satisfies Record<string, TaskStatus>

export type StatusWord = keyof typeof STATUS_OF_WORD
export const STATUS_WORDS = Object.keys(STATUS_OF_WORD) as [StatusWord, ...StatusWord[]]

/** Por el vencimiento. Las ventanas son las de `dateBucket`: 7 y 14 días desde hoy. */
export const WHEN_WORDS = [
  'vencidas',
  'hoy',
  'esta_semana',
  'proxima_semana',
  'mas_adelante',
  'sin_fecha',
] as const
export type WhenWord = (typeof WHEN_WORDS)[number]

const BUCKET_OF_WHEN: Readonly<Record<Exclude<WhenWord, 'sin_fecha'>, DateBucket>> = {
  vencidas: 'past',
  hoy: 'today',
  esta_semana: 'this_week',
  proxima_semana: 'next_week',
  mas_adelante: 'later',
}

/** Cómo se lee el vencimiento de una tarea abierta. */
const WHEN_LABELS: Readonly<Record<DateBucket, string>> = {
  past: 'Vencida',
  today: 'Vence hoy',
  this_week: 'Esta semana',
  next_week: 'La próxima semana',
  later: 'Más adelante',
}

/** Lo que Tex manda en `vencimiento` para sacarlo. */
export const NO_DUE = 'sin_fecha'

/** ¿Cae en ese cajón? Lo terminado nunca está vencido, como en el tablero. */
export function matchesWhen(
  task: Pick<BoardTask, 'dueDate' | 'status'>,
  word: WhenWord,
  today: string,
): boolean {
  if (word === 'sin_fecha') return task.dueDate === null
  if (!task.dueDate) return false
  if (word === 'vencidas') return dueState(task.dueDate, today, task.status) === 'overdue'
  return dateBucket(task.dueDate, today) === BUCKET_OF_WHEN[word]
}

// ─── Grupos ──────────────────────────────────────────────────────────────────

export const NO_GROUPS =
  'El tablero todavía no tiene grupos: los arma un dueño en Marketing › Tareas. Llevalo ahí.'

/** En el orden del tablero. */
export function orderedGroups(groups: readonly BoardGroup[]): BoardGroup[] {
  return [...groups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** Donde se ve la tarea: su grupo, o el primero si el suyo no llegó (como el tablero). */
export function groupOfTask(
  task: Pick<BoardTask, 'groupId'>,
  ordered: readonly BoardGroup[],
): BoardGroup | null {
  return ordered.find((group) => group.id === task.groupId) ?? ordered[0] ?? null
}

export function pickGroup(groups: readonly BoardGroup[], wanted: string): Picked<BoardGroup> {
  const ordered = orderedGroups(groups)
  if (ordered.length === 0) return { ok: false, message: NO_GROUPS }
  const name = wanted.trim()
  const match = matchByName(ordered, name)
  return match.ok
    ? { ok: true, value: match.value }
    : { ok: false, message: noMatchText(match, name) }
}

/** El grupo de un alta: el que dijo; si no dijo nada y hay uno solo, ese. Con varios, se pregunta. */
export function groupForNewTask(
  groups: readonly BoardGroup[],
  wanted: string | undefined,
): Picked<BoardGroup> {
  const ordered = orderedGroups(groups)
  if (ordered.length === 0) return { ok: false, message: NO_GROUPS }
  if (wanted) return pickGroup(ordered, wanted)
  const [only] = ordered
  if (only && ordered.length === 1) return { ok: true, value: only }
  return {
    ok: false,
    message: `Preguntale en qué grupo va: ${ordered.map((group) => group.name).join(', ')}.`,
  }
}

// ─── Personas ────────────────────────────────────────────────────────────────

const GONE_PERSON = 'Alguien que ya no está en el equipo'

export function namesOf(team: readonly TeamMember[], ids: readonly string[]): string[] {
  return ids.map((id) => team.find((member) => member.id === id)?.name ?? GONE_PERSON)
}

/** Una persona del equipo: «yo» es quien habla; «nadie», nadie (`null`). */
export function personOf(
  team: readonly TeamMember[],
  wanted: string,
  me: string,
): Picked<string | null> {
  const name = wanted.trim()
  const key = normalizeText(name)
  if (key === 'yo') return { ok: true, value: me }
  if (key === 'nadie') return { ok: true, value: null }
  const match = matchByName(team, name)
  return match.ok
    ? { ok: true, value: match.value.id }
    : { ok: false, message: noMatchText(match, name) }
}

/**
 * La lista entera de responsables o de involucrados, en ids del equipo, sin repetidos. «nadie» no suma
 * a nadie: `["nadie"]` la deja vacía. «yo» solo si quien habla trabaja el tablero: la base no deja
 * poner a alguien de afuera.
 */
export function peopleIds(
  team: readonly TeamMember[],
  wanted: readonly string[],
  me: string,
): Picked<string[]> {
  const ids: string[] = []
  for (const name of wanted) {
    const person = personOf(team, name, me)
    if (!person.ok) return person
    const id = person.value
    if (id === null) continue
    if (!team.some((member) => member.id === id)) {
      return {
        ok: false,
        message: 'Vos no estás en el equipo del tablero: no te puedo poner en una tarea.',
      }
    }
    if (!ids.includes(id)) ids.push(id)
  }
  return { ok: true, value: ids }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

// ─── Encontrar una tarea ─────────────────────────────────────────────────────

/** El título como lo lee Tex: sin teléfonos ni mails. */
export function shownTitle(task: Pick<BoardTask, 'title'>): string {
  return redactContact(task.title)
}

/** Se encuentra por el título de verdad y por el que lee Tex (con el dato tapado). */
function titleKeys(task: Pick<BoardTask, 'title'>): string[] {
  return [normalizeText(task.title.trim()), normalizeText(shownTitle(task).trim())]
}

function byTitle(tasks: readonly BoardTask[], key: string): BoardTask[] {
  const exact = tasks.filter((task) => titleKeys(task).includes(key))
  if (exact.length === 1) return exact
  return tasks.filter((task) => titleKeys(task).some((title) => title.includes(key)))
}

/**
 * Una sola tarea, por id o por título (sin tildes ni mayúsculas). Primero entre las abiertas: lo
 * terminado se acumula con los mismos nombres («Historia de Happy Hour» todas las semanas). Tex nunca
 * elige entre dos: con varias, vuelve con cada una, su grupo y su id.
 */
export function pickTask(
  tasks: readonly BoardTask[],
  groups: readonly BoardGroup[],
  wanted: string,
): Picked<BoardTask> {
  const value = wanted.trim()
  if (UUID_RE.test(value)) {
    const task = tasks.find((candidate) => candidate.id.toLowerCase() === value.toLowerCase())
    return task
      ? { ok: true, value: task }
      : { ok: false, message: 'Esa tarea ya no está en el tablero: puede que la hayan borrado.' }
  }
  const key = normalizeText(value)
  const open = tasks.filter((task) => task.status !== 'done')
  const amongOpen = byTitle(open, key)
  const found = amongOpen.length > 0 ? amongOpen : byTitle(tasks, key)
  const [only] = found
  if (only && found.length === 1) return { ok: true, value: only }
  if (found.length > 1) {
    const ordered = orderedGroups(groups)
    const options = found.slice(0, OPTIONS_MAX).map((task) => {
      const group = groupOfTask(task, ordered)?.name ?? 'sin grupo'
      return `«${shownTitle(task)}» en ${group} (${STATUS_LABELS[task.status]}, id ${task.id})`
    })
    return { ok: false, message: `«${value}» puede ser ${options.join('; ')}. Preguntale cuál.` }
  }
  const some = open.slice(0, OPTIONS_MAX).map((task) => `«${shownTitle(task)}»`)
  return {
    ok: false,
    message: `No encontré «${value}». Algunas de las que hay: ${some.join(', ') || 'ninguna abierta'}.`,
  }
}

// ─── Lo que lee Tex ──────────────────────────────────────────────────────────

export type TaskFilters = {
  groupId?: string
  status?: TaskStatus
  /** Responsable o involucrada. `null`: las que no tienen responsable. */
  personId?: string | null
  when?: WhenWord
  text?: string
  includeDone: boolean
}

/** Sin estado ni `includeDone`, las que siguen abiertas: lo que muestra el tablero arriba. */
export function filterTasks(
  tasks: readonly BoardTask[],
  groups: readonly BoardGroup[],
  filters: TaskFilters,
  today: string,
): BoardTask[] {
  const ordered = orderedGroups(groups)
  return tasks.filter((task) => {
    if (filters.groupId && groupOfTask(task, ordered)?.id !== filters.groupId) return false
    if (filters.status) {
      if (task.status !== filters.status) return false
    } else if (!filters.includeDone && task.status === 'done') {
      return false
    }
    if (filters.personId === null && task.responsibleIds.length > 0) return false
    if (filters.personId && !matchesPerson(task, filters.personId)) return false
    if (filters.when && !matchesWhen(task, filters.when, today)) return false
    if (filters.text && !matchesSearch(task, filters.text)) return false
    return true
  })
}

export function taskRow(
  task: BoardTask,
  ordered: readonly BoardGroup[],
  team: readonly TeamMember[],
  today: string,
) {
  const open = task.status !== 'done'
  const responsables = namesOf(team, task.responsibleIds)
  const involucrados = namesOf(team, task.involvedIds)
  const notes = safeText(task.notes, NOTES_MAX)
  return {
    id: task.id,
    tarea: shownTitle(task),
    grupo: groupOfTask(task, ordered)?.name ?? 'Sin grupo',
    estado: STATUS_LABELS[task.status],
    ...(task.dueDate ? { vence: dayText(task.dueDate) } : {}),
    ...(open && task.dueDate ? { cuando: WHEN_LABELS[dateBucket(task.dueDate, today)] } : {}),
    ...(responsables.length > 0 ? { responsables } : {}),
    ...(involucrados.length > 0 ? { involucrados } : {}),
    ...(notes ? { notas: notes } : {}),
    ...(task.updatesCount > 0 ? { actualizaciones: task.updatesCount } : {}),
    ...(task.filesCount > 0 ? { archivos: task.filesCount } : {}),
    ...(!open && task.completedAt ? { terminada: dateTimeText(task.completedAt) } : {}),
  }
}

/** Lo abierto primero, de lo que vence antes a lo que no tiene fecha; después lo terminado, lo último arriba. */
export function sortForReading(
  tasks: readonly BoardTask[],
  groups: readonly BoardGroup[],
): BoardTask[] {
  const ordered = orderedGroups(groups)
  const rank = new Map(ordered.map((group, index) => [group.id, index]))
  const groupRank = (task: BoardTask) => rank.get(groupOfTask(task, ordered)?.id ?? '') ?? 0
  return [...tasks].sort((a, b) => {
    const aDone = a.status === 'done'
    const bDone = b.status === 'done'
    if (aDone !== bDone) return aDone ? 1 : -1
    if (aDone) return compareByCompletion(a, b)
    return (
      (a.dueDate ?? NO_DATE_LAST).localeCompare(b.dueDate ?? NO_DATE_LAST) ||
      groupRank(a) - groupRank(b) ||
      compareByPosition(a, b)
    )
  })
}

export function tasksData(
  tasks: readonly BoardTask[],
  groups: readonly BoardGroup[],
  team: readonly TeamMember[],
  today: string,
) {
  const ordered = orderedGroups(groups)
  const byStatus: Partial<Record<string, number>> = {}
  const byGroup: Partial<Record<string, number>> = {}
  for (const task of tasks) {
    const status = STATUS_LABELS[task.status]
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const group = groupOfTask(task, ordered)?.name ?? 'Sin grupo'
    byGroup[group] = (byGroup[group] ?? 0) + 1
  }
  const { filas, hay_mas } = cappedBySize(
    sortForReading(tasks, ordered).map((task) => taskRow(task, ordered, team, today)),
    LIST_MAX,
  )
  return { cuantas: tasks.length, por_estado: byStatus, por_grupo: byGroup, filas, hay_mas }
}

/** El tablero trae solo lo último de lo terminado: si hay más, Tex lo tiene que saber. */
export function doneNote(doneTotal: number, loadedDone: number): string | null {
  return doneTotal > loadedDone
    ? `Hay ${doneTotal} terminadas en total y el tablero trae las últimas ${loadedDone}: lo de más atrás no está acá.`
    : null
}

// ─── Lo que tiene una tarea, para prepararla ─────────────────────────────────

export type TaskFacts = {
  title: string
  groupId: string
  groupName: string
  status: TaskStatus
  dueDate: string | null
  notes: string | null
  responsibleIds: readonly string[]
  involvedIds: readonly string[]
}

export function taskFactsOf(task: BoardTask, groups: readonly BoardGroup[]): TaskFacts {
  return {
    title: task.title,
    groupId: task.groupId,
    groupName: groupOfTask(task, orderedGroups(groups))?.name ?? 'Sin grupo',
    status: task.status,
    dueDate: task.dueDate,
    notes: task.notes,
    responsibleIds: task.responsibleIds,
    involvedIds: task.involvedIds,
  }
}

/** Como el alta del tablero: «Por hacer», sin vencimiento, sin notas y sin nadie. */
export function newTaskFacts(title: string, group: BoardGroup): TaskFacts {
  return {
    title,
    groupId: group.id,
    groupName: group.name,
    status: 'todo',
    dueDate: null,
    notes: null,
    responsibleIds: [],
    involvedIds: [],
  }
}

/** Notas: vacío las borra, como en el tablero. */
export function notesValue(text: string): string | null {
  const value = text.trim()
  return value.length > 0 ? value : null
}

/** Solo lo que cambia: una edición no pisa lo que otro tocó mientras tanto en otro campo. */
export function taskPatchOf(before: TaskFacts, after: TaskFacts): TaskPatch | null {
  const patch: TaskPatch = {}
  if (after.title !== before.title) patch.title = after.title
  if (after.status !== before.status) patch.status = after.status
  if (after.dueDate !== before.dueDate) patch.dueDate = after.dueDate
  if (after.notes !== before.notes) patch.notes = after.notes
  if (after.groupId !== before.groupId) patch.groupId = after.groupId
  return Object.keys(patch).length > 0 ? patch : null
}

/** La lista nueva de esas personas, o `null` si queda igual. */
export function peopleChange(before: readonly string[], after: readonly string[]): string[] | null {
  return sameIds(before, after) ? null : [...after]
}

// ─── Los tiques ──────────────────────────────────────────────────────────────

function peopleText(team: readonly TeamMember[], ids: readonly string[], empty: string): string {
  return ids.length > 0 ? namesOf(team, ids).join(', ') : empty
}

function taskWarnings(before: TaskFacts | null, after: TaskFacts, today: string) {
  const warnings: TexTicketWarning[] = []
  if (
    after.dueDate &&
    after.dueDate !== before?.dueDate &&
    after.status !== 'done' &&
    after.dueDate < today
  ) {
    warnings.push({
      key: 'due_past',
      title: `El ${dayText(after.dueDate)} ya pasó: va a quedar vencida.`,
      body: null,
    })
  }
  if (before?.notes && after.notes !== before.notes) {
    warnings.push({
      key: 'notes_replaced',
      title: after.notes
        ? 'Estas notas reemplazan las que tenía.'
        : 'Se borran las notas que tenía.',
      body: null,
    })
  }
  return warnings
}

/** El alta: todo lo que va a tener. */
export function newTaskTicket(
  after: TaskFacts,
  team: readonly TeamMember[],
  today: string,
): TexTicketDraft {
  return {
    kind: 'tarea',
    title: 'Nueva tarea de marketing',
    subtitle: after.title,
    rows: [
      { label: 'Grupo', value: after.groupName },
      { label: 'Estado', value: STATUS_LABELS[after.status] },
      { label: 'Responsables', value: peopleText(team, after.responsibleIds, 'Sin asignar') },
      ...(after.involvedIds.length > 0
        ? [{ label: 'Involucrados', value: peopleText(team, after.involvedIds, '') }]
        : []),
      ...(after.dueDate
        ? [{ label: 'Vence', value: dayText(after.dueDate) ?? after.dueDate }]
        : []),
      ...(after.notes ? [{ label: 'Notas', value: after.notes }] : []),
    ],
    total: null,
    entry: [],
    warnings: taskWarnings(null, after, today),
    confirmLabel: 'Crear la tarea',
  }
}

/** La edición: solo lo que cambia, con lo que tenía. */
export function editTaskTicket(
  before: TaskFacts,
  after: TaskFacts,
  team: readonly TeamMember[],
  today: string,
): TexTicketDraft {
  const was = (now: string, then: string) => `${now} (antes: ${then})`
  const rows: TexTicketDraft['rows'] = []
  if (after.title !== before.title) rows.push({ label: 'Antes se llamaba', value: before.title })
  if (after.groupId !== before.groupId) {
    rows.push({ label: 'Grupo', value: was(after.groupName, before.groupName) })
  }
  if (after.status !== before.status) {
    rows.push({
      label: 'Estado',
      value: was(STATUS_LABELS[after.status], STATUS_LABELS[before.status]),
    })
  }
  if (!sameIds(after.responsibleIds, before.responsibleIds)) {
    rows.push({
      label: 'Responsables',
      value: was(
        peopleText(team, after.responsibleIds, 'Sin asignar'),
        peopleText(team, before.responsibleIds, 'sin asignar'),
      ),
    })
  }
  if (!sameIds(after.involvedIds, before.involvedIds)) {
    rows.push({
      label: 'Involucrados',
      value: was(
        peopleText(team, after.involvedIds, 'Nadie'),
        peopleText(team, before.involvedIds, 'nadie'),
      ),
    })
  }
  if (after.dueDate !== before.dueDate) {
    rows.push({
      label: 'Vence',
      value: was(dayText(after.dueDate) ?? 'Sin fecha', dayText(before.dueDate) ?? 'sin fecha'),
    })
  }
  if (after.notes !== before.notes) rows.push({ label: 'Notas', value: after.notes ?? 'Sin notas' })
  return {
    kind: 'tarea',
    title: 'Editar una tarea',
    subtitle: after.title,
    rows,
    total: null,
    entry: [],
    warnings: taskWarnings(before, after, today),
    confirmLabel: 'Guardar los cambios',
  }
}

export function taskStatusTicket(
  task: BoardTask,
  groupName: string,
  status: TaskStatus,
): TexTicketDraft {
  const title =
    status === 'done'
      ? 'Terminar una tarea'
      : task.status === 'done'
        ? 'Reabrir una tarea'
        : 'Cambiar el estado de una tarea'
  return {
    kind: 'estado_tarea',
    title,
    subtitle: task.title,
    rows: [
      { label: 'Grupo', value: groupName },
      { label: 'Estaba', value: STATUS_LABELS[task.status] },
      { label: 'Queda', value: STATUS_LABELS[status] },
    ],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: status === 'done' ? 'Marcar terminada' : `Pasar a ${STATUS_LABELS[status]}`,
  }
}

export function taskUpdateTicket(task: BoardTask, body: string): TexTicketDraft {
  return {
    kind: 'actualizacion_tarea',
    title: 'Dejar una actualización',
    subtitle: task.title,
    rows: [{ label: 'Texto', value: body }],
    total: null,
    entry: [],
    warnings: [],
    confirmLabel: 'Publicar la actualización',
  }
}

// ─── La rutina de la semana (Orgánico) ───────────────────────────────────────

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
      ...(routine.description ? { descripcion: safeText(routine.description, NOTES_MAX) } : {}),
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
    title: done ? 'Tildar en la rutina' : 'Destildar en la rutina',
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
