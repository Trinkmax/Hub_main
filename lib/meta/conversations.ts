import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * find-or-create-conversation compartida.
 * Acepta customerId nulo para contactos fríos / sin perfil.
 * Si la conversación ya existe y no tiene customer_id pero se pasa uno, lo vincula.
 */
export async function findOrCreateConversation(opts: {
  tenantId: string
  channelId: string
  externalUserId: string
  customerId?: string | null
}): Promise<string> {
  const service = createServiceClient()

  const { data: existing } = await service
    .from('conversations')
    .select('id, customer_id')
    .eq('channel_id', opts.channelId)
    .eq('external_user_id', opts.externalUserId)
    .maybeSingle()

  if (existing) {
    // Vincular customer si aún no estaba asignado y ahora tenemos uno.
    if (!existing.customer_id && opts.customerId) {
      await service
        .from('conversations')
        .update({ customer_id: opts.customerId })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created, error } = await service
    .from('conversations')
    .insert({
      tenant_id: opts.tenantId,
      channel_id: opts.channelId,
      external_user_id: opts.externalUserId,
      customer_id: opts.customerId ?? null,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !created) {
    throw new Error(`findOrCreateConversation: ${error?.message ?? 'no id returned'}`)
  }

  return created.id
}

/**
 * Registra un mensaje saliente y actualiza la vista de la conversación.
 * Centraliza lo que antes era la función privada `recordOutbound` en actions.ts.
 */
export async function recordOutboundMessage(opts: {
  tenantId: string
  conversationId: string
  body: string | null
  metaMessageId: string | null
  status: 'sent' | 'failed'
  error?: string | null
}): Promise<void> {
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
      .update({
        last_message_at: sentAt,
        unread_count: 0,
        last_message_preview: (opts.body ?? '[plantilla]').slice(0, 120),
        last_message_direction: 'outbound',
      })
      .eq('id', opts.conversationId)
  }
}
