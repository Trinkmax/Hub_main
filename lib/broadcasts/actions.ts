'use server'

import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { enqueueJob } from '@/lib/jobs/queue'
import { sendTemplate, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { tryNormalizePhone } from '@/lib/phone'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'
import { broadcastCreateSchema, broadcastTestSchema } from './schemas'
import { resolveTemplateVariables, templateBodyParamCount } from './variables'

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
    variable_mapping: JSON.parse((formData.get('variable_mapping') as string) || '{}'),
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
      variable_mapping: parsed.data.variable_mapping,
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

export async function sendBroadcastNow(
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
    .update({ scheduled_at: new Date().toISOString(), status: 'scheduled' })
    .eq('id', id)
    .eq('tenant_id', access.tenant.id)
    .in('status', ['draft', 'scheduled'])
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/${slug}/difusiones/${id}`)
  return { ok: true, id }
}

export async function resendFailedRecipients(
  slug: string,
  _prev: BroadcastActionState,
  formData: FormData,
): Promise<BroadcastActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const id = formData.get('id')
  if (typeof id !== 'string') return { ok: false, message: 'id requerido.' }
  const service = createServiceClient()
  const { data: bc } = await service
    .from('broadcasts')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', access.tenant.id)
    .maybeSingle()
  if (!bc) return { ok: false, message: 'Difusión no encontrada.' }
  const { data: failed } = await service
    .from('broadcast_recipients')
    .update({ status: 'pending', error: null })
    .eq('broadcast_id', id)
    .eq('status', 'failed')
    .select('id')
  await service.from('broadcasts').update({ status: 'sending', completed_at: null }).eq('id', id)
  const base = Date.now()
  let i = 0
  for (const rrow of failed ?? []) {
    await enqueueJob({
      tenantId: access.tenant.id,
      kind: 'send_broadcast_message',
      payload: { recipient_id: rrow.id, broadcast_id: id } as never,
      runAt: new Date(base + i * 100),
    })
    i += 1
  }
  revalidatePath(`/${slug}/difusiones/${id}`)
  return { ok: true, id, message: `${failed?.length ?? 0} reencolados` }
}

export async function sendBroadcastTest(
  slug: string,
  _prev: BroadcastActionState,
  formData: FormData,
): Promise<BroadcastActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const parsed = broadcastTestSchema.safeParse({
    channel_id: formData.get('channel_id'),
    template_id: formData.get('template_id'),
    to_phone: formData.get('to_phone'),
    variable_mapping: JSON.parse((formData.get('variable_mapping') as string) || '{}'),
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }
  const phone = tryNormalizePhone(parsed.data.to_phone)
  if (!phone) return { ok: false, message: 'Teléfono inválido.' }
  const service = createServiceClient()
  const [{ data: channel }, { data: template }] = await Promise.all([
    service
      .from('channels')
      .select('*')
      .eq('id', parsed.data.channel_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
    service
      .from('message_templates')
      .select('name, language, components')
      .eq('id', parsed.data.template_id)
      .eq('tenant_id', access.tenant.id)
      .maybeSingle(),
  ])
  if (!channel || channel.status !== 'connected')
    return { ok: false, message: 'Canal no conectado.' }
  if (!template) return { ok: false, message: 'Template no encontrado.' }
  const count = templateBodyParamCount(template.components)
  const sampleCustomer = { first_name: 'Prueba', last_name: 'HUB', phone }
  const variables = resolveTemplateVariables(parsed.data.variable_mapping, sampleCustomer, count)
  try {
    await sendTemplate(
      channel as WhatsAppChannelLike,
      phone,
      template.name,
      template.language,
      variables,
    )
    return { ok: true, message: 'Prueba enviada.' }
  } catch (e) {
    return { ok: false, message: `Error al enviar prueba: ${(e as Error).message}` }
  }
}
