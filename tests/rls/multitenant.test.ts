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

describeIfRls('RLS — multi-tenant isolation', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('ownerA') })
    ownerB = await createUserClient({ email: uniqueEmail('ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('bara'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('barb'),
      ownerId: ownerB.userId,
    })
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('user only sees their own tenant via RLS', async () => {
    const { data, error } = await ownerA.client.from('tenants').select('id, slug')
    expect(error).toBeNull()
    const ids = (data ?? []).map((t) => t.id)
    expect(ids).toContain(tenantA.id)
    expect(ids).not.toContain(tenantB.id)
  })

  it('user cannot read memberships of other tenants', async () => {
    const { data } = await ownerA.client
      .from('memberships')
      .select('tenant_id')
      .eq('tenant_id', tenantB.id)
    expect(data).toEqual([])
  })

  it('non-owner cannot insert invitation', async () => {
    // Crear cashier en tenantA
    const cashier = await createUserClient({ email: uniqueEmail('cashier') })
    try {
      const service = getServiceClient()
      await service
        .from('memberships')
        .insert({ tenant_id: tenantA.id, user_id: cashier.userId, role: 'cashier' })

      const { error } = await cashier.client.from('invitations').insert({
        tenant_id: tenantA.id,
        email: 'someone@test.com',
        role: 'waiter',
        invited_by: cashier.userId,
      })
      expect(error).not.toBeNull()
    } finally {
      await deleteUser(cashier.userId)
    }
  })

  it('cashier cannot insert audit_log directly', async () => {
    const cashier = await createUserClient({ email: uniqueEmail('cashier2') })
    try {
      const service = getServiceClient()
      await service
        .from('memberships')
        .insert({ tenant_id: tenantA.id, user_id: cashier.userId, role: 'cashier' })

      const { error } = await cashier.client.from('audit_log').insert({
        tenant_id: tenantA.id,
        action: 'test.hack',
        entity: 'tenant',
      })
      expect(error).not.toBeNull()
    } finally {
      await deleteUser(cashier.userId)
    }
  })

  it('owner cannot read audit_log of other tenants', async () => {
    const service = getServiceClient()
    await service.from('audit_log').insert({
      tenant_id: tenantB.id,
      user_id: ownerB.userId,
      action: 'test',
      entity: 'tenant',
    })

    const { data } = await ownerA.client.from('audit_log').select('id').eq('tenant_id', tenantB.id)
    expect(data).toEqual([])
  })

  it('accept_invitation rejects email mismatch', async () => {
    const service = getServiceClient()
    const { data: inv } = await service
      .from('invitations')
      .insert({
        tenant_id: tenantA.id,
        email: 'someone-else@test.com',
        role: 'waiter',
        invited_by: ownerA.userId,
      })
      .select('token')
      .single()

    const intruder = await createUserClient({ email: uniqueEmail('intruder') })
    try {
      const { error } = await intruder.client.rpc('accept_invitation', {
        p_token: inv?.token,
      })
      expect(error?.message).toContain('email_mismatch')
    } finally {
      await deleteUser(intruder.userId)
    }
  })

  it('set_active_tenant rejects non-members', async () => {
    const { error } = await ownerA.client.rpc('set_active_tenant', { p_tenant: tenantB.id })
    expect(error?.message).toContain('not_a_member')
  })

  it('check_slug_available works', async () => {
    const { data: taken } = await ownerA.client.rpc('check_slug_available', {
      p_slug: tenantA.slug,
    })
    expect(taken).toBe(false)
    const { data: free } = await ownerA.client.rpc('check_slug_available', {
      p_slug: `definitely-not-taken-${Date.now()}`,
    })
    expect(free).toBe(true)
  })
})
