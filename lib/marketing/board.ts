/**
 * La lógica del tablero de tareas, pura (sin red ni React): qué tarea va en qué
 * grupo, qué se fue a «Terminadas», cómo se ve el vencimiento, el reparto de
 * estados de cada grupo, los filtros y el orden. Lo usan la pantalla, Tex y los
 * tests (`tests/lib/marketing-board.test.ts`).
 *
 * Fechas como `yyyy-MM-dd` en el reloj del bar (ver `week.ts`): se comparan como
 * texto y la aritmética va por UTC para no correr un día según el huso del server.
 */

import type { TenantRole } from '@/lib/tenant/types'
import {
  type GroupColor,
  PERSON_COLORS,
  TASK_STATUSES,
  type TaskPersonRole,
  type TaskStatus,
} from './constants'

// ──────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────

export type BoardGroup = {
  id: string
  name: string
  color: GroupColor
  position: number
}

export type BoardTask = {
  id: string
  groupId: string
  title: string
  status: TaskStatus
  dueDate: string | null
  notes: string | null
  position: number
  responsibleIds: string[]
  involvedIds: string[]
  updatesCount: number
  filesCount: number
  createdBy: string | null
  createdAt: string
  completedAt: string | null
  updatedAt: string
}

export type TeamMember = {
  id: string
  name: string
  role: TenantRole
}

export type BoardFilter = {
  /** Solo las tareas de esta persona (responsable o involucrada). */
  personId?: string | null
  /** Texto libre: título y notas, sin importar tildes ni mayúsculas. */
  query?: string
  /** Solo las vencidas (el número de la barra lleva acá). */
  onlyOverdue?: boolean
}

export type BoardColumn = {
  group: BoardGroup
  /** Las que siguen abiertas, en su orden. */
  tasks: BoardTask[]
  /** Todas las del grupo (abiertas y terminadas), sin filtro: para la barrita del reparto. */
  breakdown: StatusBreakdown
}

export type BoardView = {
  columns: BoardColumn[]
  /** Lo terminado de todos los grupos, lo más reciente arriba. */
  done: BoardTask[]
  counts: {
    open: number
    overdue: number
    done: number
  }
}

// ──────────────────────────────────────────────
// Texto
// ──────────────────────────────────────────────

/** Minúsculas y sin tildes: «grabación» encuentra «grabacion» y al revés. */
export function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function matchesSearch(task: Pick<BoardTask, 'title' | 'notes'>, query: string): boolean {
  const needle = normalizeText(query.trim())
  if (needle.length === 0) return true
  return normalizeText(`${task.title} ${task.notes ?? ''}`).includes(needle)
}

export function matchesPerson(
  task: Pick<BoardTask, 'responsibleIds' | 'involvedIds'>,
  personId: string,
): boolean {
  return task.responsibleIds.includes(personId) || task.involvedIds.includes(personId)
}

// ──────────────────────────────────────────────
// Fechas
// ──────────────────────────────────────────────

function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDay(iso)
  return toIsoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)))
}

/** 0 = domingo … 6 = sábado. */
function weekday(iso: string): number {
  return parseIsoDay(iso).getUTCDay()
}

export type DueState = 'none' | 'done' | 'overdue' | 'today' | 'soon' | 'later'

/**
 * Cómo se pinta el vencimiento: vencida (rojo con «!»), hoy (ámbar), en los
 * próximos dos días (destacada), más adelante (normal) o terminada (verde y
 * tachada, como Monday). Lo terminado nunca está «vencido».
 */
export function dueState(dueDate: string | null, today: string, status: TaskStatus): DueState {
  if (!dueDate) return 'none'
  if (status === 'done') return 'done'
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'
  if (dueDate <= addDays(today, 2)) return 'soon'
  return 'later'
}

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const

/**
 * «Hoy», «Mañana», «Ayer» o «15 nov» (con el año si no es el de hoy). Meses a
 * mano y no `Intl`: el ICU del server y el del navegador escriben distinto y eso
 * rompe la hidratación.
 */
export function formatDue(dueDate: string, today: string): string {
  if (dueDate === today) return 'Hoy'
  if (dueDate === addDays(today, 1)) return 'Mañana'
  if (dueDate === addDays(today, -1)) return 'Ayer'
  const [year, month, day] = dueDate.split('-')
  const name = MONTHS_SHORT[Number(month) - 1]
  if (!name || !day) return dueDate
  const short = `${Number(day)} ${name}`
  return year === today.slice(0, 4) ? short : `${short} ${year}`
}

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const

/** `2026-11-20` → «vie 20 nov» (debajo de cada atajo del vencimiento). */
export function formatDayWithWeekday(iso: string): string {
  const [, month, day] = iso.split('-')
  const name = MONTHS_SHORT[Number(month) - 1] ?? ''
  const dayName = WEEKDAYS_SHORT[weekday(iso)] ?? ''
  return `${dayName} ${Number(day)} ${name}`.trim()
}

/** `2026-11-15` → `15/11/2026` (el formato del panel). */
export function formatDayLong(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

export type DueShortcut = { key: string; label: string; date: string }

/**
 * Los atajos del selector de vencimiento: Hoy, Mañana, el viernes que viene (el
 * día de los eventos) y el lunes de la semana próxima. Si dos caen el mismo día
 * (un jueves, «Mañana» ya es el viernes; un domingo, ya es el lunes) queda el
 * primero y entra «En dos semanas»: siempre cuatro, nunca uno repetido.
 */
export function dueShortcuts(today: string): DueShortcut[] {
  const dow = weekday(today)
  const toFriday = (5 - dow + 7) % 7 || 7
  const toMonday = (1 - dow + 7) % 7 || 7
  const candidates: DueShortcut[] = [
    { key: 'today', label: 'Hoy', date: today },
    { key: 'tomorrow', label: 'Mañana', date: addDays(today, 1) },
    { key: 'friday', label: 'El viernes', date: addDays(today, toFriday) },
    { key: 'next-week', label: 'La semana que viene', date: addDays(today, toMonday) },
    { key: 'two-weeks', label: 'En dos semanas', date: addDays(today, 14) },
  ]
  const seen = new Set<string>()
  return candidates
    .filter((shortcut) => {
      if (seen.has(shortcut.date)) return false
      seen.add(shortcut.date)
      return true
    })
    .slice(0, 4)
}

// ──────────────────────────────────────────────
// Reparto de estados
// ──────────────────────────────────────────────

export type StatusBreakdown = {
  total: number
  /** Cantidad por estado, en el orden de `TASK_STATUSES`; solo los que tienen alguna. */
  parts: Array<{ status: TaskStatus; count: number }>
}

export function statusBreakdown(tasks: ReadonlyArray<Pick<BoardTask, 'status'>>): StatusBreakdown {
  const counts = new Map<TaskStatus, number>()
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  return {
    total: tasks.length,
    parts: TASK_STATUSES.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    })),
  }
}

// ──────────────────────────────────────────────
// El tablero
// ──────────────────────────────────────────────

export function compareByPosition(a: BoardTask, b: BoardTask): number {
  if (a.position !== b.position) return a.position - b.position
  return a.createdAt.localeCompare(b.createdAt)
}

/** Lo terminado más reciente arriba (si no hay fecha de cierre, la última edición). */
export function compareByCompletion(a: BoardTask, b: BoardTask): number {
  const aAt = a.completedAt ?? a.updatedAt
  const bAt = b.completedAt ?? b.updatedAt
  return bAt.localeCompare(aAt)
}

function passes(task: BoardTask, filter: BoardFilter, today: string): boolean {
  if (filter.personId && !matchesPerson(task, filter.personId)) return false
  if (filter.query && !matchesSearch(task, filter.query)) return false
  if (filter.onlyOverdue && dueState(task.dueDate, today, task.status) !== 'overdue') return false
  return true
}

/**
 * Arma lo que se ve: cada grupo con sus tareas abiertas en orden, y aparte todo
 * lo terminado (la tarea conserva su grupo: si se reabre, vuelve ahí). Una tarea
 * cuyo grupo no llegó (borrado en otra pestaña) cae en el primero.
 *
 * El filtro achica las filas pero NO la barrita del reparto: esa cuenta cómo va
 * el grupo entero.
 */
export function buildBoard(
  groups: ReadonlyArray<BoardGroup>,
  tasks: ReadonlyArray<BoardTask>,
  filter: BoardFilter,
  today: string,
): BoardView {
  const ordered = [...groups].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  )
  const known = new Set(ordered.map((group) => group.id))
  const fallback = ordered[0]?.id ?? null

  const byGroup = new Map<string, BoardTask[]>()
  const allByGroup = new Map<string, BoardTask[]>()
  const done: BoardTask[] = []
  let open = 0
  let overdue = 0
  let doneCount = 0

  for (const task of tasks) {
    const groupId = known.has(task.groupId) ? task.groupId : fallback
    if (!groupId) continue
    const all = allByGroup.get(groupId)
    if (all) all.push(task)
    else allByGroup.set(groupId, [task])

    if (task.status === 'done') {
      doneCount += 1
    } else {
      open += 1
      if (dueState(task.dueDate, today, task.status) === 'overdue') overdue += 1
    }

    if (!passes(task, filter, today)) continue
    if (task.status === 'done') {
      done.push(task)
      continue
    }
    const list = byGroup.get(groupId)
    if (list) list.push(task)
    else byGroup.set(groupId, [task])
  }

  return {
    columns: ordered.map((group) => ({
      group,
      tasks: (byGroup.get(group.id) ?? []).sort(compareByPosition),
      breakdown: statusBreakdown(allByGroup.get(group.id) ?? []),
    })),
    done: done.sort(compareByCompletion),
    counts: { open, overdue, done: doneCount },
  }
}

/** Cuántas tareas abiertas tiene cada persona (responsable o involucrada). */
export function openCountByPerson(tasks: ReadonlyArray<BoardTask>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.status === 'done') continue
    const people = new Set([...task.responsibleIds, ...task.involvedIds])
    for (const id of people) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

// ──────────────────────────────────────────────
// Orden
// ──────────────────────────────────────────────

/** La posición para una tarea nueva: al fondo del grupo o arriba de todo. */
export function newTaskPosition(
  groupTasks: ReadonlyArray<Pick<BoardTask, 'position'>>,
  where: 'top' | 'bottom',
): number {
  if (groupTasks.length === 0) return 1
  const positions = groupTasks.map((task) => task.position)
  return where === 'top' ? Math.min(...positions) - 1 : Math.max(...positions) + 1
}

/** Mueve un elemento de una lista (copia). Índices fuera de rango: la deja igual. */
export function moveItem<T>(list: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

// ──────────────────────────────────────────────
// Personas
// ──────────────────────────────────────────────

/** Iniciales para el avatar: «Nacho Badra» → «NB», «luz» → «LU», «Socios (demo)» → «SD». */
export function initials(name: string): string {
  // Solo letras y números: «Socios (demo)» → «SD», no «S(».
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0)
  const first = words[0] ?? ''
  const second = words[1] ?? ''
  const letters = second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)
  return letters.toUpperCase() || '?'
}

/** El primer nombre, para las fichas angostas («Nacho Badra» → «Nacho»). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Siempre el mismo color para la misma persona (hash del id). */
export function personColorClass(userId: string): (typeof PERSON_COLORS)[number] {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0
  }
  return PERSON_COLORS[hash % PERSON_COLORS.length] ?? PERSON_COLORS[0]
}

/** Las personas de una tarea con un rol, por nombre (las que ya no están en el equipo, al final). */
export function peopleOf(
  task: Pick<BoardTask, 'responsibleIds' | 'involvedIds'>,
  role: TaskPersonRole,
  team: ReadonlyArray<TeamMember>,
): Array<{ id: string; name: string; inTeam: boolean }> {
  const ids = role === 'responsible' ? task.responsibleIds : task.involvedIds
  const byId = new Map(team.map((member) => [member.id, member]))
  return ids
    .map((id) => {
      const member = byId.get(id)
      return { id, name: member?.name ?? 'Ya no está en el equipo', inTeam: Boolean(member) }
    })
    .sort((a, b) => Number(b.inTeam) - Number(a.inTeam) || a.name.localeCompare(b.name))
}
