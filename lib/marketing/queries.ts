import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { TenantRole } from '@/lib/tenant/types'
import type { BoardGroup, BoardTask, TeamMember } from './board'
import { type GroupColor, isGroupColor, isTaskStatus, type TaskStatus } from './constants'
import { SIGNED_URL_SECONDS, TASK_FILES_BUCKET } from './files'

export type { BoardGroup, BoardTask, TeamMember } from './board'

/**
 * Cuántas terminadas trae el tablero. Lo abierto viene entero; lo terminado se
 * acumula mes a mes (en su Monday ya eran 149) y para mirarlo alcanza con lo
 * último. El total real viaja aparte.
 */
const DONE_LIMIT = 300

/**
 * Las tareas con sus personas y la cantidad de actualizaciones y archivos, en un
 * solo viaje. Los `!fk` desambiguan: `marketing_task_files` también cuelga de
 * las actualizaciones y PostgREST vería dos caminos.
 */
const TASK_COLUMNS = [
  'id',
  'group_id',
  'title',
  'status',
  'due_date',
  'notes',
  'position',
  'created_by',
  'created_at',
  'completed_at',
  'updated_at',
  'people:marketing_task_people!mtp_task_same_tenant(user_id, role)',
  'updates:marketing_task_updates!mtu_task_same_tenant(count)',
  'files:marketing_task_files!mtf_task_same_tenant(count)',
].join(', ')

type TaskRowRaw = {
  id: string
  group_id: string
  title: string
  status: string
  due_date: string | null
  notes: string | null
  position: number | string
  created_by: string | null
  created_at: string
  completed_at: string | null
  updated_at: string
  people: Array<{ user_id: string; role: string }> | null
  updates: Array<{ count: number }> | null
  files: Array<{ count: number }> | null
}

function countOf(rows: Array<{ count: number }> | null): number {
  const value = rows?.[0]?.count
  return typeof value === 'number' ? value : 0
}

function toBoardTask(row: TaskRowRaw): BoardTask | null {
  if (!isTaskStatus(row.status)) return null
  const people = row.people ?? []
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    status: row.status as TaskStatus,
    dueDate: row.due_date,
    notes: row.notes,
    position: Number(row.position) || 0,
    responsibleIds: people.filter((p) => p.role === 'responsible').map((p) => p.user_id),
    involvedIds: people.filter((p) => p.role === 'involved').map((p) => p.user_id),
    updatesCount: countOf(row.updates),
    filesCount: countOf(row.files),
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

export type TaskBoardData = {
  groups: BoardGroup[]
  tasks: BoardTask[]
  /** Todas las terminadas del bar (el tablero trae solo las últimas `DONE_LIMIT`). */
  doneTotal: number
}

/** El tablero entero de un bar. RLS manda: llama con la sesión de quien mira. */
export async function loadTaskBoard(tenantId: string): Promise<TaskBoardData> {
  const supabase = await createClient()

  const [groupsRes, openRes, doneRes, doneCountRes] = await Promise.all([
    supabase
      .from('marketing_task_groups')
      .select('id, name, color, position')
      .eq('tenant_id', tenantId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('marketing_tasks')
      .select(TASK_COLUMNS)
      .eq('tenant_id', tenantId)
      .neq('status', 'done')
      .order('position', { ascending: true }),
    supabase
      .from('marketing_tasks')
      .select(TASK_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('status', 'done')
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(DONE_LIMIT),
    supabase
      .from('marketing_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'done'),
  ])

  // Un error de lectura no puede verse como «no hay grupos» (el dueño los crearía de nuevo):
  // se corta acá y la pantalla muestra el error con «Reintentar» (tareas/error.tsx).
  if (groupsRes.error || openRes.error || doneRes.error) {
    const message = groupsRes.error?.message ?? openRes.error?.message ?? doneRes.error?.message
    console.error('[marketing.loadBoard]', message)
    throw new Error('No pudimos leer el tablero de tareas.')
  }

  const groups: BoardGroup[] = (
    (groupsRes.data ?? []) as Array<{ id: string; name: string; color: string; position: number }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: (isGroupColor(row.color) ? row.color : 'forest') as GroupColor,
    position: Number(row.position) || 0,
  }))

  const tasks: BoardTask[] = []
  for (const row of [
    ...((openRes.data ?? []) as unknown as TaskRowRaw[]),
    ...((doneRes.data ?? []) as unknown as TaskRowRaw[]),
  ]) {
    const task = toBoardTask(row)
    if (task) tasks.push(task)
  }

  return {
    groups,
    tasks,
    doneTotal: doneCountRes.count ?? tasks.filter((task) => task.status === 'done').length,
  }
}

/**
 * La gente asignable. Sale del RPC `get_marketing_team` porque los nombres están
 * repartidos entre `auth.users` (inaccesible vía PostgREST) y
 * `reservation_managers`. Dueños, Contenido y anfitriona.
 */
export async function listMarketingTeam(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_marketing_team', { p_tenant: tenantId })

  if (error) {
    console.error('[marketing.listTeam]', error.message)
    return []
  }

  return ((data ?? []) as Array<{ member_id: string; member_name: string; member_role: string }>)
    .filter((row) => typeof row.member_id === 'string')
    .map((row) => ({
      id: row.member_id,
      name: row.member_name || 'Sin nombre',
      role: row.member_role as TenantRole,
    }))
}

// ──────────────────────────────────────────────
// El panel de una tarea
// ──────────────────────────────────────────────

export type TaskFileRow = {
  id: string
  kind: 'file' | 'link'
  name: string
  /** Archivo: URL firmada para verlo (1 h). Link: el link. Null si no se pudo firmar. */
  url: string | null
  /** Miniatura de las fotos (Supabase la achica). */
  thumbUrl: string | null
  mimeType: string | null
  sizeBytes: number | null
  updateId: string | null
  createdBy: string | null
  createdAt: string
}

export type TaskUpdateRow = {
  id: string
  authorId: string | null
  body: string
  createdAt: string
  edited: boolean
  files: TaskFileRow[]
}

export type TaskDetail = {
  taskId: string
  updates: TaskUpdateRow[]
  /** Todos los archivos de la tarea (los de las actualizaciones también), lo último arriba. */
  files: TaskFileRow[]
}

const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])

/**
 * El detalle de una tarea para el panel. `null` = la tarea ya no está; `'error'` = no se pudo
 * leer (la pantalla ofrece reintentar en vez de decir «no hay nada»).
 */
export async function loadTaskDetail(
  tenantId: string,
  taskId: string,
): Promise<TaskDetail | null | 'error'> {
  const supabase = await createClient()

  const [taskRes, updatesRes, filesRes] = await Promise.all([
    supabase
      .from('marketing_tasks')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', taskId)
      .maybeSingle(),
    supabase
      .from('marketing_task_updates')
      .select('id, author_id, body, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('marketing_task_files')
      .select(
        'id, kind, storage_path, url, file_name, mime_type, size_bytes, update_id, created_by, created_at',
      )
      .eq('tenant_id', tenantId)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  if (taskRes.error || updatesRes.error || filesRes.error) {
    console.error(
      '[marketing.detail]',
      taskRes.error?.message ?? updatesRes.error?.message ?? filesRes.error?.message,
    )
    return 'error'
  }
  if (!taskRes.data) return null

  type FileRaw = {
    id: string
    kind: 'file' | 'link'
    storage_path: string | null
    url: string | null
    file_name: string
    mime_type: string | null
    size_bytes: number | string | null
    update_id: string | null
    created_by: string | null
    created_at: string
  }
  const rawFiles = (filesRes.data ?? []) as FileRaw[]

  // Una sola firma para todos los archivos; las miniaturas, una por foto.
  const bucket = supabase.storage.from(TASK_FILES_BUCKET)
  const paths = rawFiles.flatMap((file) => (file.storage_path ? [file.storage_path] : []))
  const signedByPath = new Map<string, string>()
  const thumbByPath = new Map<string, string>()
  if (paths.length > 0) {
    const [signed, thumbs] = await Promise.all([
      bucket.createSignedUrls(paths, SIGNED_URL_SECONDS),
      Promise.all(
        rawFiles
          .filter((file) => file.storage_path && THUMB_MIMES.has(file.mime_type ?? ''))
          .map(async (file) => {
            const path = file.storage_path as string
            const res = await bucket.createSignedUrl(path, SIGNED_URL_SECONDS, {
              transform: { width: 480, height: 480, resize: 'cover', quality: 70 },
            })
            return res.data?.signedUrl ? ([path, res.data.signedUrl] as const) : null
          }),
      ),
    ])
    if (signed.error) console.error('[marketing.detail.sign]', signed.error.message)
    for (const item of signed.data ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl)
    }
    for (const entry of thumbs) if (entry) thumbByPath.set(entry[0], entry[1])
  }

  const files: TaskFileRow[] = rawFiles.map((file) => ({
    id: file.id,
    kind: file.kind,
    name: file.file_name,
    url:
      file.kind === 'link'
        ? file.url
        : file.storage_path
          ? (signedByPath.get(file.storage_path) ?? null)
          : null,
    thumbUrl: file.storage_path ? (thumbByPath.get(file.storage_path) ?? null) : null,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes === null ? null : Number(file.size_bytes),
    updateId: file.update_id,
    createdBy: file.created_by,
    createdAt: file.created_at,
  }))

  const filesByUpdate = new Map<string, TaskFileRow[]>()
  for (const file of files) {
    if (!file.updateId) continue
    const list = filesByUpdate.get(file.updateId)
    if (list) list.push(file)
    else filesByUpdate.set(file.updateId, [file])
  }

  type UpdateRaw = {
    id: string
    author_id: string | null
    body: string
    created_at: string
    updated_at: string
  }
  const updates: TaskUpdateRow[] = ((updatesRes.data ?? []) as UpdateRaw[]).map((row) => ({
    id: row.id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    // El disparador de `updated_at` corre también en el alta: «editada» es solo
    // si pasó más de un minuto entre las dos.
    edited: new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 60_000,
    files: (filesByUpdate.get(row.id) ?? []).slice().reverse(),
  }))

  return { taskId, updates, files }
}

// ──────────────────────────────────────────────
// Rutina de la semana (Orgánico)
// ──────────────────────────────────────────────

export type RoutineRow = {
  id: string
  title: string
  description: string | null
  slots: number
  position: number
  /** Índices de slot ya tildados en la semana pedida. */
  doneSlots: number[]
}

/** El checklist orgánico de UNA semana, con los tildes ya cruzados. */
export async function listRoutinesForWeek(
  tenantId: string,
  weekStart: string,
): Promise<RoutineRow[]> {
  const supabase = await createClient()

  const [routinesRes, checksRes] = await Promise.all([
    supabase
      .from('marketing_routines')
      .select('id, title, description, slots, position')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('marketing_routine_checks')
      .select('routine_id, slot')
      .eq('tenant_id', tenantId)
      .eq('week_start', weekStart),
  ])

  if (routinesRes.error) {
    console.error('[marketing.listRoutines]', routinesRes.error.message)
    return []
  }
  if (checksRes.error) {
    console.error('[marketing.listRoutineChecks]', checksRes.error.message)
  }

  const bySlot = new Map<string, number[]>()
  for (const check of (checksRes.data ?? []) as Array<{ routine_id: string; slot: number }>) {
    const list = bySlot.get(check.routine_id)
    if (list) list.push(check.slot)
    else bySlot.set(check.routine_id, [check.slot])
  }

  return ((routinesRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    slots: row.slots as number,
    position: row.position as number,
    doneSlots: bySlot.get(row.id as string) ?? [],
  }))
}
