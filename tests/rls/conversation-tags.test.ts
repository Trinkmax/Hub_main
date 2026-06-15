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

describeIfRls('RLS — conversation_tags + conversation_tag_assignments', () => {
  // Tenant A: owner + cashier + waiter
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  // Tenant B: owner (cross-tenant attacker)
  let ownerB: Awaited<ReturnType<typeof createUserClient>>

  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  let channelAId: string
  let conversationAId: string
  let tagAId: string // tag created in tenantA

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('ct-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('ct-cashierA') })
    waiterA = await createUserClient({ email: uniqueEmail('ct-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('ct-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Tags A',
      slug: uniqueSlug('ct-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Tags B',
      slug: uniqueSlug('ct-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    // Add cashier + waiter to tenantA
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    // Create channel + conversation in tenantA
    const { data: ch } = await service
      .from('channels')
      .insert({
        tenant_id: tenantA.id,
        type: 'whatsapp',
        external_account_id: 'WABA_CT_A',
        external_phone_number_id: 'PHONE_CT_A',
        status: 'connected',
      })
      .select()
      .single()
    channelAId = ch?.id ?? ''

    const { data: conv } = await service
      .from('conversations')
      .insert({
        tenant_id: tenantA.id,
        channel_id: channelAId,
        external_user_id: '5490000000099',
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()
    conversationAId = conv?.id ?? ''
  })

  afterAll(async () => {
    const service = getServiceClient()
    await service.from('tenants').delete().in('id', [tenantA.id, tenantB.id])
    await Promise.all([
      deleteUser(ownerA.userId),
      deleteUser(cashierA.userId),
      deleteUser(waiterA.userId),
      deleteUser(ownerB.userId),
    ])
  })

  // ──────────────────────────────────────────────
  // conversation_tags: vocabulario
  // ──────────────────────────────────────────────

  it('owner puede crear una etiqueta en su tenant', async () => {
    const { data, error } = await ownerA.client
      .from('conversation_tags')
      .insert({ tenant_id: tenantA.id, name: 'VIP', color: '#ef4444' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()
    tagAId = data?.id ?? ''
  })

  it('cashier puede crear una etiqueta en su tenant', async () => {
    const { data, error } = await cashierA.client
      .from('conversation_tags')
      .insert({ tenant_id: tenantA.id, name: 'Pendiente', color: '#f59e0b' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data?.name).toBe('Pendiente')
  })

  it('waiter NO puede crear etiquetas (solo vocabulario owner/cashier)', async () => {
    const { data, error } = await waiterA.client
      .from('conversation_tags')
      .insert({ tenant_id: tenantA.id, name: 'HackTag', color: '#000000' })
      .select()

    // Supabase RLS: o error de RLS o data vacía (no-op silencioso)
    const blocked = !!error || !data || data.length === 0
    expect(blocked).toBe(true)

    // Confirmar que no quedó guardado
    const service = getServiceClient()
    const { data: check } = await service
      .from('conversation_tags')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('name', 'HackTag')
    expect(check?.length ?? 0).toBe(0)
  })

  it('owner de otro tenant NO puede leer las etiquetas ajenas', async () => {
    const { data } = await ownerB.client
      .from('conversation_tags')
      .select('id')
      .eq('tenant_id', tenantA.id)

    expect(data).toEqual([])
  })

  it('miembro del tenant SÍ puede leer las etiquetas propias', async () => {
    const { data, error } = await waiterA.client
      .from('conversation_tags')
      .select('id, name')
      .eq('tenant_id', tenantA.id)

    expect(error).toBeNull()
    // Al menos la etiqueta VIP que creó el owner
    expect((data ?? []).some((t) => t.name === 'VIP')).toBe(true)
  })

  // ──────────────────────────────────────────────
  // conversation_tag_assignments
  // ──────────────────────────────────────────────

  it('waiter puede asignar una etiqueta a una conversación de su tenant', async () => {
    const { error } = await waiterA.client.from('conversation_tag_assignments').insert({
      conversation_id: conversationAId,
      tag_id: tagAId,
      assigned_by: waiterA.userId,
    })

    expect(error).toBeNull()
  })

  it('waiter puede leer las asignaciones de conversaciones de su tenant', async () => {
    const { data, error } = await waiterA.client
      .from('conversation_tag_assignments')
      .select('tag_id')
      .eq('conversation_id', conversationAId)

    expect(error).toBeNull()
    expect((data ?? []).some((r) => r.tag_id === tagAId)).toBe(true)
  })

  it('owner de otro tenant NO puede leer las asignaciones ajenas', async () => {
    const { data } = await ownerB.client
      .from('conversation_tag_assignments')
      .select('tag_id')
      .eq('conversation_id', conversationAId)

    expect(data).toEqual([])
  })

  it('owner de otro tenant NO puede asignar etiquetas a conversaciones ajenas', async () => {
    // Crear un tag en tenantB primero (para tener un ID válido en ese tenant)
    const service = getServiceClient()
    const { data: tagB } = await service
      .from('conversation_tags')
      .insert({ tenant_id: tenantB.id, name: 'Spy', color: '#000000' })
      .select()
      .single()

    const { data, error } = await ownerB.client
      .from('conversation_tag_assignments')
      .insert({
        conversation_id: conversationAId,
        tag_id: tagB?.id ?? tagAId,
      })
      .select()

    const blocked = !!error || !data || data.length === 0
    expect(blocked).toBe(true)

    // Confirmar que no hay asignación cross-tenant
    const { data: check } = await service
      .from('conversation_tag_assignments')
      .select('tag_id')
      .eq('conversation_id', conversationAId)
      .neq('tag_id', tagAId)

    expect(check?.length ?? 0).toBe(0)
  })
})
