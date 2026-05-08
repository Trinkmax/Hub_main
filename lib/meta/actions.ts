'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { MetaApiError, mapMetaErrorToStatus } from '@/lib/meta/errors'
import { sendDM } from '@/lib/meta/instagram'
import { syncTemplates } from '@/lib/meta/templates'
import { sendTemplate, sendText, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  RoleRequiredError,
  requireRole,
  requireTenantAccess,
  TenantNotFoundError,
  UnauthenticatedError,
} from '@/lib/tenant'

export type MetaActionState = { ok: true; message?: string } | { ok: false; message: string }

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

const disconnectSchema = z.object({
  channel_id: z.string().uuid(),
})

export async function disconnectChannel(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const parsed = disconnectSchema.safeParse({ channel_id: formData.get('channel_id') })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const service = createServiceClient()
  const { data: channel } = await service
    .from('channels')
    .select('id, type')
    .eq('id', parsed.data.channel_id)
    .eq('tenant_id', access.tenant.id)
    .maybeSingle()
  if (!channel) return { ok: false, message: 'Canal no encontrado.' }

  const { error } = await service
    .from('channels')
    .update({
      status: 'disconnected',
      encrypted_access_token: null,
      token_expires_at: null,
      last_error: null,
    })
    .eq('id', channel.id)
    .eq('tenant_id', access.tenant.id)
  if (error) return { ok: false, message: error.message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await logAudit({
    tenantId: access.tenant.id,
    userId: user?.id ?? null,
    action: 'channel_disconnected',
    entity: 'channels',
    entityId: channel.id,
    payload: { type: channel.type },
  })

  revalidatePath(`/${slug}/configuracion/canales`)
  return { ok: true, message: 'Canal desconectado.' }
}

export async function syncTemplatesAction(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const access = await authorizeOwner(slug)
  if (!access) return { ok: false, message: 'Sin permisos.' }
  const channelId = formData.get('channel_id')
  if (typeof channelId !== 'string') return { ok: false, message: 'channel_id requerido.' }

  const service = createServiceClient()
  const { data: channel, error } = await service
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .eq('tenant_id', access.tenant.id)
    .eq('type', 'whatsapp')
    .maybeSingle()
  if (error || !channel) return { ok: false, message: 'Canal WhatsApp no encontrado.' }

  try {
    const { synced } = await syncTemplates(channel)
    revalidatePath(`/${slug}/configuracion/templates`)
    return { ok: true, message: `Sincronizados ${synced} templates.` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

const sendTextSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4096),
})

const sendTemplateSchema = z.object({
  conversation_id: z.string().uuid(),
  template_name: z.string().min(1),
  template_language: z.string().min(2),
  variables: z.array(z.string()).default([]),
})

async function loadConversationContext(slug: string, conversationId: string) {
  const access = await requireTenantAccess(slug)
  requireRole(access.role, ['owner', 'cashier', 'waiter'])
  const service = createServiceClient()
  const { data: conversation, error: convErr } = await service
    .from('conversations')
    .select('id, tenant_id, channel_id, external_user_id')
    .eq('id', conversationId)
    .eq('tenant_id', access.tenant.id)
    .maybeSingle()
  if (convErr || !conversation) return null
  const { data: channel } = await service
    .from('channels')
    .select('*')
    .eq('id', conversation.channel_id)
    .maybeSingle()
  if (!channel) return null
  return { access, conversation, channel }
}

async function recordOutbound(opts: {
  tenantId: string
  conversationId: string
  body: string | null
  metaMessageId: string | null
  status: 'sent' | 'failed'
  error?: string | null
}) {
  const service = createServiceClient()
  const sentAt = new Date().toISOString()
  await service.from('messages').insert({
    tenant_id: opts.tenantId,
    conversation_id: opts.conversationId,
    direction: 'outbound',
    content: opts.body,
    meta_message_id: opts.metaMessageId,
    status: opts.status,
    error: opts.error ?? null,
    sent_at: opts.status === 'sent' ? sentAt : null,
  })
  if (opts.status === 'sent') {
    await service
      .from('conversations')
      .update({ last_message_at: sentAt, unread_count: 0 })
      .eq('id', opts.conversationId)
  }
}

export async function sendTextMessage(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const parsed = sendTextSchema.safeParse({
    conversation_id: formData.get('conversation_id'),
    body: formData.get('body'),
  })
  if (!parsed.success) return { ok: false, message: 'Mensaje inválido.' }

  const ctx = await loadConversationContext(slug, parsed.data.conversation_id)
  if (!ctx) return { ok: false, message: 'Conversación no encontrada.' }
  const { conversation, channel } = ctx

  try {
    let metaMessageId: string
    if (channel.type === 'whatsapp') {
      const { meta_message_id } = await sendText(
        channel as WhatsAppChannelLike,
        conversation.external_user_id,
        parsed.data.body,
      )
      metaMessageId = meta_message_id
    } else {
      const { meta_message_id } = await sendDM(
        channel,
        conversation.external_user_id,
        parsed.data.body,
      )
      metaMessageId = meta_message_id
    }
    await recordOutbound({
      tenantId: conversation.tenant_id,
      conversationId: conversation.id,
      body: parsed.data.body,
      metaMessageId,
      status: 'sent',
    })
    revalidatePath(`/${slug}/bandeja`)
    return { ok: true }
  } catch (e) {
    const reason = e instanceof MetaApiError ? mapMetaErrorToStatus(e).reason : (e as Error).message
    await recordOutbound({
      tenantId: conversation.tenant_id,
      conversationId: conversation.id,
      body: parsed.data.body,
      metaMessageId: null,
      status: 'failed',
      error: reason,
    })
    revalidatePath(`/${slug}/bandeja`)
    return { ok: false, message: reason }
  }
}

export async function sendTemplateMessage(
  slug: string,
  _prev: MetaActionState,
  formData: FormData,
): Promise<MetaActionState> {
  const variables = formData.getAll('variable').map((v) => String(v))
  const parsed = sendTemplateSchema.safeParse({
    conversation_id: formData.get('conversation_id'),
    template_name: formData.get('template_name'),
    template_language: formData.get('template_language'),
    variables,
  })
  if (!parsed.success) return { ok: false, message: 'Datos inválidos.' }

  const ctx = await loadConversationContext(slug, parsed.data.conversation_id)
  if (!ctx) return { ok: false, message: 'Conversación no encontrada.' }
  const { conversation, channel } = ctx
  if (channel.type !== 'whatsapp') {
    return { ok: false, message: 'Templates solo disponibles para WhatsApp.' }
  }

  try {
    const { meta_message_id } = await sendTemplate(
      channel as WhatsAppChannelLike,
      conversation.external_user_id,
      parsed.data.template_name,
      parsed.data.template_language,
      parsed.data.variables,
    )
    await recordOutbound({
      tenantId: conversation.tenant_id,
      conversationId: conversation.id,
      body: `[template:${parsed.data.template_name}] ${parsed.data.variables.join(' | ')}`,
      metaMessageId: meta_message_id,
      status: 'sent',
    })
    revalidatePath(`/${slug}/bandeja`)
    return { ok: true }
  } catch (e) {
    const reason = e instanceof MetaApiError ? mapMetaErrorToStatus(e).reason : (e as Error).message
    await recordOutbound({
      tenantId: conversation.tenant_id,
      conversationId: conversation.id,
      body: `[template:${parsed.data.template_name}]`,
      metaMessageId: null,
      status: 'failed',
      error: reason,
    })
    return { ok: false, message: reason }
  }
}
