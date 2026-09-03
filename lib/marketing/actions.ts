'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { SUGGESTED_ROUTINES, type TaskStatus } from './constants'
import {
  marketingTaskCreateSchema,
  marketingTaskStatusSchema,
  marketingTaskUpdateSchema,
  routineCheckSchema,
  routineUpsertSchema,
} from './schemas'

export type MarketingActionState = { ok: true } | { ok: false; message: string }

/**
 * El tablero es de los socios. `owner` y nadie más: el staff de salón no tiene
 * nada que hacer acá y las policies de la DB enforcean exactamente esto.
 */
async function authorizeOwner(slug: string) {
  try {
    const { tenant, role, user } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, userId: user.id }
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

function readTaskForm(formData: FormData) {
  return {
    title: formData.get('title'),
    category: formData.get('category'),
    kind: formData.get('kind'),
    status: formData.get('status'),
    specifications: formData.get('specifications'),
    notes: formData.get('notes'),
    file_url: formData.get('file_url'),
    responsible_user_id: formData.get('responsible_user_id'),
    involved_user_id: formData.get('involved_user_id'),
    ideal_date: formData.get('ideal_date'),
    defined_date: formData.get('defined_date'),
  }
}

/** Marcar "Terminado" congela el cuándo y el quién; volver atrás lo limpia. */
function completionFields(status: TaskStatus, userId: string) {
  return status === 'done'
    ? { completed_at: new Date().toISOString(), completed_by: userId }
    : { completed_at: null, completed_by: null }
}

function revalidate(slug: string) {
  revalidatePath(`/${slug}/tareas`)
}

// ──────────────────────────────────────────────
// Tareas
// ──────────────────────────────────────────────

export async function createMarketingTask(
  slug: string,
  _prev: MarketingActionState,
  formData: FormData,
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = marketingTaskCreateSchema.safeParse(readTaskForm(formData))
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('marketing_tasks')
    .insert({
      tenant_id: auth.tenant.id,
      ...parsed.data,
      ...completionFields(parsed.data.status, auth.userId),
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[marketing.createTask]', error.message)
    return { ok: false, message: 'No pudimos crear la tarea.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'marketing_task.created',
    entity: 'marketing_task',
    entityId: data.id,
    payload: { category: parsed.data.category, kind: parsed.data.kind },
  })

  revalidate(slug)
  return { ok: true }
}

export async function updateMarketingTask(
  slug: string,
  _prev: MarketingActionState,
  formData: FormData,
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = marketingTaskUpdateSchema.safeParse({
    ...readTaskForm(formData),
    id: formData.get('id'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const { id, ...fields } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_tasks')
    .update({ ...fields, ...completionFields(fields.status, auth.userId) })
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[marketing.updateTask]', error.message)
    return { ok: false, message: 'No pudimos guardar los cambios.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'marketing_task.updated',
    entity: 'marketing_task',
    entityId: id,
    payload: { category: fields.category, status: fields.status },
  })

  revalidate(slug)
  return { ok: true }
}

/**
 * El cambio de estado desde la tarjeta. Va aparte del update completo porque
 * es el gesto más frecuente del tablero (y el que se hace optimista en la UI).
 */
export async function setMarketingTaskStatus(
  slug: string,
  input: { id: string; status: TaskStatus },
): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = marketingTaskStatusSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_tasks')
    .update({
      status: parsed.data.status,
      ...completionFields(parsed.data.status, auth.userId),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[marketing.setStatus]', error.message)
    return { ok: false, message: 'No pudimos cambiar el estado.' }
  }

  revalidate(slug)
  return { ok: true }
}

export async function deleteMarketingTask(slug: string, id: string): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[marketing.deleteTask]', error.message)
    return { ok: false, message: 'No pudimos eliminar la tarea.' }
  }

  await logAudit({
    tenantId: auth.tenant.id,
    userId: auth.userId,
    action: 'marketing_task.deleted',
    entity: 'marketing_task',
    entityId: id,
    payload: {},
  })

  revalidate(slug)
  return { ok: true }
}

// ──────────────────────────────────────────────
// Checklist semanal
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
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = routineCheckSchema.safeParse({
    routine_id: input.routineId,
    week_start: input.weekStart,
    slot: input.slot,
    done: input.done,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()

  if (parsed.data.done) {
    const { error } = await supabase.from('marketing_routine_checks').upsert(
      {
        tenant_id: auth.tenant.id,
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
      .eq('tenant_id', auth.tenant.id)
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
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const parsed = routineUpsertSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    description: formData.get('description'),
    slots: formData.get('slots'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { id, ...fields } = parsed.data

  if (id) {
    const { error } = await supabase
      .from('marketing_routines')
      .update(fields)
      .eq('id', id)
      .eq('tenant_id', auth.tenant.id)
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
      .eq('tenant_id', auth.tenant.id)
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
      .eq('tenant_id', auth.tenant.id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('marketing_routines').insert({
      tenant_id: auth.tenant.id,
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

export async function deleteRoutine(slug: string, id: string): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('marketing_routines')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenant.id)

  if (error) {
    console.error('[marketing.deleteRoutine]', error.message)
    return { ok: false, message: 'No pudimos eliminar la rutina.' }
  }

  revalidate(slug)
  return { ok: true }
}

/**
 * Carga el checklist sugerido de una. Es el estado vacío de Orgánico: en vez
 * de mirar una pantalla en blanco y tener que inventar 11 rutinas, el bar
 * arranca con una base razonable y después la edita.
 *
 * No hace nada si ya hay rutinas cargadas — el botón sólo existe cuando la
 * lista está vacía, pero un doble click no puede duplicar todo.
 */
export async function seedSuggestedRoutines(slug: string): Promise<MarketingActionState> {
  const auth = await authorizeOwner(slug)
  if (!auth) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('marketing_routines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenant.id)

  if (countError) {
    console.error('[marketing.seedRoutines.count]', countError.message)
    return { ok: false, message: 'No pudimos cargar el checklist.' }
  }
  if ((count ?? 0) > 0) return { ok: true }

  const { error } = await supabase.from('marketing_routines').insert(
    SUGGESTED_ROUTINES.map((routine, index) => ({
      tenant_id: auth.tenant.id,
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
