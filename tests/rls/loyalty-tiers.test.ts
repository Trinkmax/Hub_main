import type { SupabaseClient } from '@supabase/supabase-js'
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

describeIfRls('RLS — loyalty tiers + ganancia + gating', () => {
  let service: SupabaseClient
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let _tenantB: { id: string; slug: string }
  let customerId: string
  let plataId: string
  let oroId: string
  let lockedRewardId: string
  let benefitRewardId: string

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('ownerA') })
    ownerB = await createUserClient({ email: uniqueEmail('ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('bara'),
      ownerId: ownerA.userId,
    })
    _tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('barb'),
      ownerId: ownerB.userId,
    })

    // Cliente
    const { data: cust } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+54935155${Date.now() % 100000}`,
        first_name: 'Ana',
        last_name: 'Test',
      })
      .select('id')
      .single()
    customerId = (cust as { id: string }).id

    // Regla per_amount: cada 100 centavos = 1 punto
    await service.from('points_rules').insert({
      tenant_id: tenantA.id,
      type: 'per_amount',
      config: { every_cents: 100, points: 1 },
      priority: 10,
      active: true,
    })

    // Niveles: Plata desde 100, Oro desde 500
    const { data: plata } = await service
      .from('loyalty_tiers')
      .insert({ tenant_id: tenantA.id, name: 'Plata', min_category_points: 100 })
      .select('id')
      .single()
    plataId = (plata as { id: string }).id
    const { data: oro } = await service
      .from('loyalty_tiers')
      .insert({ tenant_id: tenantA.id, name: 'Oro', min_category_points: 500 })
      .select('id')
      .single()
    oroId = (oro as { id: string }).id

    // Recompensa exclusiva de Oro + recompensa de beneficio recurrente
    const { data: locked } = await service
      .from('rewards')
      .insert({ tenant_id: tenantA.id, name: 'Botella Oro', cost_points: 10, min_tier_id: oroId })
      .select('id')
      .single()
    lockedRewardId = (locked as { id: string }).id
    const { data: benefit } = await service
      .from('rewards')
      .insert({ tenant_id: tenantA.id, name: 'Trago de cumple', cost_points: 1 })
      .select('id')
      .single()
    benefitRewardId = (benefit as { id: string }).id
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('ganar puntos suma a la categoría y sube el nivel', async () => {
    // 10000 centavos → 100 pts → cruza Plata
    const { error } = await ownerA.client.rpc('award_points_by_amount', {
      p_customer_id: customerId,
      p_amount_cents: 10000,
    })
    expect(error).toBeNull()

    const { data } = await service
      .from('customers')
      .select('points_balance, lifetime_points_earned, category_points, current_tier_id')
      .eq('id', customerId)
      .single()
    const c = data as {
      points_balance: number
      lifetime_points_earned: number
      category_points: number
      current_tier_id: string | null
    }
    expect(c.points_balance).toBe(100)
    expect(c.lifetime_points_earned).toBe(100)
    expect(c.category_points).toBe(100)
    expect(c.current_tier_id).toBe(plataId)
  })

  it('recompensa tier-locked: bloquea por debajo del nivel, permite al alcanzarlo', async () => {
    // Aún en Plata (categoría 100 < Oro 500) → tier_locked
    const blocked = await ownerA.client.rpc('redeem_reward', {
      p_customer_id: customerId,
      p_reward_id: lockedRewardId,
    })
    expect(blocked.error).not.toBeNull()
    expect(blocked.error?.message ?? '').toContain('tier_locked')

    // Ganar 400 pts más → categoría 500 → Oro
    await ownerA.client.rpc('award_points_by_amount', {
      p_customer_id: customerId,
      p_amount_cents: 40000,
    })
    const { data: afterEarn } = await service
      .from('customers')
      .select('category_points, current_tier_id, points_balance')
      .eq('id', customerId)
      .single()
    const ae = afterEarn as {
      category_points: number
      current_tier_id: string
      points_balance: number
    }
    expect(ae.category_points).toBe(500)
    expect(ae.current_tier_id).toBe(oroId)

    // Ahora sí puede canjear
    const ok = await ownerA.client.rpc('redeem_reward', {
      p_customer_id: customerId,
      p_reward_id: lockedRewardId,
    })
    expect(ok.error).toBeNull()

    // El canje NO baja la categoría ni el nivel (sólo el balance gastable)
    const { data: afterRedeem } = await service
      .from('customers')
      .select('category_points, current_tier_id, points_balance')
      .eq('id', customerId)
      .single()
    const ar = afterRedeem as {
      category_points: number
      current_tier_id: string
      points_balance: number
    }
    expect(ar.category_points).toBe(500)
    expect(ar.current_tier_id).toBe(oroId)
    expect(ar.points_balance).toBe(490)
  })

  it('grant_tier_benefits es idempotente por período', async () => {
    // Beneficio mensual de Oro (desde 20260701 los beneficios viven en `tier_benefits`)
    const { error: benefitError } = await service.from('tier_benefits').insert({
      tenant_id: tenantA.id,
      tier_id: oroId,
      kind: 'recurring_reward',
      label: 'Trago del mes',
      reward_id: benefitRewardId,
      cadence: 'monthly',
      quantity: 1,
    })
    expect(benefitError).toBeNull()

    const first = await service.rpc('grant_tier_benefits')
    const firstCount = Array.isArray(first.data) ? (first.data[0]?.granted_count ?? 0) : 0
    expect(firstCount).toBeGreaterThanOrEqual(1)

    const second = await service.rpc('grant_tier_benefits')
    const secondCount = Array.isArray(second.data) ? (second.data[0]?.granted_count ?? 0) : 0
    expect(secondCount).toBe(0)

    // Una sola fila de grant para el cliente
    const { data: grants } = await service
      .from('tier_benefit_grants')
      .select('id')
      .eq('customer_id', customerId)
    expect((grants ?? []).length).toBe(1)
  })

  it('aislamiento cross-tenant: ownerB no ve los niveles de A', async () => {
    const { data } = await ownerB.client
      .from('loyalty_tiers')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('un staff no-owner no puede crear niveles (RLS owner-only)', async () => {
    // ownerB intenta insertar un nivel en su PROPIO tenant siendo owner → permitido;
    // pero insertar en tenant A (ajeno) debe fallar por RLS.
    const { error } = await ownerB.client
      .from('loyalty_tiers')
      .insert({ tenant_id: tenantA.id, name: 'Hack', min_category_points: 1 })
    expect(error).not.toBeNull()
  })
})
