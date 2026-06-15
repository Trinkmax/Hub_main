'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { createConversationTagSchema, setConversationTagsSchema, tagIdSchema } from './schemas'

export type ConversationTagActionState = { ok: true } | { ok: false; message: string }

async function authorizeOwnerCashier(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier'])
    return tenant
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

async function authorizeMember(slug: string) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, ['owner', 'cashier', 'waiter'])
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

export async function createConversationTag(
  slug: string,
  _prev: ConversationTagActionState,
  formData: FormData,
): Promise<ConversationTagActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createConversationTagSchema.safeParse({
    name: formData.get('name'),
    color: formData.get('color') ?? '#94a3b8',
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { error } = await supabase.from('conversation_tags').insert({
    tenant_id: tenant.id,
    name: parsed.data.name,
    color: parsed.data.color,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe una etiqueta con ese nombre.' }
    }
    console.error('[conversation-tags.create]', error.message)
    return { ok: false, message: 'No pudimos crear la etiqueta.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'conversation_tag.created',
    entity: 'conversation_tag',
    payload: { name: parsed.data.name, color: parsed.data.color },
  })

  revalidatePath(`/${slug}/bandeja`)
  return { ok: true }
}

export async function deleteConversationTag(
  slug: string,
  _prev: ConversationTagActionState,
  formData: FormData,
): Promise<ConversationTagActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tagIdSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('conversation_tags')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) {
    console.error('[conversation-tags.delete]', error.message)
    return { ok: false, message: 'No pudimos borrar la etiqueta.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'conversation_tag.deleted',
    entity: 'conversation_tag',
    entityId: parsed.data.id,
    payload: {},
  })

  revalidatePath(`/${slug}/bandeja`)
  return { ok: true }
}

/**
 * Reemplaza el set completo de tags asignados a una conversación.
 * Permite cualquier miembro del tenant (owner/cashier/waiter).
 * Valida que la conversación pertenece al tenant usando service client.
 */
export async function setConversationTags(
  slug: string,
  conversationId: string,
  tagIds: string[],
): Promise<ConversationTagActionState> {
  const access = await authorizeMember(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = setConversationTagsSchema.safeParse({
    conversation_id: conversationId,
    tag_ids: tagIds,
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
  }

  // Verificar que la conversación pertenece al tenant (service client para bypass RLS check cruzado)
  const service = createServiceClient()
  const { data: conv, error: convErr } = await service
    .from('conversations')
    .select('id, tenant_id')
    .eq('id', parsed.data.conversation_id)
    .eq('tenant_id', access.tenant.id)
    .maybeSingle()

  if (convErr) {
    console.error('[conversation-tags.setTags] conv lookup', convErr.message)
    return { ok: false, message: 'No pudimos validar la conversación.' }
  }
  if (!conv) return { ok: false, message: 'La conversación no existe o no pertenece a este bar.' }

  // Validar que todos los tag_ids son del tenant
  const desired = Array.from(new Set(parsed.data.tag_ids))
  if (desired.length > 0) {
    const { data: validTags, error: tagsErr } = await service
      .from('conversation_tags')
      .select('id')
      .eq('tenant_id', access.tenant.id)
      .in('id', desired)

    if (tagsErr) {
      console.error('[conversation-tags.setTags] tags lookup', tagsErr.message)
      return { ok: false, message: 'No pudimos validar las etiquetas.' }
    }
    if (!validTags || validTags.length !== desired.length) {
      return { ok: false, message: 'Alguna etiqueta no pertenece a este bar.' }
    }
  }

  // Leer assignments actuales
  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()
  const userId = userResult.user?.id ?? null

  const { data: currentRows, error: currErr } = await supabase
    .from('conversation_tag_assignments')
    .select('tag_id')
    .eq('conversation_id', parsed.data.conversation_id)

  if (currErr) {
    console.error('[conversation-tags.setTags] current', currErr.message)
    return { ok: false, message: 'No pudimos leer las asignaciones actuales.' }
  }

  const current = new Set((currentRows ?? []).map((r) => r.tag_id))
  const desiredSet = new Set(desired)

  const toAdd = desired.filter((id) => !current.has(id))
  const toRemove = Array.from(current).filter((id) => !desiredSet.has(id))

  // Quitar primero, después agregar
  if (toRemove.length > 0) {
    const { error: delErr } = await supabase
      .from('conversation_tag_assignments')
      .delete()
      .eq('conversation_id', parsed.data.conversation_id)
      .in('tag_id', toRemove)

    if (delErr) {
      console.error('[conversation-tags.setTags] delete', delErr.message)
      return { ok: false, message: 'No pudimos actualizar las etiquetas.' }
    }
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((tag_id) => ({
      conversation_id: parsed.data.conversation_id,
      tag_id,
      assigned_by: userId,
    }))
    const { error: insErr } = await supabase.from('conversation_tag_assignments').insert(rows)

    if (insErr && insErr.code !== '23505') {
      console.error('[conversation-tags.setTags] insert', insErr.message)
      return { ok: false, message: 'No pudimos agregar las etiquetas.' }
    }
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await logAudit({
      tenantId: access.tenant.id,
      userId,
      action: 'conversation_tag.assignments_set',
      entity: 'conversation',
      entityId: parsed.data.conversation_id,
      payload: { added: toAdd, removed: toRemove, desired },
    })
  }

  revalidatePath(`/${slug}/bandeja`)
  return { ok: true }
}
