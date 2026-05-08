'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { flowCreateSchema, flowUpdateSchema } from './schemas'

export type FlowActionState =
  | { ok: true; id?: string; message?: string }
  | { ok: false; message: string }

async function authorizeOwner(slug: string) {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])
    return access
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

function readJson<T>(formData: FormData, key: string): T {
  const raw = formData.get(key)
  if (typeof raw !== 'string') throw new Error(`${key} missing`)
  return JSON.parse(raw) as T
}

export async function createFlow(
  slug: string,
  _prev: FlowActionState,
  formData: FormData,
): Promise<FlowActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  let parsed: ReturnType<typeof flowCreateSchema.parse>
  try {
    parsed = flowCreateSchema.parse({
      name: formData.get('name'),
      trigger: readJson(formData, 'trigger'),
      steps: readJson(formData, 'steps'),
      active: formData.get('active') === 'true',
    })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }

  const service = createServiceClient()
  const { data: flow, error } = await service
    .from('flows')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.name,
      trigger_type: parsed.trigger.type,
      trigger_config: parsed.trigger as unknown as never,
      active: parsed.active,
    })
    .select('id')
    .single()
  if (error || !flow) return { ok: false, message: error?.message ?? 'insert failed' }

  const stepRows = parsed.steps.map((step, position) => ({
    flow_id: flow.id,
    position,
    type: step.type,
    config: step as unknown as never,
  }))
  const { error: stepsErr } = await service.from('flow_steps').insert(stepRows)
  if (stepsErr) return { ok: false, message: stepsErr.message }

  revalidatePath(`/${slug}/flows`)
  return { ok: true, id: flow.id }
}

export async function updateFlow(
  slug: string,
  _prev: FlowActionState,
  formData: FormData,
): Promise<FlowActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  let parsed: ReturnType<typeof flowUpdateSchema.parse>
  try {
    parsed = flowUpdateSchema.parse({
      id: formData.get('id'),
      name: formData.get('name'),
      trigger: readJson(formData, 'trigger'),
      steps: readJson(formData, 'steps'),
      active: formData.get('active') === 'true',
    })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('flows')
    .update({
      name: parsed.name,
      trigger_type: parsed.trigger.type,
      trigger_config: parsed.trigger as unknown as never,
      active: parsed.active,
    })
    .eq('id', parsed.id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }

  // Reemplazo total de steps: simple y suficiente para v1.
  await service.from('flow_steps').delete().eq('flow_id', parsed.id)
  const stepRows = parsed.steps.map((step, position) => ({
    flow_id: parsed.id,
    position,
    type: step.type,
    config: step as unknown as never,
  }))
  const { error: stepsErr } = await service.from('flow_steps').insert(stepRows)
  if (stepsErr) return { ok: false, message: stepsErr.message }

  revalidatePath(`/${slug}/flows`)
  return { ok: true, id: parsed.id }
}

export async function toggleFlowActive(
  slug: string,
  _prev: FlowActionState,
  formData: FormData,
): Promise<FlowActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const id = formData.get('id')
  const active = formData.get('active') === 'true'
  if (typeof id !== 'string') return { ok: false, message: 'id requerido.' }
  const service = createServiceClient()
  const { error } = await service
    .from('flows')
    .update({ active })
    .eq('id', id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/flows`)
  return { ok: true }
}

export async function deleteFlow(
  slug: string,
  _prev: FlowActionState,
  formData: FormData,
): Promise<FlowActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const id = formData.get('id')
  if (typeof id !== 'string') return { ok: false, message: 'id requerido.' }
  const service = createServiceClient()
  const { error } = await service
    .from('flows')
    .delete()
    .eq('id', id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/flows`)
  return { ok: true }
}

// Wrapper para silenciar import unused de createClient si lo agregás luego.
export async function _flowsActionsBrowserClient() {
  return createClient()
}
