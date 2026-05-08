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

describeIfRls('RLS — loyalty (visits, points, rewards)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let customerA: { id: string }
  let customerB: { id: string }
  let categoryA: { id: string }
  let itemA: { id: string; price_cents: number }
  let rewardA: { id: string; cost_points: number }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('loyaltyA') })
    ownerB = await createUserClient({ email: uniqueEmail('loyaltyB') })
    cashierA = await createUserClient({ email: uniqueEmail('cashier') })
    waiterA = await createUserClient({ email: uniqueEmail('waiter') })

    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('loy-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('loy-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    const { data: c1 } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491100${Date.now().toString().slice(-7)}`,
        first_name: 'Mariana',
        last_name: 'Pérez',
      })
      .select('id')
      .single()
    customerA = c1!

    const { data: c2 } = await service
      .from('customers')
      .insert({
        tenant_id: tenantB.id,
        phone: `+5491155${Date.now().toString().slice(-7)}`,
        first_name: 'Pedro',
        last_name: 'López',
      })
      .select('id')
      .single()
    customerB = c2!

    const { data: cat } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenantA.id, name: 'Tragos' })
      .select('id')
      .single()
    categoryA = cat!

    const { data: item } = await service
      .from('menu_items')
      .insert({
        tenant_id: tenantA.id,
        category_id: categoryA.id,
        name: 'IPA',
        price_cents: 50000,
      })
      .select('id, price_cents')
      .single()
    itemA = item!

    // Regla per_amount: cada $1000 = 10 pts (=> $5000 = 50pts)
    await service.from('points_rules').insert({
      tenant_id: tenantA.id,
      type: 'per_amount',
      config: { every_cents: 100000, points: 10 },
      priority: 0,
      active: true,
    })

    const { data: rew } = await service
      .from('rewards')
      .insert({
        tenant_id: tenantA.id,
        name: 'Trago gratis',
        cost_points: 30,
        stock: 1,
      })
      .select('id, cost_points')
      .single()
    rewardA = rew!
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (waiterA) await deleteUser(waiterA.userId)
  })

  it('trigger mantiene points_balance == sum(delta)', async () => {
    const service = getServiceClient()
    const { data: cust } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491166${Date.now().toString().slice(-7)}`,
        first_name: 'Test',
        last_name: 'Trigger',
      })
      .select('id')
      .single()

    await service.from('points_transactions').insert([
      { tenant_id: tenantA.id, customer_id: cust?.id, delta: 50, reason: 'test' },
      { tenant_id: tenantA.id, customer_id: cust?.id, delta: 30, reason: 'test' },
      { tenant_id: tenantA.id, customer_id: cust?.id, delta: -20, reason: 'test' },
    ])

    const { data: c } = await service
      .from('customers')
      .select('points_balance')
      .eq('id', cust?.id)
      .single()
    expect(c?.points_balance).toBe(60)
  })

  it('owner A no ve visits/points de B', async () => {
    const service = getServiceClient()
    await service.from('visits').insert({
      tenant_id: tenantB.id,
      customer_id: customerB.id,
      total_amount_cents: 10000,
    })
    const { data } = await ownerA.client
      .from('visits')
      .select('id, tenant_id')
      .eq('tenant_id', tenantB.id)
    expect(data ?? []).toEqual([])
  })

  it('cashier puede close_table en su tenant', async () => {
    const { data, error } = await cashierA.client.rpc('close_table', {
      p_customer_id: customerA.id,
      p_items: [{ item_id: itemA.id, quantity: 2 }],
      p_notes: 'mesa 5',
    })
    expect(error).toBeNull()
    const result = Array.isArray(data) ? data[0] : data
    expect(result?.points_awarded).toBe(10) // $1000 (2 × $500) → 10 pts

    const service = getServiceClient()
    const { data: cust } = await service
      .from('customers')
      .select('points_balance, total_visits, total_spent_cents')
      .eq('id', customerA.id)
      .single()
    expect(cust?.points_balance).toBe(10)
    expect(cust?.total_visits).toBe(1)
    expect(cust?.total_spent_cents).toBe(100000)
  })

  it('waiter NO puede close_table (forbidden)', async () => {
    const { error } = await waiterA.client.rpc('close_table', {
      p_customer_id: customerA.id,
      p_items: [{ item_id: itemA.id, quantity: 1 }],
      p_notes: null,
    })
    expect(error?.message).toContain('forbidden')
  })

  it('close_table cross-tenant rechaza (customer del otro tenant)', async () => {
    const { error } = await cashierA.client.rpc('close_table', {
      p_customer_id: customerB.id,
      p_items: [{ item_id: itemA.id, quantity: 1 }],
      p_notes: null,
    })
    expect(error?.message).toContain('forbidden')
  })

  it('redeem_reward con balance suficiente descuenta', async () => {
    // Tras cierres anteriores, customerA tiene 10 pts. Sumamos más pts via service.
    const service = getServiceClient()
    await service.from('points_transactions').insert({
      tenant_id: tenantA.id,
      customer_id: customerA.id,
      delta: 100,
      reason: 'test_topup',
    })

    const { data, error } = await cashierA.client.rpc('redeem_reward', {
      p_customer_id: customerA.id,
      p_reward_id: rewardA.id,
    })
    expect(error).toBeNull()
    const result = Array.isArray(data) ? data[0] : data
    expect(result?.balance_after).toBe(10 + 100 - 30)

    const { data: cust } = await service
      .from('customers')
      .select('points_balance')
      .eq('id', customerA.id)
      .single()
    expect(cust?.points_balance).toBe(80)
  })

  it('segundo redeem agota stock y rechaza', async () => {
    const { error } = await cashierA.client.rpc('redeem_reward', {
      p_customer_id: customerA.id,
      p_reward_id: rewardA.id,
    })
    expect(error?.message).toContain('out_of_stock')
  })

  it('redeem con balance insuficiente rechaza y NO altera balance', async () => {
    const service = getServiceClient()
    const { data: poor } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491177${Date.now().toString().slice(-7)}`,
        first_name: 'Sin',
        last_name: 'Pts',
      })
      .select('id')
      .single()
    // Reward de 1 pt, stock infinito
    const { data: reward } = await service
      .from('rewards')
      .insert({
        tenant_id: tenantA.id,
        name: 'Mini',
        cost_points: 1,
        stock: null,
      })
      .select('id, cost_points')
      .single()

    const { error } = await cashierA.client.rpc('redeem_reward', {
      p_customer_id: poor?.id,
      p_reward_id: reward?.id,
    })
    expect(error?.message).toContain('insufficient_balance')

    const { data: c } = await service
      .from('customers')
      .select('points_balance')
      .eq('id', poor?.id)
      .single()
    expect(c?.points_balance).toBe(0)
  })

  it('reglas de tenant B no aplican al cerrar mesa de tenant A', async () => {
    const service = getServiceClient()
    // Regla en B muy generosa
    await service.from('points_rules').insert({
      tenant_id: tenantB.id,
      type: 'per_amount',
      config: { every_cents: 100, points: 1000 },
      priority: 100,
      active: true,
    })

    const { data: clean } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491188${Date.now().toString().slice(-7)}`,
        first_name: 'X',
        last_name: 'X',
      })
      .select('id')
      .single()

    const { data, error } = await cashierA.client.rpc('close_table', {
      p_customer_id: clean?.id,
      p_items: [{ item_id: itemA.id, quantity: 1 }],
      p_notes: null,
    })
    expect(error).toBeNull()
    const result = Array.isArray(data) ? data[0] : data
    // Solo aplica la regla de A (cada $1000 = 10 pts). $500 → 0 pts.
    expect(result?.points_awarded).toBe(0)
  })

  it('points_transactions es ledger inmutable: authenticated NO puede insertar directo', async () => {
    const { error } = await ownerA.client.from('points_transactions').insert({
      tenant_id: tenantA.id,
      customer_id: customerA.id,
      delta: 9999,
      reason: 'hack',
    })
    expect(error).not.toBeNull()
  })
})
