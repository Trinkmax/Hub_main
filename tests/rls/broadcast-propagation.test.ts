import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — broadcast propagation (delivery/read/reply)', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let channelId: string
  let customerId: string
  let conversationId: string
  let messageId: string

  beforeAll(async () => {
    const service = getServiceClient()
    owner = await createUserClient({ email: uniqueEmail('bprop-owner') })
    tenant = await createTenant({
      name: 'Bar BroadcastProp Test',
      slug: uniqueSlug('bprop'),
      ownerId: owner.userId,
    })

    // Canal WA conectado
    const { data: ch, error: chErr } = await service
      .from('channels')
      .insert({
        tenant_id: tenant.id,
        type: 'whatsapp',
        external_account_id: 'WABA_BPROP',
        external_phone_number_id: 'PHONE_BPROP',
        status: 'connected',
      })
      .select()
      .single()
    if (chErr || !ch) throw new Error(`channel: ${chErr?.message}`)
    channelId = ch.id

    // Cliente con opt-in
    const { data: cust, error: custErr } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'Prop',
        last_name: 'Test',
        phone: '+5491155550001',
        opt_in_marketing: true,
      })
      .select()
      .single()
    if (custErr || !cust) throw new Error(`customer: ${custErr?.message}`)
    customerId = cust.id

    // Conversación asociada al cliente
    const { data: conv, error: convErr } = await service
      .from('conversations')
      .insert({
        tenant_id: tenant.id,
        channel_id: channelId,
        external_user_id: '5491155550001',
        customer_id: customerId,
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (convErr || !conv) throw new Error(`conversation: ${convErr?.message}`)
    conversationId = conv.id

    // Template aprobado
    const { data: tpl, error: tplErr } = await service
      .from('message_templates')
      .insert({
        tenant_id: tenant.id,
        channel_id: channelId,
        name: 'hello_bprop',
        language: 'es',
        category: 'MARKETING',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Hola {{1}}!' }],
      })
      .select()
      .single()
    if (tplErr || !tpl) throw new Error(`template: ${tplErr?.message}`)

    // Audiencia static_list con el cliente
    const { data: aud, error: audErr } = await service
      .from('audiences')
      .insert({
        tenant_id: tenant.id,
        name: 'Prop Audience',
        filters: { kind: 'static_list', customer_ids: [customerId] },
      })
      .select()
      .single()
    if (audErr || !aud) throw new Error(`audience: ${audErr?.message}`)

    // Broadcast en estado 'sending'
    const { data: bc, error: bcErr } = await service
      .from('broadcasts')
      .insert({
        tenant_id: tenant.id,
        name: 'Test Prop Broadcast',
        channel_id: channelId,
        template_id: tpl.id,
        audience_id: aud.id,
        status: 'sending',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (bcErr || !bc) throw new Error(`broadcast: ${bcErr?.message}`)

    // Mensaje outbound con meta_message_id y broadcast_id
    const metaMsgId = `wamid.bprop.${Date.now()}`
    const { data: msg, error: msgErr } = await service
      .from('messages')
      .insert({
        tenant_id: tenant.id,
        conversation_id: conversationId,
        direction: 'outbound',
        content: 'Hola Prop!',
        meta_message_id: metaMsgId,
        broadcast_id: bc.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (msgErr || !msg) throw new Error(`message: ${msgErr?.message}`)
    messageId = msg.id

    // Recipient en estado 'sent'
    const { error: recErr } = await service.from('broadcast_recipients').insert({
      broadcast_id: bc.id,
      customer_id: customerId,
      message_id: messageId,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    if (recErr) throw new Error(`recipient: ${recErr?.message}`)
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('tenants').delete().eq('id', tenant.id)
    await deleteUser(owner.userId)
  })

  it('sync_broadcast_recipient_status: delivered → status=delivered, delivered_at not null', async () => {
    const service = getServiceClient()

    const { error: rpcErr } = await service.rpc('sync_broadcast_recipient_status', {
      p_message_id: messageId,
      p_status: 'delivered',
      p_timestamp: new Date().toISOString(),
    })
    expect(rpcErr).toBeNull()

    const { data, error } = await service
      .from('broadcast_recipients')
      .select('status, delivered_at, read_at')
      .eq('message_id', messageId)
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('delivered')
    expect(data?.delivered_at).not.toBeNull()
    expect(data?.read_at).toBeNull()
  })

  it('sync_broadcast_recipient_status: read → status=read, read_at not null', async () => {
    const service = getServiceClient()

    const { error: rpcErr } = await service.rpc('sync_broadcast_recipient_status', {
      p_message_id: messageId,
      p_status: 'read',
      p_timestamp: new Date().toISOString(),
    })
    expect(rpcErr).toBeNull()

    const { data, error } = await service
      .from('broadcast_recipients')
      .select('status, delivered_at, read_at')
      .eq('message_id', messageId)
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('read')
    expect(data?.read_at).not.toBeNull()
  })

  it('mark_broadcast_replied: status=replied, replied_at not null', async () => {
    const service = getServiceClient()

    const { error: rpcErr } = await service.rpc('mark_broadcast_replied', {
      p_conversation_id: conversationId,
    })
    expect(rpcErr).toBeNull()

    const { data, error } = await service
      .from('broadcast_recipients')
      .select('status, replied_at')
      .eq('message_id', messageId)
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('replied')
    expect(data?.replied_at).not.toBeNull()
  })
})
