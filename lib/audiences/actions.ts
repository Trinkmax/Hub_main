'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { evaluateAudience, refreshAudienceCount } from './engine'
import { audienceCreateSchema, audienceFilterSchema, audienceUpdateSchema } from './schemas'

export type AudienceActionState =
  | { ok: true; message?: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }

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

function parseFilters(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string') throw new Error('filters json missing')
  const parsed = JSON.parse(raw)
  return audienceFilterSchema.parse(parsed)
}

export async function createAudience(
  slug: string,
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  let input: z.infer<typeof audienceCreateSchema>
  try {
    input = audienceCreateSchema.parse({
      name: formData.get('name'),
      filters: parseFilters(formData.get('filters')),
    })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }

  const service = createServiceClient()
  const evaluation = await evaluateAudience(access.tenant.id, input.filters, { limit: 1 })
  const { data, error } = await service
    .from('audiences')
    .insert({
      tenant_id: access.tenant.id,
      name: input.name,
      filters: input.filters as unknown as never,
      customer_count_cached: evaluation.total,
      last_calculated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, message: error?.message ?? 'insert failed' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: null,
    action: 'audience_created',
    entity: 'audiences',
    entityId: data.id,
    payload: { name: input.name },
  })

  revalidatePath(`/${slug}/mensajeria/audiencias`)
  return { ok: true, id: data.id }
}

export async function updateAudience(
  slug: string,
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  let input: z.infer<typeof audienceUpdateSchema>
  try {
    input = audienceUpdateSchema.parse({
      id: formData.get('id'),
      name: formData.get('name'),
      filters: parseFilters(formData.get('filters')),
    })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }

  const service = createServiceClient()
  const evaluation = await evaluateAudience(access.tenant.id, input.filters, { limit: 1 })
  const { error } = await service
    .from('audiences')
    .update({
      name: input.name,
      filters: input.filters as unknown as never,
      customer_count_cached: evaluation.total,
      last_calculated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/mensajeria/audiencias`)
  return { ok: true, id: input.id }
}

const previewSchema = z.object({
  filters: audienceFilterSchema,
})

export async function previewAudience(
  slug: string,
  filters: unknown,
): Promise<{ ok: true; total: number; sample: string[] } | { ok: false; message: string }> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  let parsed: z.infer<typeof previewSchema>
  try {
    parsed = previewSchema.parse({ filters })
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
  try {
    // limit 8 = la muestra que mostramos; total viene del count_total del RPC.
    const result = await evaluateAudience(access.tenant.id, parsed.filters, { limit: 8 })
    const sample = await sampleNames(access.tenant.id, result.customerIds)
    return { ok: true, total: result.total, sample }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/**
 * Resuelve nombres legibles para los IDs de la muestra del preview (en vez de
 * mostrar UUIDs crudos). Preserva el orden devuelto por el evaluador.
 */
async function sampleNames(tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const service = createServiceClient()
  const { data } = await service
    .from('customers')
    .select('id, first_name, last_name')
    .eq('tenant_id', tenantId)
    .in('id', ids)
  const byId = new Map((data ?? []).map((c) => [c.id, c]))
  return ids.map((id) => {
    const c = byId.get(id)
    if (!c) return 'Cliente'
    const full = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
    return full.length > 0 ? full : 'Cliente'
  })
}

const idSchema = z.object({ id: z.string().uuid() })

export async function deleteAudience(
  slug: string,
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { ok: false, message: 'id requerido.' }
  const service = createServiceClient()
  const { error } = await service
    .from('audiences')
    .delete()
    .eq('id', parsed.data.id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/mensajeria/audiencias`)
  return { ok: true }
}

export async function recalcAudience(
  slug: string,
  _prev: AudienceActionState,
  formData: FormData,
): Promise<AudienceActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { ok: false, message: 'id requerido.' }
  try {
    const total = await refreshAudienceCount(parsed.data.id)
    revalidatePath(`/${slug}/mensajeria/audiencias`)
    return { ok: true, message: `Audiencia recalculada: ${total} clientes.` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
