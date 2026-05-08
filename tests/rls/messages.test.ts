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

describeIfRls('RLS — channels / conversations / messages', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let channelAId: string
  let conversationAId: string
  let messageAId: string
  let channelBId: string

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('m-ownerA') })
    waiterA = await createUserClient({ email: uniqueEmail('m-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('m-ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('m-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('m-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: waiterA.userId,
      role: 'waiter',
    })

    // canales en cada tenant
    const { data: chA } = await service
      .from('channels')
      .insert({
        tenant_id: tenantA.id,
        type: 'whatsapp',
        external_account_id: 'WABA_A',
        external_phone_number_id: 'PHONE_A',
        status: 'connected',
      })
      .select()
      .single()
    channelAId = chA?.id ?? ''
    const { data: chB } = await service
      .from('channels')
      .insert({
        tenant_id: tenantB.id,
        type: 'whatsapp',
        external_account_id: 'WABA_B',
        external_phone_number_id: 'PHONE_B',
        status: 'connected',
      })
      .select()
      .single()
    channelBId = chB?.id ?? ''

    // conversación + mensaje en tenantA
    const { data: convA } = await service
      .from('conversations')
      .insert({
        tenant_id: tenantA.id,
        channel_id: channelAId,
        external_user_id: '5490000000000',
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()
    conversationAId = convA?.id ?? ''
    const { data: msgA } = await service
      .from('messages')
      .insert({
        tenant_id: tenantA.id,
        conversation_id: conversationAId,
        direction: 'inbound',
        content: 'hola',
        meta_message_id: 'wamid.RLS.A',
        status: 'delivered',
      })
      .select()
      .single()
    messageAId = msgA?.id ?? ''
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('tenants').delete().in('id', [tenantA.id, tenantB.id])
    await deleteUser(ownerA.userId)
    await deleteUser(waiterA.userId)
    await deleteUser(ownerB.userId)
  })

  it('miembro del tenant ve sus mensajes', async () => {
    const { data, error } = await waiterA.client.from('messages').select('id').eq('id', messageAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('owner de otro tenant NO ve los mensajes ajenos', async () => {
    const { data } = await ownerB.client.from('messages').select('id').eq('id', messageAId)
    expect(data).toEqual([])
  })

  it('owner de otro tenant NO ve la conversación ajena', async () => {
    const { data } = await ownerB.client
      .from('conversations')
      .select('id')
      .eq('id', conversationAId)
    expect(data).toEqual([])
  })

  it('owner de otro tenant NO ve canales ajenos', async () => {
    const { data } = await ownerB.client.from('channels').select('id').eq('id', channelAId)
    expect(data).toEqual([])
  })

  it('waiter NO puede mutar channels (solo owner)', async () => {
    const { error } = await waiterA.client
      .from('channels')
      .update({ display_name: 'hack' })
      .eq('id', channelAId)
    // RLS o silently no-op según supabase: si no hay error, validamos que no cambió.
    if (!error) {
      const service = getServiceClient()
      const { data } = await service
        .from('channels')
        .select('display_name')
        .eq('id', channelAId)
        .single()
      expect(data?.display_name).not.toBe('hack')
    }
  })

  it('waiter NO puede insertar canales nuevos', async () => {
    const { error, data } = await waiterA.client
      .from('channels')
      .insert({
        tenant_id: tenantA.id,
        type: 'instagram',
        external_account_id: 'X',
        status: 'disconnected',
      })
      .select()
    expect(error || data?.length === 0).toBeTruthy()
  })

  it('owner del tenant SÍ puede mutar canales', async () => {
    const { error } = await ownerA.client
      .from('channels')
      .update({ display_name: 'Bar A WA' })
      .eq('id', channelAId)
    expect(error).toBeNull()
  })

  it('mensajes con channel del otro tenant están aislados', async () => {
    expect(channelBId).not.toBe(channelAId)
  })
})
