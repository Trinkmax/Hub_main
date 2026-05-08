'use server'

import { revalidatePath } from 'next/cache'
import type { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { assignTagSchema, createItemTagSchema, tagIdSchema, updateItemTagSchema } from './schemas'

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
  revalidatePath(`/${slug}/configuracion/tags`)
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
  revalidatePath(`/${slug}/configuracion/tags`)
  return { ok: true, tagId: parsed.data.id }
}

export async function deleteItemTag(slug: string, id: string): Promise<TagActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tagIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('item_tags')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) {
    console.error('[item-tags.delete]', error.message)
    return { ok: false, message: 'No se pudo eliminar.' }
  }
  revalidatePath(`/${slug}/configuracion/tags`)
  return { ok: true }
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
  revalidatePath(`/${slug}/configuracion/tags`)
  return { ok: true }
}
