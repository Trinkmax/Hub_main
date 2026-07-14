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

// Cubre el fix anti-duplicados (migración 20260703..._broadcast_recipient_atomic_claim):
// claim_broadcast_recipient hace un UPDATE condicional atómico
// (pending → sending, con lease self-heal de 5min). Dos ticks del dispatcher que
// se solapan no pueden reclamar el mismo recipient dos veces → sin envío duplicado.
describeIfRls('RLS — claim atómico de broadcast recipient (anti-duplicados)', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let recipientId: string

  beforeAll(async () => {
    const service = getServiceClient()
    owner = await createUserClient({ email: uniqueEmail('claim-owner') })
    tenant = await createTenant({
      name: 'Bar Claim Test',
      slug: uniqueSlug('claim'),
      ownerId: owner.userId,
    })

    const { data: ch, error: chErr } = await service
      .from('channels')
      .insert({
        tenant_id: tenant.id,
        type: 'whatsapp',
        external_account_id: 'WABA_CLAIM',
        external_phone_number_id: 'PHONE_CLAIM',
        status: 'connected',
      })
      .select()
      .single()
    if (chErr || !ch) throw new Error(`channel: ${chErr?.message}`)

    const { data: tpl, error: tplErr } = await service
      .from('message_templates')
      .insert({
        tenant_id: tenant.id,
        channel_id: ch.id,
        name: 'hello_claim',
        language: 'es',
        category: 'MARKETING',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Hola!' }],
      })
      .select()
      .single()
    if (tplErr || !tpl) throw new Error(`template: ${tplErr?.message}`)

    const { data: aud, error: audErr } = await service
      .from('audiences')
      .insert({
        tenant_id: tenant.id,
        name: 'Claim aud',
        filters: { kind: 'static_list', customer_ids: [] },
      })
      .select()
      .single()
    if (audErr || !aud) throw new Error(`audience: ${audErr?.message}`)

    const { data: cust, error: custErr } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'Claim',
        last_name: 'Test',
        phone: '5491100000010',
        opt_in_marketing: true,
      })
      .select()
      .single()
    if (custErr || !cust) throw new Error(`customer: ${custErr?.message}`)

    const { data: bc, error: bcErr } = await service
      .from('broadcasts')
      .insert({
        tenant_id: tenant.id,
        name: 'Claim Broadcast',
        channel_id: ch.id,
        template_id: tpl.id,
        audience_id: aud.id,
        status: 'sending',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (bcErr || !bc) throw new Error(`broadcast: ${bcErr?.message}`)

    const { data: rcpt, error: rErr } = await service
      .from('broadcast_recipients')
      .insert({
        broadcast_id: bc.id,
        customer_id: cust.id,
        status: 'pending',
      })
      .select()
      .single()
    if (rErr || !rcpt) throw new Error(`recipient: ${rErr?.message}`)
    recipientId = rcpt.id
  })

  afterAll(async () => {
    const service = getServiceClient()
    // Cascade desde tenant elimina channel, template, audience, customer,
    // broadcast y broadcast_recipients.
    await service.from('tenants').delete().eq('id', tenant.id)
    await deleteUser(owner.userId)
  })

  it('el primer claim gana (pending → sending) y el segundo NO reclama', async () => {
    const service = getServiceClient()

    const first = await service.rpc('claim_broadcast_recipient', { p_id: recipientId })
    expect(first.error).toBeNull()
    expect(first.data).toBe(true)

    // Segundo claim inmediato: ya está 'sending' con lease fresco → no debe reclamar.
    const second = await service.rpc('claim_broadcast_recipient', { p_id: recipientId })
    expect(second.error).toBeNull()
    expect(second.data).toBe(false)

    const { data: row } = await service
      .from('broadcast_recipients')
      .select('status, claimed_at')
      .eq('id', recipientId)
      .single()
    expect(row?.status).toBe('sending')
    expect(row?.claimed_at).not.toBeNull()
  })
})
