'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import {
  MENU_EDIT_ROLES,
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  assignTagSchema,
  bulkItemTagsSchema,
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
    requireRole(role, MENU_EDIT_ROLES)
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

  // Defensa en profundidad (además de RLS): el ítem Y el tag tienen que ser de
  // este tenant. Sin esto, un id de tag de otro bar pasaría el schema (solo
  // valida formato uuid) y quedaría a merced de la policy; validamos también acá.
  const [{ data: itemRow }, { data: tagRow }] = await Promise.all([
    supabase
      .from('menu_items')
      .select('id')
      .eq('id', parsed.data.menu_item_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
    supabase
      .from('item_tags')
      .select('id')
      .eq('id', parsed.data.tag_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
  ])
  if (!itemRow) return { ok: false, message: 'El ítem no pertenece a este bar.' }
  if (!tagRow) return { ok: false, message: 'La etiqueta no pertenece a este bar.' }

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

// Valida que un set de ids de ítems y de tags pertenezcan al tenant. Devuelve
// las listas saneadas (deduplicadas) o un mensaje de error para el caller.
async function resolveBulkTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  itemIds: string[],
  tagIds: string[],
): Promise<{ ok: true; itemIds: string[]; tagIds: string[] } | { ok: false; message: string }> {
  const items = Array.from(new Set(itemIds))
  const tags = Array.from(new Set(tagIds))

  const [{ data: validItems, error: itemsErr }, { data: validTags, error: tagsErr }] =
    await Promise.all([
      supabase.from('menu_items').select('id').eq('tenant_id', tenantId).in('id', items),
      supabase.from('item_tags').select('id').eq('tenant_id', tenantId).in('id', tags),
    ])
  if (itemsErr) {
    console.error('[item-tags.bulk] items lookup', itemsErr.message)
    return { ok: false, message: 'No pudimos validar los ítems.' }
  }
  if (tagsErr) {
    console.error('[item-tags.bulk] tags lookup', tagsErr.message)
    return { ok: false, message: 'No pudimos validar las etiquetas.' }
  }
  const okItems = (validItems ?? []).map((r) => r.id)
  const okTags = (validTags ?? []).map((r) => r.id)
  if (okItems.length === 0) return { ok: false, message: 'Ningún ítem válido.' }
  if (okTags.length !== tags.length) {
    return { ok: false, message: 'Alguna etiqueta no pertenece a este bar.' }
  }
  return { ok: true, itemIds: okItems, tagIds: okTags }
}

// Agrega (unión, no reemplaza) un set de tags a varios ítems. Idempotente:
// re-enviar el mismo payload no crea duplicados porque filtramos las
// asignaciones ya existentes antes de insertar.
export async function addTagsToItems(
  slug: string,
  payload: { item_ids: string[]; tag_ids: string[] },
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = bulkItemTagsSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const resolved = await resolveBulkTargets(
    supabase,
    access.tenant.id,
    parsed.data.item_ids,
    parsed.data.tag_ids,
  )
  if (!resolved.ok) return { ok: false, message: resolved.message }

  // Leemos las asignaciones ya existentes para insertar sólo las que faltan.
  const { data: existing, error: exErr } = await supabase
    .from('menu_item_tag_assignments')
    .select('menu_item_id, tag_id')
    .in('menu_item_id', resolved.itemIds)
    .in('tag_id', resolved.tagIds)
  if (exErr) {
    console.error('[item-tags.addTagsToItems] existing', exErr.message)
    return { ok: false, message: 'No pudimos leer las asignaciones actuales.' }
  }
  const existingSet = new Set((existing ?? []).map((r) => `${r.menu_item_id}:${r.tag_id}`))

  const rows: Array<{ menu_item_id: string; tag_id: string }> = []
  for (const itemId of resolved.itemIds) {
    for (const tagId of resolved.tagIds) {
      if (!existingSet.has(`${itemId}:${tagId}`)) {
        rows.push({ menu_item_id: itemId, tag_id: tagId })
      }
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('menu_item_tag_assignments').insert(rows)
    if (insErr && !insErr.message.includes('duplicate')) {
      console.error('[item-tags.addTagsToItems] insert', insErr.message)
      return { ok: false, message: 'No pudimos asignar las etiquetas.' }
    }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'item_tag.bulk_assigned',
    entity: 'menu_item',
    entityId: null,
    payload: {
      item_ids: resolved.itemIds,
      tag_ids: resolved.tagIds,
      added: rows.length,
    },
  })

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return {
    ok: true,
    message:
      rows.length > 0
        ? `Etiquetas agregadas a ${resolved.itemIds.length} ítem${resolved.itemIds.length === 1 ? '' : 's'}.`
        : 'Los ítems ya tenían esas etiquetas.',
  }
}

// Quita un set de tags de varios ítems. Idempotente: si una asignación no
// existe, el delete simplemente no afecta filas.
export async function removeTagsFromItems(
  slug: string,
  payload: { item_ids: string[]; tag_ids: string[] },
): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = bulkItemTagsSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const resolved = await resolveBulkTargets(
    supabase,
    access.tenant.id,
    parsed.data.item_ids,
    parsed.data.tag_ids,
  )
  if (!resolved.ok) return { ok: false, message: resolved.message }

  const { error } = await supabase
    .from('menu_item_tag_assignments')
    .delete()
    .in('menu_item_id', resolved.itemIds)
    .in('tag_id', resolved.tagIds)
  if (error) {
    console.error('[item-tags.removeTagsFromItems] delete', error.message)
    return { ok: false, message: 'No pudimos quitar las etiquetas.' }
  }

  const { data: userResult } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'item_tag.bulk_unassigned',
    entity: 'menu_item',
    entityId: null,
    payload: { item_ids: resolved.itemIds, tag_ids: resolved.tagIds },
  })

  revalidatePath(`/${slug}/menu/tags`)
  revalidatePath(`/${slug}/menu`)
  return {
    ok: true,
    message: `Etiquetas quitadas de ${resolved.itemIds.length} ítem${resolved.itemIds.length === 1 ? '' : 's'}.`,
  }
}
