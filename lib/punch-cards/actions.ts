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
  createPunchCardSchema,
  lunchVisitSchema,
  punchCardIdSchema,
  updatePunchCardSchema,
} from './schemas'

export type PunchCardActionState =
  | { ok: true; message?: string; templateId?: string }
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

async function authorizeStaff(slug: string) {
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

function flattenIssues(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function createPunchCard(
  slug: string,
  _prev: PunchCardActionState,
  formData: FormData,
): Promise<PunchCardActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const triggerType = formData.get('trigger_type')
  const configRaw = formData.get('config')
  let configParsed: unknown
  if (typeof configRaw === 'string' && configRaw.length > 0) {
    try {
      configParsed = JSON.parse(configRaw)
    } catch {
      return { ok: false, message: 'Configuración inválida.' }
    }
  }
  const parsed = createPunchCardSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    image_url: formData.get('image_url') || null,
    trigger_type: triggerType,
    trigger_ref_id: triggerType === 'visit_window' ? null : formData.get('trigger_ref_id') || null,
    threshold: formData.get('threshold'),
    reward_id: formData.get('reward_id'),
    expires_after_days: formData.get('expires_after_days') || null,
    config: configParsed,
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
    .from('punch_card_templates')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      image_url: parsed.data.image_url ?? null,
      trigger_type: parsed.data.trigger_type,
      trigger_ref_id: parsed.data.trigger_ref_id ?? null,
      threshold: parsed.data.threshold,
      reward_id: parsed.data.reward_id,
      expires_after_days: parsed.data.expires_after_days ?? null,
      config: parsed.data.config ?? {},
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[punch-cards.create]', error?.message)
    return { ok: false, message: 'No se pudo crear la card.' }
  }
  revalidatePath(`/${slug}/punch-cards`)
  return { ok: true, templateId: data.id }
}

export async function updatePunchCard(
  slug: string,
  _prev: PunchCardActionState,
  formData: FormData,
): Promise<PunchCardActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const triggerType = formData.get('trigger_type')
  const configRaw = formData.get('config')
  let configParsed: unknown
  if (typeof configRaw === 'string' && configRaw.length > 0) {
    try {
      configParsed = JSON.parse(configRaw)
    } catch {
      return { ok: false, message: 'Configuración inválida.' }
    }
  }
  const parsed = updatePunchCardSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    description: formData.get('description'),
    image_url: formData.get('image_url') || null,
    trigger_type: triggerType,
    trigger_ref_id: triggerType === 'visit_window' ? null : formData.get('trigger_ref_id') || null,
    threshold: formData.get('threshold'),
    reward_id: formData.get('reward_id'),
    expires_after_days: formData.get('expires_after_days') || null,
    active: formData.get('active') === 'on',
    config: configParsed,
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
    .from('punch_card_templates')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      image_url: parsed.data.image_url ?? null,
      trigger_type: parsed.data.trigger_type,
      trigger_ref_id: parsed.data.trigger_ref_id ?? null,
      threshold: parsed.data.threshold,
      reward_id: parsed.data.reward_id,
      expires_after_days: parsed.data.expires_after_days ?? null,
      active: parsed.data.active,
      config: parsed.data.config ?? {},
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) {
    console.error('[punch-cards.update]', error.message)
    return { ok: false, message: 'No se pudo actualizar.' }
  }
  revalidatePath(`/${slug}/punch-cards`)
  return { ok: true, templateId: parsed.data.id }
}

export async function registerLunchVisit(
  slug: string,
  payload: { customer_id: string; template_id: string },
): Promise<
  | {
      ok: true
      current_stamps: number
      threshold: number
      completed: boolean
      reward_name: string | null
    }
  | { ok: false; message: string }
> {
  const access = await authorizeStaff(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = lunchVisitSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('register_lunch_visit', {
    p_customer_id: parsed.data.customer_id,
    p_template_id: parsed.data.template_id,
  })
  if (error) {
    const code = error.message
    if (code.includes('outside_window')) {
      return { ok: false, message: 'Fuera del horario configurado.' }
    }
    if (code.includes('wrong_day_of_week')) {
      return { ok: false, message: 'No se marcan almuerzos hoy.' }
    }
    if (code.includes('already_stamped_today')) {
      return { ok: false, message: 'Ya marcó su almuerzo hoy.' }
    }
    if (code.includes('template_not_found')) {
      return { ok: false, message: 'La tarjeta no está activa.' }
    }
    console.error('[punch-cards.lunch]', error.message)
    return { ok: false, message: 'No pudimos registrar el almuerzo.' }
  }

  const result = (data ?? {}) as {
    current_stamps?: number
    threshold?: number
    completed?: boolean
    reward_name?: string | null
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'punch_card.lunch_registered',
    entity: 'customer',
    entityId: parsed.data.customer_id,
    payload: { template_id: parsed.data.template_id },
  })

  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)
  return {
    ok: true,
    current_stamps: result.current_stamps ?? 0,
    threshold: result.threshold ?? 0,
    completed: Boolean(result.completed),
    reward_name: result.reward_name ?? null,
  }
}

export async function deletePunchCard(slug: string, id: string): Promise<PunchCardActionState> {
  const access = await authorize(slug)
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = punchCardIdSchema.safeParse({ id })
  if (!parsed.success) return { ok: false, message: 'Id inválido.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('punch_card_templates')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) {
    if (error.message.includes('foreign key')) {
      return {
        ok: false,
        message: 'Hay clientes con cards activas. Desactivá la card en lugar de eliminarla.',
      }
    }
    console.error('[punch-cards.delete]', error.message)
    return { ok: false, message: 'No se pudo eliminar.' }
  }
  revalidatePath(`/${slug}/configuracion/punch-cards`)
  return { ok: true }
}
