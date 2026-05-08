'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export type AudienceFromListState = { ok: true; id: string } | { ok: false; message: string }

// Crea una audiencia con un static_list de customer_ids — usado por el CTA
// "crear audiencia con esta lista" en churn risk.
export async function createAudienceFromList(
  slug: string,
  _prev: AudienceFromListState,
  formData: FormData,
): Promise<AudienceFromListState> {
  try {
    const access = await requireTenantAccess(slug)
    requireRole(access.role, ['owner'])

    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, message: 'Nombre requerido.' }
    const idsRaw = formData.get('customer_ids')
    if (typeof idsRaw !== 'string') return { ok: false, message: 'customer_ids requerido.' }
    const customer_ids = idsRaw.split(',').filter(Boolean)
    if (customer_ids.length === 0) return { ok: false, message: 'Lista vacía.' }

    const service = createServiceClient()
    const filters = { kind: 'static_list', customer_ids }
    const { data, error } = await service
      .from('audiences')
      .insert({
        tenant_id: access.tenant.id,
        name,
        filters: filters as unknown as never,
        customer_count_cached: customer_ids.length,
        last_calculated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) return { ok: false, message: error?.message ?? 'insert failed' }

    revalidatePath(`/${slug}/audiencias`)
    return { ok: true, id: data.id }
  } catch (e) {
    if (
      e instanceof RoleRequiredError ||
      e instanceof TenantNotFoundError ||
      e instanceof UnauthenticatedError
    ) {
      return { ok: false, message: 'Sin permisos.' }
    }
    return { ok: false, message: (e as Error).message }
  }
}
