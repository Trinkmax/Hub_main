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
import { quickMessageCreateSchema, quickMessageUpdateSchema } from './schemas'

export type QuickMessageActionState = { ok: true } | { ok: false; message: string }

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

export async function createQuickMessage(
  slug: string,
  _prev: QuickMessageActionState,
  formData: FormData,
): Promise<QuickMessageActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = quickMessageCreateSchema.safeParse({
    title: formData.get('title'),
    shortcut: formData.get('shortcut'),
    body: formData.get('body'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('quick_messages')
    .insert({
      tenant_id: tenant.id,
      title: parsed.data.title,
      shortcut: parsed.data.shortcut,
      body: parsed.data.body,
      created_by: userResult.user?.id ?? null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe un mensaje rápido con ese atajo.' }
    }
    console.error('[quick-messages.create]', error.message)
    return { ok: false, message: 'No pudimos crear el mensaje rápido.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'quick_message.created',
    entity: 'quick_message',
    entityId: data.id,
    payload: { title: parsed.data.title, shortcut: parsed.data.shortcut },
  })

  revalidatePath(`/${slug}/configuracion/mensajes-rapidos`)
  return { ok: true }
}

export async function updateQuickMessage(
  slug: string,
  _prev: QuickMessageActionState,
  formData: FormData,
): Promise<QuickMessageActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const parsed = quickMessageUpdateSchema.safeParse({
    id: formData.get('id'),
    title: formData.get('title'),
    shortcut: formData.get('shortcut'),
    body: formData.get('body'),
  })
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('quick_messages')
    .update({
      title: parsed.data.title,
      shortcut: parsed.data.shortcut,
      body: parsed.data.body,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', tenant.id)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'Ya existe un mensaje rápido con ese atajo.' }
    }
    console.error('[quick-messages.update]', error.message)
    return { ok: false, message: 'No pudimos actualizar el mensaje rápido.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'quick_message.updated',
    entity: 'quick_message',
    entityId: parsed.data.id,
    payload: { title: parsed.data.title, shortcut: parsed.data.shortcut },
  })

  revalidatePath(`/${slug}/configuracion/mensajes-rapidos`)
  return { ok: true }
}

export async function deleteQuickMessage(
  slug: string,
  id: string,
): Promise<QuickMessageActionState> {
  const tenant = await authorizeOwnerCashier(slug)
  if (!tenant) return { ok: false, message: 'No tenés permiso.' }

  const supabase = await createClient()
  const { data: userResult } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('quick_messages')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id)

  if (error) {
    console.error('[quick-messages.delete]', error.message)
    return { ok: false, message: 'No pudimos eliminar el mensaje rápido.' }
  }

  await logAudit({
    tenantId: tenant.id,
    userId: userResult.user?.id ?? null,
    action: 'quick_message.deleted',
    entity: 'quick_message',
    entityId: id,
    payload: {},
  })

  revalidatePath(`/${slug}/configuracion/mensajes-rapidos`)
  return { ok: true }
}
