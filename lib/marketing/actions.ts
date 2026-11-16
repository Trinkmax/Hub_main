'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { type z, uuid as zUuid } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  MARKETING_GROUP_ROLES,
  MARKETING_TASK_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  type TenantRole,
  UnauthenticatedError,
} from '@/lib/tenant'
import { type BoardGroup, type BoardTask, newTaskPosition } from './board'
import { type GroupColor, isGroupColor, SUGGESTED_ROUTINES, type TaskStatus } from './constants'
import {
  checkTaskFile,
  cleanFileName,
  isTaskFileMime,
  isTaskFilePath,
  linkLabel,
  SIGNED_URL_SECONDS,
  TASK_FILE_MESSAGES,
  TASK_FILES_BUCKET,
  taskFilePath,
} from './files'
import { loadTaskDetail, type TaskDetail } from './queries'
import {
  addLinkSchema,
  type CreateTaskInput,
  createGroupSchema,
  createTaskSchema,
  editUpdateSchema,
  postUpdateSchema,
  prepareUploadsSchema,
  registerFilesSchema,
  reorderGroupsSchema,
  reorderTasksSchema,
  routineCheckSchema,
  routineUpsertSchema,
  setTaskPeopleSchema,
  type TaskPatch,
  type UploadedTaskFile,
  updateGroupSchema,
  updateTaskSchema,
} from './schemas'

/**
 * Las acciones del tablero de tareas (estilo Monday). Cada gesto de la pantalla
 * es una acción chica y optimista; la base (RLS) decide lo mismo que acá:
 * dueños, Contenido y anfitriona trabajan las tareas; los grupos y las rutinas
 * los arma el dueño; borra una tarea el dueño o quien la creó.
 */

export type MarketingActionState = { ok: true } | { ok: false; message: string }
export type MarketingResult<T> = { ok: true; data: T } | { ok: false; message: string }

type Auth = { tenantId: string; userId: string; role: TenantRole }

const NO_PERMISSION = 'No tenés permiso para hacer esto.'
const GONE = 'Esa tarea ya no existe. Recargá la página.'

async function authorize(
  slug: string,
  roles: ReadonlyArray<TenantRole> = MARKETING_TASK_ROLES,
): Promise<Auth | null> {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, roles)
    return { tenantId: tenant.id, userId: user.id, role }
  } catch (error) {
    if (
      error instanceof RoleRequiredError ||
      error instanceof TenantNotFoundError ||
      error instanceof UnauthenticatedError
    ) {
      return null
    }
    throw error
  }
}

/** Los ids que llegan sueltos del cliente también pasan por zod (CLAUDE.md §6). */
const idSchema = zUuid()

function parseId(value: unknown): string | null {
  const parsed = idSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Toca la tarea para que los demás se enteren en vivo: un DELETE de sus hijas
 * (personas, actualizaciones, archivos) no pasa el filtro por bar de Realtime, un
 * UPDATE de la tarea sí. El `updated_at` lo pone el disparador.
 */
async function touchTask(tenantId: string, taskId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_tasks')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
  if (error) console.error('[marketing.touchTask]', error.message)
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Datos inválidos'
}

function revalidate(slug: string) {
  revalidatePath(`/${slug}/tareas`)
}

/** Marcar «Terminado» congela el cuándo y el quién; volver atrás lo limpia. */
function completionFields(status: TaskStatus, userId: string) {
  return status === 'done'
    ? { completed_at: new Date().toISOString(), completed_by: userId }
    : { completed_at: null, completed_by: null }
}

const TASK_RETURN =
  'id, group_id, title, status, due_date, notes, position, created_by, created_at, completed_at, updated_at'

type TaskRow = {
  id: string
  group_id: string
  title: string
  status: TaskStatus
  due_date: string | null
  notes: string | null
  position: number | string
  created_by: string | null
  created_at: string
  completed_at: string | null
  updated_at: string
}

function rowToTask(row: TaskRow): BoardTask {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    notes: row.notes,
    position: Number(row.position) || 0,
    responsibleIds: [],
    involvedIds: [],
    updatesCount: 0,
    filesCount: 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

/** Borra objetos del bucket. Si falla, solo queda un archivo huérfano: se loguea y sigue. */
async function removeObjects(paths: string[], op: string) {
  if (paths.length === 0) return
  const supabase = await createClient()
  const { error } = await supabase.storage.from(TASK_FILES_BUCKET).remove(paths)
  if (error) console.error(`[marketing.${op}.storage]`, error.message)
}

// ──────────────────────────────────────────────
// Tareas
// ──────────────────────────────────────────────

/** Una tarea nueva en un grupo: al fondo (la fila «+ Agregar tarea») o arriba. */
export async function createTask(
  slug: string,
  input: CreateTaskInput,
): Promise<MarketingResult<{ task: BoardTask }>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = createTaskSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { groupId, title, where } = parsed.data

  const supabase = await createClient()
  const { data: siblings, error: siblingsError } = await supabase
    .from('marketing_tasks')
    .select('position')
    .eq('tenant_id', auth.tenantId)
    .eq('group_id', groupId)
    .neq('status', 'done')
  if (siblingsError) console.error('[marketing.createTask.siblings]', siblingsError.message)

  const position = newTaskPosition(
    ((siblings ?? []) as Array<{ position: number | string }>).map((row) => ({
      position: Number(row.position) || 0,
    })),
    where,
  )

  const { data, error } = await supabase
    .from('marketing_tasks')
    .insert({
      tenant_id: auth.tenantId,
      group_id: groupId,
      title,
      status: 'todo',
      position,
      created_by: auth.userId,
    })
    .select(TASK_RETURN)
    .single()

  if (error || !data) {
    console.error('[marketing.createTask]', error?.message)
    return {
      ok: false,
      message:
        error?.code === '23503'
          ? 'Ese grupo ya no existe. Recargá la página.'
          : 'No pudimos crear la tarea.',
    }
  }

  const task = rowToTask(data as TaskRow)
  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'marketing_task.created',
    entity: 'marketing_task',
    entityId: task.id,
    payload: { group_id: groupId },
  })

  revalidate(slug)
  return { ok: true, data: { task } }
}

/**
 * Un cambio chico sobre una tarea: título, estado, vencimiento, notas o grupo.
 * Pasar a otro grupo la deja al fondo de ese grupo.
 */
export async function updateTask(
  slug: string,
  input: { id: string; patch: TaskPatch },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = updateTaskSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { id, patch } = parsed.data

  const supabase = await createClient()
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.status !== undefined) {
    row.status = patch.status
    Object.assign(row, completionFields(patch.status, auth.userId))
  }
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.groupId !== undefined) {
    const { data: siblings } = await supabase
      .from('marketing_tasks')
      .select('position')
      .eq('tenant_id', auth.tenantId)
      .eq('group_id', patch.groupId)
      .neq('status', 'done')
    row.group_id = patch.groupId
    row.position = newTaskPosition(
      ((siblings ?? []) as Array<{ position: number | string }>).map((item) => ({
        position: Number(item.position) || 0,
      })),
      'bottom',
    )
  }

  const { data, error } = await supabase
    .from('marketing_tasks')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')

  if (error) {
    console.error('[marketing.updateTask]', error.message)
    return {
      ok: false,
      message:
        error.code === '23503'
          ? 'Ese grupo ya no existe. Recargá la página.'
          : 'No pudimos guardar el cambio.',
    }
  }
  if (!data || data.length === 0) return { ok: false, message: GONE }

  if (patch.status === 'done') {
    await logAudit({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'marketing_task.completed',
      entity: 'marketing_task',
      entityId: id,
      payload: {},
    })
  }

  revalidate(slug)
  return { ok: true }
}

/** Responsables o involucrados de una tarea: deja exactamente esta lista. */
export async function setTaskPeople(
  slug: string,
  input: { taskId: string; role: 'responsible' | 'involved'; userIds: string[] },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = setTaskPeopleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { taskId, role } = parsed.data
  const wanted = new Set(parsed.data.userIds)

  const supabase = await createClient()
  const { data: current, error: currentError } = await supabase
    .from('marketing_task_people')
    .select('user_id')
    .eq('tenant_id', auth.tenantId)
    .eq('task_id', taskId)
    .eq('role', role)
  if (currentError) {
    console.error('[marketing.setPeople.current]', currentError.message)
    return { ok: false, message: 'No pudimos guardar el cambio.' }
  }

  const have = new Set(((current ?? []) as Array<{ user_id: string }>).map((row) => row.user_id))
  const toRemove = [...have].filter((userId) => !wanted.has(userId))
  const toAdd = [...wanted].filter((userId) => !have.has(userId))

  // Primero se suma y después se saca: si sumar falla, no queda nadie sacado a medias.
  if (toAdd.length > 0) {
    const { error } = await supabase.from('marketing_task_people').insert(
      toAdd.map((userId) => ({
        tenant_id: auth.tenantId,
        task_id: taskId,
        user_id: userId,
        role,
        created_by: auth.userId,
      })),
    )
    if (error) {
      console.error('[marketing.setPeople.add]', error.message)
      if (error.code === '23503') return { ok: false, message: GONE }
      if (error.code === '42501') {
        return { ok: false, message: 'Esa persona no trabaja el tablero de este bar.' }
      }
      return { ok: false, message: 'No pudimos sumar a esa persona.' }
    }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('marketing_task_people')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .eq('task_id', taskId)
      .eq('role', role)
      .in('user_id', toRemove)
    if (error) {
      console.error('[marketing.setPeople.remove]', error.message)
      // Lo que se sumó ya está: que la pantalla lo muestre igual.
      revalidate(slug)
      return { ok: false, message: 'No pudimos sacar a esa persona.' }
    }
    await touchTask(auth.tenantId, taskId)
  }

  revalidate(slug)
  return { ok: true }
}

/** Borra la tarea con todo lo suyo (actualizaciones, personas, archivos del bucket). */
export async function deleteTask(slug: string, rawId: string): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: GONE }

  const supabase = await createClient()
  // El permiso, antes de tocar el bucket: la misma regla que la base (dueño o quien la creó).
  const { data: task, error: taskError } = await supabase
    .from('marketing_tasks')
    .select('created_by')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (taskError) {
    console.error('[marketing.deleteTask.read]', taskError.message)
    return { ok: false, message: 'No pudimos borrar la tarea.' }
  }
  if (!task) return { ok: false, message: GONE }
  const createdBy = (task as { created_by: string | null }).created_by
  if (auth.role !== 'owner' && createdBy !== auth.userId) {
    return { ok: false, message: 'Solo un socio o quien la creó puede borrarla.' }
  }

  const { data: files, error: filesError } = await supabase
    .from('marketing_task_files')
    .select('storage_path')
    .eq('tenant_id', auth.tenantId)
    .eq('task_id', id)
    .eq('kind', 'file')
  if (filesError) {
    console.error('[marketing.deleteTask.files]', filesError.message)
    return { ok: false, message: 'No pudimos borrar la tarea.' }
  }

  // Los archivos primero (la política del bucket deja a quien creó la tarea mientras la
  // tarea existe); después la fila, y la cascada se lleva el resto.
  await removeObjects(
    ((files ?? []) as Array<{ storage_path: string | null }>).flatMap((file) =>
      file.storage_path ? [file.storage_path] : [],
    ),
    'deleteTask',
  )

  const { data, error } = await supabase
    .from('marketing_tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')

  if (error) {
    console.error('[marketing.deleteTask]', error.message)
    return { ok: false, message: 'No pudimos borrar la tarea.' }
  }
  if (!data || data.length === 0) {
    return { ok: false, message: 'Solo un socio o quien la creó puede borrarla.' }
  }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'marketing_task.deleted',
    entity: 'marketing_task',
    entityId: id,
    payload: {},
  })

  revalidate(slug)
  return { ok: true }
}

/** Arrastrar: el grupo destino con el orden completo de sus tareas abiertas. */
export async function reorderTasks(
  slug: string,
  input: { groupId: string; ids: string[] },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = reorderTasksSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  // Atado al bar de la URL: alguien de dos bares no reordena el otro desde acá.
  const { data: group } = await supabase
    .from('marketing_task_groups')
    .select('id')
    .eq('id', parsed.data.groupId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (!group) {
    revalidate(slug)
    return { ok: false, message: 'Ese grupo ya no existe. Recargá la página.' }
  }

  const { data: moved, error } = await supabase.rpc('marketing_reorder_tasks', {
    p_group: parsed.data.groupId,
    p_ids: parsed.data.ids,
  })
  if (error) {
    console.error('[marketing.reorderTasks]', error.message)
    return { ok: false, message: 'No pudimos mover la tarea.' }
  }

  revalidate(slug)
  if (typeof moved === 'number' && moved !== parsed.data.ids.length) {
    return { ok: false, message: 'Algo cambió mientras arrastrabas. Fijate cómo quedó.' }
  }
  return { ok: true }
}

// ──────────────────────────────────────────────
// Grupos (solo dueños)
// ──────────────────────────────────────────────

type GroupRow = { id: string; name: string; color: string; position: number | string }

function rowToGroup(row: GroupRow): BoardGroup {
  return {
    id: row.id,
    name: row.name,
    color: (isGroupColor(row.color) ? row.color : 'forest') as GroupColor,
    position: Number(row.position) || 0,
  }
}

async function lastGroupPosition(tenantId: string): Promise<number> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('marketing_task_groups')
    .select('position')
    .eq('tenant_id', tenantId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  return Number((data as { position?: number | string } | null)?.position ?? 0) || 0
}

export async function createGroup(
  slug: string,
  input: { name: string; color: GroupColor },
): Promise<MarketingResult<{ group: BoardGroup }>> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'Los grupos los arma un socio.' }

  const parsed = createGroupSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const position = (await lastGroupPosition(auth.tenantId)) + 1
  const { data, error } = await supabase
    .from('marketing_task_groups')
    .insert({
      tenant_id: auth.tenantId,
      name: parsed.data.name,
      color: parsed.data.color,
      position,
      created_by: auth.userId,
    })
    .select('id, name, color, position')
    .single()

  if (error || !data) {
    console.error('[marketing.createGroup]', error?.message)
    return { ok: false, message: 'No pudimos crear el grupo.' }
  }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'marketing_group.created',
    entity: 'marketing_task_group',
    entityId: (data as GroupRow).id,
    payload: {},
  })

  revalidate(slug)
  return { ok: true, data: { group: rowToGroup(data as GroupRow) } }
}

/** El estado vacío: varios grupos de una (los sugeridos que se eligieron). */
export async function seedGroups(
  slug: string,
  groups: Array<{ name: string; color: GroupColor }>,
): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'Los grupos los arma un socio.' }

  const valid = groups
    .map((group) => createGroupSchema.safeParse(group))
    .flatMap((result) => (result.success ? [result.data] : []))
  if (valid.length === 0) return { ok: false, message: 'Elegí al menos un grupo.' }

  const supabase = await createClient()
  // Dos toques (o dos socios a la vez) no duplican «Eventos»: se saltea lo que ya está.
  const { data: existing, error: existingError } = await supabase
    .from('marketing_task_groups')
    .select('name')
    .eq('tenant_id', auth.tenantId)
  if (existingError) {
    console.error('[marketing.seedGroups.existing]', existingError.message)
    return { ok: false, message: 'No pudimos crear los grupos.' }
  }
  const taken = new Set(
    ((existing ?? []) as Array<{ name: string }>).map((row) => row.name.trim().toLowerCase()),
  )
  const fresh = valid.filter((group) => !taken.has(group.name.trim().toLowerCase()))
  if (fresh.length === 0) {
    revalidate(slug)
    return { ok: true }
  }

  const start = await lastGroupPosition(auth.tenantId)
  const { error } = await supabase.from('marketing_task_groups').insert(
    fresh.slice(0, 12).map((group, index) => ({
      tenant_id: auth.tenantId,
      name: group.name,
      color: group.color,
      position: start + index + 1,
      created_by: auth.userId,
    })),
  )
  if (error) {
    console.error('[marketing.seedGroups]', error.message)
    return { ok: false, message: 'No pudimos crear los grupos.' }
  }

  revalidate(slug)
  return { ok: true }
}

export async function updateGroup(
  slug: string,
  input: { id: string; name?: string; color?: GroupColor },
): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'Los grupos los arma un socio.' }

  const parsed = updateGroupSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const row: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) row.name = parsed.data.name
  if (parsed.data.color !== undefined) row.color = parsed.data.color

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_task_groups')
    .update(row)
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenantId)
    .select('id')
  if (error) {
    console.error('[marketing.updateGroup]', error.message)
    return { ok: false, message: 'No pudimos guardar el grupo.' }
  }
  if (!data || data.length === 0) return { ok: false, message: 'Ese grupo ya no existe.' }

  revalidate(slug)
  return { ok: true }
}

/** Borra el grupo y sus tareas (la pantalla lo confirma con la cantidad). */
export async function deleteGroup(slug: string, rawId: string): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'Los grupos los arma un socio.' }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: 'Ese grupo ya no existe.' }

  const supabase = await createClient()
  const { data: tasks, error: tasksError } = await supabase
    .from('marketing_tasks')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('group_id', id)
  if (tasksError) {
    console.error('[marketing.deleteGroup.tasks]', tasksError.message)
    return { ok: false, message: 'No pudimos borrar el grupo.' }
  }
  const taskIds = ((tasks ?? []) as Array<{ id: string }>).map((task) => task.id)

  let paths: string[] = []
  if (taskIds.length > 0) {
    const { data: files, error: filesError } = await supabase
      .from('marketing_task_files')
      .select('storage_path')
      .eq('tenant_id', auth.tenantId)
      .eq('kind', 'file')
      .in('task_id', taskIds)
    if (filesError) {
      console.error('[marketing.deleteGroup.files]', filesError.message)
      return { ok: false, message: 'No pudimos borrar el grupo.' }
    }
    paths = ((files ?? []) as Array<{ storage_path: string | null }>).flatMap((file) =>
      file.storage_path ? [file.storage_path] : [],
    )
  }

  // Solo dueños llegan acá: el bucket los deja borrar todo lo del bar.
  await removeObjects(paths, 'deleteGroup')

  const { data, error } = await supabase
    .from('marketing_task_groups')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')
  if (error) {
    console.error('[marketing.deleteGroup]', error.message)
    return { ok: false, message: 'No pudimos borrar el grupo.' }
  }
  if (!data || data.length === 0) return { ok: false, message: 'Ese grupo ya no existe.' }

  await logAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'marketing_group.deleted',
    entity: 'marketing_task_group',
    entityId: id,
    payload: { tasks: taskIds.length },
  })

  revalidate(slug)
  return { ok: true }
}

/** El orden de los grupos, de arriba a abajo. */
export async function reorderGroups(
  slug: string,
  input: { ids: string[] },
): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'Los grupos los arma un socio.' }

  const parsed = reorderGroupsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const results = await Promise.all(
    parsed.data.ids.map((groupId, index) =>
      supabase
        .from('marketing_task_groups')
        .update({ position: index + 1 })
        .eq('id', groupId)
        .eq('tenant_id', auth.tenantId),
    ),
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) {
    console.error('[marketing.reorderGroups]', failed.error.message)
    return { ok: false, message: 'No pudimos mover el grupo.' }
  }

  revalidate(slug)
  return { ok: true }
}

// ──────────────────────────────────────────────
// El panel: actualizaciones y archivos
// ──────────────────────────────────────────────

export async function getTaskDetail(
  slug: string,
  rawTaskId: string,
): Promise<MarketingResult<TaskDetail>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }
  const taskId = parseId(rawTaskId)
  if (!taskId) return { ok: false, message: GONE }
  const detail = await loadTaskDetail(auth.tenantId, taskId)
  if (detail === 'error') {
    return { ok: false, message: 'No pudimos traer las actualizaciones. Probá de nuevo.' }
  }
  if (!detail) return { ok: false, message: GONE }
  return { ok: true, data: detail }
}

/** Valida que cada archivo ya subido sea de ESA tarea de ESE bar y de un tipo que entra. */
function validUploads(
  files: ReadonlyArray<UploadedTaskFile>,
  tenantId: string,
  taskId: string,
): UploadedTaskFile[] | null {
  for (const file of files) {
    if (!isTaskFileMime(file.mimeType)) return null
    if (!isTaskFilePath(file.path, tenantId, taskId, file.mimeType)) return null
  }
  return [...files]
}

type InsertFilesResult = 'ok' | 'duplicate' | 'error'

async function insertFileRows(
  auth: Auth,
  taskId: string,
  updateId: string | null,
  files: ReadonlyArray<UploadedTaskFile>,
): Promise<InsertFilesResult> {
  if (files.length === 0) return 'ok'
  const supabase = await createClient()
  const { error } = await supabase.from('marketing_task_files').insert(
    files.map((file) => ({
      tenant_id: auth.tenantId,
      task_id: taskId,
      update_id: updateId,
      kind: 'file',
      storage_path: file.path,
      file_name: cleanFileName(file.fileName),
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      created_by: auth.userId,
    })),
  )
  if (error) {
    console.error('[marketing.insertFiles]', error.message)
    // 23505: una de esas rutas ya está registrada, o sea que el objeto es de otro archivo.
    return error.code === '23505' ? 'duplicate' : 'error'
  }
  return 'ok'
}

/**
 * Si el registro falla, lo que quien llama acaba de subir se borra (el bucket solo le deja
 * borrar lo suyo). Si falló porque la ruta ya era de otro archivo, no se toca nada.
 */
async function cleanupAfter(
  result: InsertFilesResult,
  files: ReadonlyArray<UploadedTaskFile>,
  op: string,
) {
  if (result !== 'error') return
  await removeObjects(
    files.map((file) => file.path),
    op,
  )
}

/**
 * Antes de subir: el servidor valida tipo y peso y da las rutas. El archivo va
 * después directo del navegador al bucket con la sesión de la persona (una
 * Server Action no puede llevar un video), y al final se registra.
 */
export async function prepareTaskUploads(
  slug: string,
  input: {
    taskId: string
    files: Array<{ fileName: string; mimeType: string; sizeBytes: number }>
  },
): Promise<MarketingResult<{ uploads: Array<{ path: string; mimeType: string }> }>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = prepareUploadsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { data: task } = await supabase
    .from('marketing_tasks')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('id', parsed.data.taskId)
    .maybeSingle()
  if (!task) return { ok: false, message: GONE }

  const uploads: Array<{ path: string; mimeType: string }> = []
  for (const file of parsed.data.files) {
    const check = checkTaskFile({ name: file.fileName, type: file.mimeType, size: file.sizeBytes })
    if (!check.ok)
      return { ok: false, message: `${cleanFileName(file.fileName)}: ${check.message}` }
    uploads.push({
      path: taskFilePath(auth.tenantId, parsed.data.taskId, randomUUID(), check.extension),
      mimeType: check.mimeType,
    })
  }
  return { ok: true, data: { uploads } }
}

/** Registra archivos ya subidos a la pestaña «Archivos» (los de una actualización van con ella). */
export async function registerTaskFiles(
  slug: string,
  input: { taskId: string; files: UploadedTaskFile[] },
): Promise<MarketingResult<{ saved: number }>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = registerFilesSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const files = validUploads(parsed.data.files, auth.tenantId, parsed.data.taskId)
  if (!files) return { ok: false, message: TASK_FILE_MESSAGES.upload }

  const inserted = await insertFileRows(auth, parsed.data.taskId, null, files)
  if (inserted !== 'ok') {
    await cleanupAfter(inserted, files, 'registerFiles')
    return { ok: false, message: 'No pudimos guardar los archivos.' }
  }

  revalidate(slug)
  return { ok: true, data: { saved: files.length } }
}

/** Una actualización (texto y/o archivos ya subidos), como en Monday. */
export async function postTaskUpdate(
  slug: string,
  input: { taskId: string; body: string; files?: UploadedTaskFile[] },
): Promise<MarketingResult<{ updateId: string }>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = postUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }
  const { taskId, body } = parsed.data

  const files = validUploads(parsed.data.files, auth.tenantId, taskId)
  if (!files) return { ok: false, message: TASK_FILE_MESSAGES.upload }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_task_updates')
    .insert({ tenant_id: auth.tenantId, task_id: taskId, author_id: auth.userId, body })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[marketing.postUpdate]', error?.message)
    await cleanupAfter('error', files, 'postUpdate')
    return {
      ok: false,
      message: error?.code === '23503' ? GONE : 'No pudimos publicar la actualización.',
    }
  }

  const updateId = (data as { id: string }).id
  const saved = await insertFileRows(auth, taskId, updateId, files)
  if (saved !== 'ok') {
    await cleanupAfter(saved, files, 'postUpdate.files')
    revalidate(slug)
    return {
      ok: false,
      message: 'Se publicó el texto, pero no los archivos. Probá subirlos de nuevo.',
    }
  }

  revalidate(slug)
  return { ok: true, data: { updateId } }
}

export async function editTaskUpdate(
  slug: string,
  input: { id: string; body: string },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = editUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_task_updates')
    .update({ body: parsed.data.body })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenantId)
    .eq('author_id', auth.userId)
    .select('id')
  if (error) {
    console.error('[marketing.editUpdate]', error.message)
    return { ok: false, message: 'No pudimos guardar la actualización.' }
  }
  if (!data || data.length === 0) {
    return { ok: false, message: 'Solo quien la escribió puede editarla.' }
  }

  revalidate(slug)
  return { ok: true }
}

/** Borra una actualización con sus archivos (los del bucket también). */
export async function deleteTaskUpdate(slug: string, rawId: string): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: 'Esa actualización ya no está.' }

  const supabase = await createClient()
  const { data: update, error: readError } = await supabase
    .from('marketing_task_updates')
    .select('task_id, author_id')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (readError) {
    console.error('[marketing.deleteUpdate.read]', readError.message)
    return { ok: false, message: 'No pudimos borrar la actualización.' }
  }
  if (!update) return { ok: false, message: 'Esa actualización ya no está.' }
  const { task_id: taskId, author_id: authorId } = update as {
    task_id: string
    author_id: string | null
  }
  if (auth.role !== 'owner' && authorId !== auth.userId) {
    return { ok: false, message: 'Solo quien la escribió o un socio puede borrarla.' }
  }

  // Sus archivos primero: solo se borran del bucket los que de verdad se borraron de la tabla.
  const { data: removedFiles, error: filesError } = await supabase
    .from('marketing_task_files')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('update_id', id)
    .select('storage_path')
  if (filesError) {
    console.error('[marketing.deleteUpdate.files]', filesError.message)
    return { ok: false, message: 'No pudimos borrar la actualización.' }
  }
  await removeObjects(
    ((removedFiles ?? []) as Array<{ storage_path: string | null }>).flatMap((file) =>
      file.storage_path ? [file.storage_path] : [],
    ),
    'deleteUpdate',
  )

  const { data, error } = await supabase
    .from('marketing_task_updates')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')
  if (error) {
    console.error('[marketing.deleteUpdate]', error.message)
    revalidate(slug)
    return { ok: false, message: 'No pudimos borrar la actualización.' }
  }
  if (!data || data.length === 0) {
    revalidate(slug)
    return { ok: false, message: 'Solo quien la escribió o un socio puede borrarla.' }
  }

  await touchTask(auth.tenantId, taskId)
  revalidate(slug)
  return { ok: true }
}

export async function addTaskLink(
  slug: string,
  input: { taskId: string; url: string; title?: string },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = addLinkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.from('marketing_task_files').insert({
    tenant_id: auth.tenantId,
    task_id: parsed.data.taskId,
    kind: 'link',
    url: parsed.data.url,
    file_name: (parsed.data.title ?? linkLabel(parsed.data.url)).slice(0, 160),
    created_by: auth.userId,
  })
  if (error) {
    console.error('[marketing.addLink]', error.message)
    return { ok: false, message: error.code === '23503' ? GONE : 'No pudimos guardar el link.' }
  }

  revalidate(slug)
  return { ok: true }
}

export async function deleteTaskFile(slug: string, rawId: string): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: 'Ese archivo ya no está.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_task_files')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('storage_path, task_id')
  if (error) {
    console.error('[marketing.deleteFile]', error.message)
    return { ok: false, message: 'No pudimos sacar el archivo.' }
  }
  if (!data || data.length === 0) {
    return { ok: false, message: 'Solo quien lo subió o un socio puede sacarlo.' }
  }

  const rows = (data ?? []) as Array<{ storage_path: string | null; task_id: string }>
  await removeObjects(
    rows.flatMap((file) => (file.storage_path ? [file.storage_path] : [])),
    'deleteFile',
  )
  const taskId = rows[0]?.task_id
  if (taskId) await touchTask(auth.tenantId, taskId)

  revalidate(slug)
  return { ok: true }
}

/** Un link firmado para bajar el archivo con su nombre de verdad (no el uuid del bucket). */
export async function getTaskFileDownloadUrl(
  slug: string,
  rawId: string,
): Promise<MarketingResult<{ url: string }>> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: 'Ese archivo ya no está.' }

  const supabase = await createClient()
  const { data } = await supabase
    .from('marketing_task_files')
    .select('storage_path, file_name')
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  const file = data as { storage_path: string | null; file_name: string } | null
  if (!file?.storage_path) return { ok: false, message: 'Ese archivo ya no está.' }

  const signed = await supabase.storage
    .from(TASK_FILES_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, { download: file.file_name })
  if (signed.error || !signed.data?.signedUrl) {
    console.error('[marketing.downloadUrl]', signed.error?.message)
    return { ok: false, message: 'No pudimos preparar la descarga.' }
  }
  return { ok: true, data: { url: signed.data.signedUrl } }
}

// ──────────────────────────────────────────────
// Rutina de la semana (Orgánico)
// ──────────────────────────────────────────────

/**
 * Tildar = insertar la fila; destildar = borrarla. El `upsert` con
 * `ignoreDuplicates` hace el tilde idempotente: dos toques rápidos en el mismo
 * casillero no rompen el unique (routine_id, week_start, slot).
 */
export async function toggleRoutineCheck(
  slug: string,
  input: { routineId: string; weekStart: string; slot: number; done: boolean },
): Promise<MarketingActionState> {
  const auth = await authorize(slug)
  if (!auth) return { ok: false, message: NO_PERMISSION }

  const parsed = routineCheckSchema.safeParse({
    routine_id: input.routineId,
    week_start: input.weekStart,
    slot: input.slot,
    done: input.done,
  })
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()

  if (parsed.data.done) {
    const { error } = await supabase.from('marketing_routine_checks').upsert(
      {
        tenant_id: auth.tenantId,
        routine_id: parsed.data.routine_id,
        week_start: parsed.data.week_start,
        slot: parsed.data.slot,
        completed_by: auth.userId,
      },
      { onConflict: 'routine_id,week_start,slot', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[marketing.checkRoutine]', error.message)
      return { ok: false, message: 'No pudimos marcar la rutina.' }
    }
  } else {
    const { error } = await supabase
      .from('marketing_routine_checks')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .eq('routine_id', parsed.data.routine_id)
      .eq('week_start', parsed.data.week_start)
      .eq('slot', parsed.data.slot)
    if (error) {
      console.error('[marketing.uncheckRoutine]', error.message)
      return { ok: false, message: 'No pudimos desmarcar la rutina.' }
    }
  }

  revalidate(slug)
  return { ok: true }
}

export async function saveRoutine(
  slug: string,
  _prev: MarketingActionState,
  formData: FormData,
): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'La rutina la arma un socio.' }

  const parsed = routineUpsertSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    description: formData.get('description'),
    slots: formData.get('slots'),
  })
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { id, ...fields } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('marketing_routines')
      .update(fields)
      .eq('id', id)
      .eq('tenant_id', auth.tenantId)
    if (error) {
      console.error('[marketing.updateRoutine]', error.message)
      return { ok: false, message: 'No pudimos guardar la rutina.' }
    }

    // Bajar el cupo (3 → 1) dejaba tildes en slots que ya no se dibujan: no se
    // podían destildar desde la UI, contaban como hechos y reaparecían si el
    // cupo volvía a subir en la misma semana.
    const { error: pruneError } = await supabase
      .from('marketing_routine_checks')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .eq('routine_id', id)
      .gte('slot', fields.slots)
    if (pruneError) {
      console.error('[marketing.pruneRoutineChecks]', pruneError.message)
    }
  } else {
    // Al fondo de la lista: el orden lo define quien la crea, no el alfabeto.
    const { data: last } = await supabase
      .from('marketing_routines')
      .select('position')
      .eq('tenant_id', auth.tenantId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('marketing_routines').insert({
      tenant_id: auth.tenantId,
      ...fields,
      position: ((last?.position as number | undefined) ?? 0) + 1,
    })
    if (error) {
      console.error('[marketing.createRoutine]', error.message)
      return { ok: false, message: 'No pudimos crear la rutina.' }
    }
  }

  revalidate(slug)
  return { ok: true }
}

export async function deleteRoutine(slug: string, rawId: string): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'La rutina la arma un socio.' }
  const id = parseId(rawId)
  if (!id) return { ok: false, message: 'Esa rutina ya no está.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_routines')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)

  if (error) {
    console.error('[marketing.deleteRoutine]', error.message)
    return { ok: false, message: 'No pudimos eliminar la rutina.' }
  }

  revalidate(slug)
  return { ok: true }
}

/**
 * Carga el checklist sugerido de una. Es el estado vacío de la rutina: en vez
 * de una pantalla en blanco, una base razonable que después se edita. No hace
 * nada si ya hay rutinas (un doble click no duplica todo).
 */
export async function seedSuggestedRoutines(slug: string): Promise<MarketingActionState> {
  const auth = await authorize(slug, MARKETING_GROUP_ROLES)
  if (!auth) return { ok: false, message: 'La rutina la arma un socio.' }

  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('marketing_routines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenantId)

  if (countError) {
    console.error('[marketing.seedRoutines.count]', countError.message)
    return { ok: false, message: 'No pudimos cargar el checklist.' }
  }
  if ((count ?? 0) > 0) return { ok: true }

  const { error } = await supabase.from('marketing_routines').insert(
    SUGGESTED_ROUTINES.map((routine, index) => ({
      tenant_id: auth.tenantId,
      title: routine.title,
      description: routine.description,
      slots: routine.slots,
      position: index,
    })),
  )

  if (error) {
    console.error('[marketing.seedRoutines]', error.message)
    return { ok: false, message: 'No pudimos cargar el checklist.' }
  }

  revalidate(slug)
  return { ok: true }
}
