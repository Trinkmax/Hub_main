'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { getRequestIp } from '@/lib/ip'
import { createClient } from '@/lib/supabase/server'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import {
  createCustomerSchema,
  customerIdSchema,
  tagAssignmentSchema,
  updateCustomerSchema,
} from './schemas'

export type CustomerActionState =
  | { ok: true; message?: string; customerId?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

async function authorize(slug: string, allowed: ReadonlyArray<'owner' | 'cashier' | 'waiter'>) {
  try {
    const { tenant, role } = await requireTenantAccess(slug)
    requireRole(role, allowed)
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

export async function createCustomer(
  slug: string,
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const access = await authorize(slug, ['owner', 'cashier', 'waiter'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = createCustomerSchema.safeParse({
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, message: 'No autenticado.' }

  const ip = await getRequestIp()

  // Dedupe: si ya existe activo, redirige a su ficha en vez de crear duplicado.
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', access.tenant.id)
    .eq('phone', parsed.data.phone)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    revalidatePath(`/${slug}/clientes`)
    return {
      ok: true,
      message: 'Ya existía un cliente con ese teléfono.',
      customerId: existing.id,
    }
  }

  const { data: created, error } = await supabase
    .from('customers')
    .insert({
      tenant_id: access.tenant.id,
      phone: parsed.data.phone,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      source: 'manual',
      opt_in_marketing: parsed.data.opt_in_marketing,
      opt_in_at: parsed.data.opt_in_marketing ? new Date().toISOString() : null,
      opt_in_ip: parsed.data.opt_in_marketing ? ip : null,
    })
    .select('id')
    .single()

  if (error || !created) {
    return { ok: false, message: 'No pudimos crear el cliente.' }
  }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.user.id,
    action: 'customer.created',
    entity: 'customer',
    entityId: created.id,
    payload: { source: 'manual' },
  })

  revalidatePath(`/${slug}/clientes`)
  return { ok: true, message: 'Cliente creado.', customerId: created.id }
}

export async function createCustomerAndRedirect(
  slug: string,
  prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const result = await createCustomer(slug, prev, formData)
  if (result.ok && result.customerId) {
    redirect(`/${slug}/clientes/${result.customerId}`)
  }
  return result
}

export async function updateCustomer(
  slug: string,
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const access = await authorize(slug, ['owner', 'cashier'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = updateCustomerSchema.safeParse({
    id: formData.get('id'),
    phone: formData.get('phone'),
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    notes: formData.get('notes'),
    birthdate: formData.get('birthdate'),
    opt_in_marketing: formData.get('opt_in_marketing') === 'on',
  })
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos',
      fieldErrors: flattenIssues(parsed.error),
    }
  }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, message: 'No autenticado.' }

  const ip = await getRequestIp()

  // Si pasa de no-opt-in a opt-in marcamos timestamp + IP
  const { data: current } = await supabase
    .from('customers')
    .select('opt_in_marketing')
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!current) return { ok: false, message: 'Cliente no encontrado.' }

  const becomingOptIn = !current.opt_in_marketing && parsed.data.opt_in_marketing

  const { error } = await supabase
    .from('customers')
    .update({
      phone: parsed.data.phone,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      notes: parsed.data.notes ?? null,
      birthdate: parsed.data.birthdate,
      opt_in_marketing: parsed.data.opt_in_marketing,
      ...(becomingOptIn ? { opt_in_at: new Date().toISOString(), opt_in_ip: ip } : {}),
    })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)

  if (error) return { ok: false, message: 'No pudimos guardar.' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.user.id,
    action: 'customer.updated',
    entity: 'customer',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/clientes`)
  revalidatePath(`/${slug}/clientes/${parsed.data.id}`)
  return { ok: true, message: 'Guardado.' }
}

export async function softDeleteCustomer(
  slug: string,
  customerId: string,
): Promise<CustomerActionState> {
  const access = await authorize(slug, ['owner'])
  if (!access) return { ok: false, message: 'Solo el owner puede eliminar.' }

  const parsed = customerIdSchema.safeParse({ id: customerId })
  if (!parsed.success) return { ok: false, message: 'ID inválido.' }

  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('customers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
    .is('deleted_at', null)

  if (error) return { ok: false, message: 'No pudimos eliminar.' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user.user?.id ?? null,
    action: 'customer.deleted',
    entity: 'customer',
    entityId: parsed.data.id,
  })

  revalidatePath(`/${slug}/clientes`)
  return { ok: true, message: 'Cliente eliminado.' }
}

export async function assignTag(
  slug: string,
  payload: { customer_id: string; tag_id: string },
): Promise<CustomerActionState> {
  const access = await authorize(slug, ['owner', 'cashier'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tagAssignmentSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_tag_assignments')
    .upsert(
      { customer_id: parsed.data.customer_id, tag_id: parsed.data.tag_id },
      { onConflict: 'customer_id,tag_id', ignoreDuplicates: true },
    )

  if (error) return { ok: false, message: 'No pudimos asignar la etiqueta.' }

  revalidatePath(`/${slug}/clientes`)
  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)
  return { ok: true }
}

export async function removeTag(
  slug: string,
  payload: { customer_id: string; tag_id: string },
): Promise<CustomerActionState> {
  const access = await authorize(slug, ['owner', 'cashier'])
  if (!access) return { ok: false, message: 'No tenés permiso.' }

  const parsed = tagAssignmentSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_tag_assignments')
    .delete()
    .eq('customer_id', parsed.data.customer_id)
    .eq('tag_id', parsed.data.tag_id)

  if (error) return { ok: false, message: 'No pudimos quitar la etiqueta.' }

  revalidatePath(`/${slug}/clientes`)
  revalidatePath(`/${slug}/clientes/${parsed.data.customer_id}`)
  return { ok: true }
}
