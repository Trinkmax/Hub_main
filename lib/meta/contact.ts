'use server'

import { MetaApiError, mapMetaErrorToStatus } from '@/lib/meta/errors'
import { sendTemplate, sendText, type WhatsAppChannelLike } from '@/lib/meta/whatsapp'
import { tryNormalizePhone } from '@/lib/phone'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole, requireTenantAccess } from '@/lib/tenant'
import { type ContactCustomerInput, contactCustomerInputSchema } from './contact-schemas'
import { findOrCreateConversation, recordOutboundMessage } from './conversations'

export type ContactCustomerResult =
  | { ok: true; conversationId: string }
  | {
      ok: false
      code: 'no_channel' | 'window_closed' | 'invalid_phone' | 'not_found' | 'error'
      message: string
    }

const WINDOW_MS = 24 * 60 * 60 * 1000 // 24 horas en milisegundos

export async function contactCustomer(
  slug: string,
  input: ContactCustomerInput,
): Promise<ContactCustomerResult> {
  // 1. Autorización
  const access = await requireTenantAccess(slug)
  requireRole(access.role, ['owner', 'cashier', 'waiter'])
  const tenantId = access.tenant.id

  // 2. Validar input
  const parsed = contactCustomerInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'error',
      message: parsed.error.issues.map((issue) => issue.message).join('; '),
    }
  }
  const data = parsed.data

  const service = createServiceClient()

  // 3. Resolver teléfono del destinatario
  let phone: string
  const customerId: string | null = data.customer_id ?? null

  if (data.customer_id) {
    const { data: customer, error } = await service
      .from('customers')
      .select('id, phone')
      .eq('id', data.customer_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error || !customer) {
      return { ok: false, code: 'not_found', message: 'Cliente no encontrado.' }
    }
    phone = customer.phone
  } else {
    // data.phone garantizado por superRefine (al menos uno de los dos)
    const rawPhone = data.phone ?? ''
    const normalized = tryNormalizePhone(rawPhone)
    if (!normalized) {
      return { ok: false, code: 'invalid_phone', message: 'Teléfono inválido.' }
    }
    phone = normalized
  }

  // 4. Canal WhatsApp conectado del tenant
  const { data: channel, error: channelError } = await service
    .from('channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .maybeSingle()

  if (channelError || !channel) {
    return {
      ok: false,
      code: 'no_channel',
      message: 'No hay canal de WhatsApp conectado. Podés contactar al cliente por wa.me.',
    }
  }

  // 5. Find-or-create conversación
  const conversationId = await findOrCreateConversation({
    tenantId,
    channelId: channel.id,
    externalUserId: phone,
    customerId,
  })

  // 6. Verificar ventana de 24 h
  const { data: conversation } = await service
    .from('conversations')
    .select('last_inbound_at')
    .eq('id', conversationId)
    .maybeSingle()

  const lastInboundAt = conversation?.last_inbound_at
    ? new Date(conversation.last_inbound_at).getTime()
    : null

  const insideWindow = lastInboundAt !== null && Date.now() - lastInboundAt < WINDOW_MS

  // 7. Enviar mensaje
  if (data.body) {
    if (!insideWindow) {
      return {
        ok: false,
        code: 'window_closed',
        message: 'Fuera de ventana de 24h: elegí una plantilla.',
      }
    }

    try {
      const { meta_message_id } = await sendText(channel as WhatsAppChannelLike, phone, data.body)
      await recordOutboundMessage({
        tenantId,
        conversationId,
        body: data.body,
        metaMessageId: meta_message_id,
        status: 'sent',
      })
      return { ok: true, conversationId }
    } catch (e) {
      const reason =
        e instanceof MetaApiError ? mapMetaErrorToStatus(e).reason : (e as Error).message
      await recordOutboundMessage({
        tenantId,
        conversationId,
        body: data.body,
        metaMessageId: null,
        status: 'failed',
        error: reason,
      })
      return { ok: false, code: 'error', message: reason }
    }
  }

  // data.template garantizado por superRefine (body es undefined aquí)
  if (!data.template) {
    return { ok: false, code: 'error', message: 'Se requiere body o template.' }
  }
  const { name, language, variables } = data.template

  try {
    const { meta_message_id } = await sendTemplate(
      channel as WhatsAppChannelLike,
      phone,
      name,
      language,
      variables,
    )
    const body = `[template:${name}] ${variables.join(' | ')}`
    await recordOutboundMessage({
      tenantId,
      conversationId,
      body,
      metaMessageId: meta_message_id,
      status: 'sent',
    })
    return { ok: true, conversationId }
  } catch (e) {
    const reason = e instanceof MetaApiError ? mapMetaErrorToStatus(e).reason : (e as Error).message
    await recordOutboundMessage({
      tenantId,
      conversationId,
      body: `[template:${name}]`,
      metaMessageId: null,
      status: 'failed',
      error: reason,
    })
    return { ok: false, code: 'error', message: reason }
  }
}
