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

describeIfRls('RLS — physical_tables', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('ptA') })
    ownerB = await createUserClient({ email: uniqueEmail('ptB') })
    cashierA = await createUserClient({ email: uniqueEmail('ptCash') })
    waiterA = await createUserClient({ email: uniqueEmail('ptWait') })

    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('pt-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('pt-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(waiterA.userId)
  })

  it('owner can insert and select physical_tables in their tenant', async () => {
    const { data, error } = await ownerA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa 1' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data).toMatchObject({ label: 'Mesa 1', active: true })
    expect(data?.qr_token).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  it('cashier and waiter can SELECT but not INSERT', async () => {
    const { data: cashierRead } = await cashierA.client.from('physical_tables').select('id, label')
    expect(cashierRead?.length).toBeGreaterThan(0)

    const { error: cashierInsert } = await cashierA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa Forbidden' })
    expect(cashierInsert).not.toBeNull()

    const { error: waiterInsert } = await waiterA.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Mesa Forbidden 2' })
    expect(waiterInsert).not.toBeNull()
  })

  it('owner of tenant B cannot see physical_tables of tenant A', async () => {
    const { data } = await ownerB.client
      .from('physical_tables')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data?.length ?? 0).toBe(0)
  })

  it('owner cannot insert physical_tables in another tenant', async () => {
    const { error } = await ownerB.client
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'Crossed' })
    expect(error).not.toBeNull()
  })

  it('qr_token is globally unique', async () => {
    const service = getServiceClient()
    const { data: t1 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'A1' })
      .select('qr_token')
      .single()
    const { error: dup } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantB.id, label: 'B1', qr_token: t1?.qr_token ?? null })
    expect(dup).not.toBeNull()
  })
})
