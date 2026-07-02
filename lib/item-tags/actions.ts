'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  assignTagSchema,
  createItemTagSchema,
  setItemTagsSchema,
  tagIdSchema,
  updateItemTagSchema,
} from './schemas'

export type TagActionState =
  | { ok: true; message?: string; tagId?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner'])
    return { tenant, role }
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

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function createItemTag(
  slug: string,
  _prev: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createItemTagSchema.safeParse({
    name: formData.get('name'),
    color: formData.get('color') ?? '#94a3b8',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('item_tags')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error?.message.includes('unique'))
      return { ok: false, message: 'Ya existe un tag con ese nombre.' }
    console.error('[item-tags.create]', error?.message)
    return { ok: false, message: 'No se pudo crear el tag.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'item_tag.created',
    entity: 'item_tag',
    entityId: data.id,
    payload: { name: parsed.data.name, color: parsed.data.color },
  })

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return { ok: true, tagId: data.id }
}

export async function updateItemTag(
  slug: string,
  _prev: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateItemTagSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    color: formData.get('color'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('item_tags')
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) {
    console.error('[item-tags.update]', error.message)
    return { ok: false, message: 'No se pudo actualizar.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'item_tag.updated',
    entity: 'item_tag',
    entityId: parsed.data.id,
    payload: { name: parsed.data.name, color: parsed.data.color },
  })

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return { ok: true, tagId: parsed.data.id }
}

export async function deleteItemTag(slug: string, id: string): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tagIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()

  // Contamos assignments antes de borrar para incluirlo en el audit.
  // El delete de item_tags cascadea las asignaciones por FK on delete cascade,
  // así que la operación procede igual; solo informamos al dueño.
  const { count: assignedCount } = await supabase
    .from('menu_item_tag_assignments')
    .select('tag_id', { count: 'exact', head: true })
    .eq('tag_id', parsed.data.id)

  const { error } = await supabase
    .from('item_tags')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) {
    console.error('[item-tags.delete]', error.message)
    return { ok: false, message: 'No se pudo eliminar.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'item_tag.deleted',
    entity: 'item_tag',
    entityId: parsed.data.id,
    payload: { assignments_removed: assignedCount ?? 0 },
  })

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return {
    ok: true,
    message:
      (assignedCount ?? 0) > 0
        ? `Tag eliminado. Se quitó de ${assignedCount} ítems.`
        : 'Tag eliminado.',
  }
}

export async function toggleTagOnMenuItem(
  slug: string,
  menuItemId: string,
  tagId: string,
  enable: boolean,
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = assignTagSchema.safeParse({ menu_item_id: menuItemId, tag_id: tagId })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  if (enable) {
    const { error } = await supabase
      .from('menu_item_tag_assignments')
      .insert({ menu_item_id: parsed.data.menu_item_id, tag_id: parsed.data.tag_id })
    if (error && !error.message.includes('duplicate')) {
      console.error('[item-tags.assign]', error.message)
      return { ok: false, message: 'No se pudo asignar.' }
    }
  } else {
    const { error } = await supabase
      .from('menu_item_tag_assignments')
      .delete()
      .eq('menu_item_id', parsed.data.menu_item_id)
      .eq('tag_id', parsed.data.tag_id)
    if (error) {
      console.error('[item-tags.unassign]', error.message)
      return { ok: false, message: 'No se pudo desasignar.' }
    }
  }
  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}

// Reemplaza el set completo de tags de un ítem con la lista entregada.
// Approach diff (no DELETE-then-INSERT): calculamos to_add y to_remove para
// evitar dejar el ítem sin tags si el insert falla a mitad. supabase-js no
// expone transacciones desde el cliente, así que el delta minimiza la ventana
// de inconsistencia y hace la operación idempotente (re-enviar el mismo
// payload no produce cambios).
export async function setItemTags(
  slug: string,
  payload: { menu_item_id: string; tag_ids: string[] },
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = setItemTagsSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()

  // 1. Verificar que el ítem es del tenant.
  const { data: menuItem, error: itemErr } = await supabase
    .from('menu_items')
    .select('id, tenant_id')
    .eq('id', parsed.data.menu_item_id)
    .eq('tenant_id', access.tenant.id)
    .maybeSingle()
  if (itemErr) {
    console.error('[item-tags.setItemTags] item lookup', itemErr.message)
    return { ok: false, message: 'No pudimos validar el ítem.' }
  }
  if (!menuItem) return { ok: false, message: 'El ítem no existe o no pertenece a este bar.' }

  // 2. Validar que todos los tag_ids son del tenant (si vienen).
  const desired = Array.from(new Set(parsed.data.tag_ids))
  if (desired.length > 0) {
    const { data: validTags, error: tagsErr } = await supabase
      .from('item_tags')
      .select('id')
      .eq('tenant_id', access.tenant.id)
      .in('id', desired)
    if (tagsErr) {
      console.error('[item-tags.setItemTags] tags lookup', tagsErr.message)
      return { ok: false, message: 'No pudimos validar los tags.' }
    }
    if (!validTags || validTags.length !== desired.length) {
      return { ok: false, message: 'Algún tag no pertenece a este bar.' }
    }
  }

  // 3. Leer assignments actuales del ítem.
  const { data: currentRows, error: currErr } = await supabase
    .from('menu_item_tag_assignments')
    .select('tag_id')
    .eq('menu_item_id', parsed.data.menu_item_id)
  if (currErr) {
    console.error('[item-tags.setItemTags] current', currErr.message)
    return { ok: false, message: 'No pudimos leer las asignaciones actuales.' }
  }
  const current = new Set((currentRows ?? []).map((r) => r.tag_id))
  const desiredSet = new Set(desired)

  const toAdd: string[] = desired.filter((id) => !current.has(id))
  const toRemove: string[] = Array.from(current).filter((id) => !desiredSet.has(id))

  // 4. Quitar primero (no genera duplicados), después agregar.
  if (toRemove.length > 0) {
    const { error: delErr } = await supabase
      .from('menu_item_tag_assignments')
      .delete()
      .eq('menu_item_id', parsed.data.menu_item_id)
      .in('tag_id', toRemove)
    if (delErr) {
      console.error('[item-tags.setItemTags] delete', delErr.message)
      return { ok: false, message: 'No pudimos actualizar las asignaciones.' }
    }
  }
  if (toAdd.length > 0) {
    const rows = toAdd.map((tag_id) => ({
      menu_item_id: parsed.data.menu_item_id,
      tag_id,
    }))
    const { error: insErr } = await supabase.from('menu_item_tag_assignments').insert(rows)
    if (insErr && !insErr.message.includes('duplicate')) {
      console.error('[item-tags.setItemTags] insert', insErr.message)
      return { ok: false, message: 'No pudimos agregar las nuevas asignaciones.' }
    }
  }

  // Solo loguear si efectivamente hubo cambios.
  if (toAdd.length > 0 || toRemove.length > 0) {
    const { data: userResult } = await supabase.auth.getUser()
    await logAudit({
      tenantId: access.tenant.id,
      userId: userResult.user?.id ?? null,
      action: 'item_tag.assignments_set',
      entity: 'menu_item',
      entityId: parsed.data.menu_item_id,
      payload: { added: toAdd, removed: toRemove, desired },
    })
  }

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return { ok: true }
}
