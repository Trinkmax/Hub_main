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
import { broadcastCreateSchema } from './schemas'

export type BroadcastActionState =
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

export async function scheduleBroadcast(
  slug: string,
  _prev: BroadcastActionState,
  formData: FormData,
): Promise<BroadcastActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }

  const parsed = broadcastCreateSchema.safeParse({
    name: formData.get('name'),
    channel_id: formData.get('channel_id'),
    template_id: formData.get('template_id'),
    audience_id: formData.get('audience_id'),
    scheduled_at: formData.get('scheduled_at') || undefined,
    variable_mapping: {},
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Validamos que canal/template/audience pertenezcan al tenant.
  const service = createServiceClient()
  const [{ data: channel }, { data: template }, { data: audience }] = await Promise.all([
    service
      .from('channels')
      .select('id, status')
      .eq('id', parsed.data.channel_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
    service
      .from('message_templates')
      .select('id, status, channel_id')
      .eq('id', parsed.data.template_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
    service
      .from('audiences')
      .select('id, customer_count_cached')
      .eq('id', parsed.data.audience_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
  ])
  if (!channel) return { ok: false, message: 'Canal no encontrado.' }
  if (channel.status !== 'connected') return { ok: false, message: 'Canal no está conectado.' }
  if (!template) return { ok: false, message: 'Template no encontrado.' }
  if (template.status !== 'approved')
    return { ok: false, message: 'Template no aprobado por Meta.' }
  if (template.channel_id !== channel.id)
    return { ok: false, message: 'Template no pertenece al canal.' }
  if (!audience) return { ok: false, message: 'Audience no encontrada.' }

  const { data, error } = await service
    .from('broadcasts')
    .insert({
      tenant_id: access.tenant.id,
      name: parsed.data.name,
      channel_id: parsed.data.channel_id,
      template_id: parsed.data.template_id,
      audience_id: parsed.data.audience_id,
      scheduled_at: parsed.data.scheduled_at ?? new Date().toISOString(),
      status: 'scheduled',
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, message: error?.message ?? 'insert failed' }

  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'broadcast_scheduled',
    entity: 'broadcasts',
    entityId: data.id,
    payload: { name: parsed.data.name, recipients: audience.customer_count_cached },
  })

  revalidatePath(`/${slug}/difusiones`)
  return { ok: true, id: data.id }
}

export async function cancelBroadcast(
  slug: string,
  _prev: BroadcastActionState,
  formData: FormData,
): Promise<BroadcastActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const id = formData.get('id')
  if (typeof id !== 'string') return { ok: false, message: 'id requerido.' }
  const service = createServiceClient()
  const { error } = await service
    .from('broadcasts')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('tenant_id', access.tenant.id)
    .in('status', ['draft', 'scheduled'])
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/difusiones`)
  return { ok: true }
}
