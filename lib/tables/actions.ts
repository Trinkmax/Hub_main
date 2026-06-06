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
import { createTableSchema, tableIdSchema, updateTableSchema } from './schemas'

export type TableActionState =
  | { ok: true; message?: string; tableId?: string; qrToken?: string }
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

export async function createTable(
  slug: string,
  _prev: TableActionState,
  formData: FormData,
): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createTableSchema.safeParse({
    label: formData.get('label'),
    capacity: formData.get('capacity'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase
    .from('physical_tables')
    .insert({
      tenant_id: access.tenant.id,
      label: parsed.data.label,
      capacity: parsed.data.capacity,
    })
    .select('id, qr_token')
    .single()

  if (error || !data) {
    console.error('[tables.createTable]', error?.message)
    return { ok: false, message: 'No se pudo crear la mesa.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'create',
    entity: 'physical_table',
    entityId: data.id,
    payload: { label: parsed.data.label, capacity: parsed.data.capacity },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, tableId: data.id, qrToken: data.qr_token }
}

export async function updateTable(
  slug: string,
  _prev: TableActionState,
  formData: FormData,
): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateTableSchema.safeParse({
    id: formData.get('id'),
    label: formData.get('label'),
    capacity: formData.get('capacity'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { error } = await supabase
    .from('physical_tables')
    .update({
      label: parsed.data.label,
      capacity: parsed.data.capacity,
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[tables.updateTable]', error.message)
    return { ok: false, message: 'No se pudo actualizar la mesa.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'update',
    entity: 'physical_table',
    entityId: parsed.data.id,
    payload: { label: parsed.data.label, capacity: parsed.data.capacity },
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, tableId: parsed.data.id }
}

export async function deleteTable(slug: string, id: string): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tableIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { error } = await supabase
    .from('physical_tables')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) {
    console.error('[tables.deleteTable]', error.message)
    return { ok: false, message: 'No se pudo eliminar la mesa.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'delete',
    entity: 'physical_table',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, tableId: parsed.data.id }
}

export async function regenerateQrToken(slug: string, id: string): Promise<TableActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tableIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'No autenticado.' }

  const { data, error } = await supabase.rpc('regenerate_qr_token', { p_table_id: parsed.data.id })

  if (error) {
    console.error('[tables.regenerateQrToken]', error.message)
    return { ok: false, message: 'No se pudo regenerar el QR.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.id,
    action: 'regenerate_qr',
    entity: 'physical_table',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/local/mesas`)
  return { ok: true, tableId: parsed.data.id, qrToken: data ?? undefined }
}
