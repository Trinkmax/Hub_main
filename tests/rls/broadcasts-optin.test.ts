import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { materializeBroadcastForTest } from '@/lib/broadcasts/engine'
import type { Database } from '@/types/database'
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

describeIfRls('RLS — broadcasts opt-in pre-filter', () => {
  type BroadcastRow = Database['public']['Tables']['broadcasts']['Row']

  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let channelId: string
  let templateId: string
  let audienceId: string
  let broadcast: BroadcastRow

  // 4 customers:
  //  - optedIn1: opt_in_marketing=true, not deleted  → debe recibir
  //  - optedIn2: opt_in_marketing=true, not deleted  → debe recibir
  //  - optedOut: opt_in_marketing=false              → excluido por pre-filtro
  //  - deletedOptin: opt_in_marketing=true, deleted  → excluido por pre-filtro
  let optedIn1Id: string
  let optedIn2Id: string
  let optedOutId: string
  let deletedOptinId: string

  beforeAll(async () => {
    const service = getServiceClient()
    owner = await createUserClient({ email: uniqueEmail('bcoptin-owner') })
    tenant = await createTenant({
      name: 'Bar OptiN Test',
      slug: uniqueSlug('bcoptin'),
      ownerId: owner.userId,
    })

    // Canal WA conectado
    const { data: ch, error: chErr } = await service
      .from('channels')
      .insert({
        tenant_id: tenant.id,
        type: 'whatsapp',
        external_account_id: 'WABA_OPTIN',
        external_phone_number_id: 'PHONE_OPTIN',
        status: 'connected',
      })
      .select()
      .single()
    if (chErr || !ch) throw new Error(`channel: ${chErr?.message}`)
    channelId = ch.id

    // Template aprobado
    const { data: tpl, error: tplErr } = await service
      .from('message_templates')
      .insert({
        tenant_id: tenant.id,
        channel_id: channelId,
        name: 'hello_optin',
        language: 'es',
        category: 'MARKETING',
        status: 'approved',
        components: [{ type: 'BODY', text: 'Hola {{1}}!' }],
      })
      .select()
      .single()
    if (tplErr || !tpl) throw new Error(`template: ${tplErr?.message}`)
    templateId = tpl.id

    // 4 clientes
    const { data: c1, error: e1 } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'OptIn1',
        last_name: 'Test',
        phone: '5491100000001',
        opt_in_marketing: true,
      })
      .select()
      .single()
    if (e1 || !c1) throw new Error(`c1: ${e1?.message}`)
    optedIn1Id = c1.id

    const { data: c2, error: e2 } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'OptIn2',
        last_name: 'Test',
        phone: '5491100000002',
        opt_in_marketing: true,
      })
      .select()
      .single()
    if (e2 || !c2) throw new Error(`c2: ${e2?.message}`)
    optedIn2Id = c2.id

    const { data: c3, error: e3 } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'OptOut',
        last_name: 'Test',
        phone: '5491100000003',
        opt_in_marketing: false,
      })
      .select()
      .single()
    if (e3 || !c3) throw new Error(`c3: ${e3?.message}`)
    optedOutId = c3.id

    const { data: c4, error: e4 } = await service
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'DeletedOptin',
        last_name: 'Test',
        phone: '5491100000004',
        opt_in_marketing: true,
        deleted_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (e4 || !c4) throw new Error(`c4: ${e4?.message}`)
    deletedOptinId = c4.id

    // Audiencia static_list con los 4 IDs (el pre-filtro es lo que excluye, no la audiencia)
    const { data: aud, error: audErr } = await service
      .from('audiences')
      .insert({
        tenant_id: tenant.id,
        name: 'Todos los 4',
        filters: {
          kind: 'static_list',
          customer_ids: [optedIn1Id, optedIn2Id, optedOutId, deletedOptinId],
        },
      })
      .select()
      .single()
    if (audErr || !aud) throw new Error(`audience: ${audErr?.message}`)
    audienceId = aud.id

    // Broadcast en estado 'sending'
    const { data: bc, error: bcErr } = await service
      .from('broadcasts')
      .insert({
        tenant_id: tenant.id,
        name: 'Test OptIn Broadcast',
        channel_id: channelId,
        template_id: templateId,
        audience_id: audienceId,
        status: 'sending',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (bcErr || !bc) throw new Error(`broadcast: ${bcErr?.message}`)
    broadcast = bc
  })

  afterAll(async () => {
    const service = getServiceClient()
    // Cascade desde tenant elimina memberships, channels, templates, customers,
    // audiences, broadcasts y broadcast_recipients.
    await service.from('tenants').delete().eq('id', tenant.id)
    await deleteUser(owner.userId)
  })

  it('materializa exactamente 2 recipients (solo los opt-in no borrados)', async () => {
    const count = await materializeBroadcastForTest(broadcast)
    expect(count).toBe(2)

    const service = getServiceClient()
    const { data: rows, error } = await service
      .from('broadcast_recipients')
      .select('customer_id, status')
      .eq('broadcast_id', broadcast.id)
    expect(error).toBeNull()
    expect(rows).toHaveLength(2)

    const ids = rows?.map((r) => r.customer_id) ?? []
    expect(ids).toContain(optedIn1Id)
    expect(ids).toContain(optedIn2Id)
    expect(ids).not.toContain(optedOutId)
    expect(ids).not.toContain(deletedOptinId)
  })

  it('stats iniciales reflejan excluded=2', async () => {
    const service = getServiceClient()
    const { data } = await service
      .from('broadcasts')
      .select('stats')
      .eq('id', broadcast.id)
      .single()
    const stats = data?.stats as Record<string, number> | null
    expect(stats?.excluded).toBe(2)
    expect(stats?.total).toBe(2)
  })
})
