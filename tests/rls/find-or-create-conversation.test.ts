import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findOrCreateConversation } from '@/lib/meta/conversations'
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

describeIfRls('findOrCreateConversation — idempotencia y vinculación de cliente', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string }
  let channelId: string
  let customerId: string

  const externalUserId = `+549351${Date.now().toString().slice(-7)}`

  beforeAll(async () => {
    const service = getServiceClient()

    owner = await createUserClient({ email: uniqueEmail('foc-owner') })
    tenant = await createTenant({
      name: 'Bar FOC Test',
      slug: uniqueSlug('foc'),
      ownerId: owner.userId,
    })

    // Canal WhatsApp conectado
    const { data: ch, error: chErr } = await service
      .from('channels')
      .insert({
        tenant_id: tenant.id,
        type: 'whatsapp',
        external_account_id: 'WABA_FOC',
        external_phone_number_id: 'PHONE_FOC',
        status: 'connected',
      })
      .select()
      .single()
    if (chErr || !ch) throw new Error(`channel: ${chErr?.message}`)
    channelId = ch.id

    // Cliente de referencia
    const { data: cust, error: custErr } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'María',
        last_name: 'Test',
        phone: externalUserId,
      })
      .select()
      .single()
    if (custErr || !cust) throw new Error(`customer: ${custErr?.message}`)
    customerId = cust.id

    // Inyectar NEXT_PUBLIC_SUPABASE_URL si solo tenemos SUPABASE_URL (compatibilidad CI)
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
    }
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('tenants').delete().eq('id', tenant.id)
    await deleteUser(owner.userId)
  })

  it('crea una conversación nueva con customerId=null y la devuelve', async () => {
    const id = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId: null,
    })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    const service = getServiceClient()
    const { data, error } = await service
      .from('conversations')
      .select('id, customer_id')
      .eq('id', id)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(id)
    expect(data?.customer_id).toBeNull()
  })

  it('llamada idempotente: devuelve el mismo id en la segunda llamada', async () => {
    const id1 = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId: null,
    })
    const id2 = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId: null,
    })

    expect(id1).toBe(id2)

    // Solo hay una fila en la DB para este (channel, external_user_id)
    const service = getServiceClient()
    const { data } = await service
      .from('conversations')
      .select('id')
      .eq('channel_id', channelId)
      .eq('external_user_id', externalUserId)
    expect(data).toHaveLength(1)
  })

  it('vincula el customer_id cuando la conversación existía sin él', async () => {
    // Primera llamada sin customer — ya existe de los tests anteriores con customer_id=null
    const idSin = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId: null,
    })

    // Segunda llamada CON customerId → debe vincularlo
    const idCon = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId,
    })

    expect(idSin).toBe(idCon) // misma conversación

    const service = getServiceClient()
    const { data } = await service
      .from('conversations')
      .select('customer_id')
      .eq('id', idCon)
      .maybeSingle()
    expect(data?.customer_id).toBe(customerId)
  })

  it('no sobreescribe el customer_id si ya estaba asignado', async () => {
    // Ya tiene customer_id asignado por el test anterior.
    // Llamada con customerId=null no debe borrarlo.
    const id = await findOrCreateConversation({
      tenantId: tenant.id,
      channelId,
      externalUserId,
      customerId: null,
    })

    const service = getServiceClient()
    const { data } = await service
      .from('conversations')
      .select('customer_id')
      .eq('id', id)
      .maybeSingle()
    // El customer_id original debe seguir ahí
    expect(data?.customer_id).toBe(customerId)
  })
})
