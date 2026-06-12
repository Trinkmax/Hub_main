import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTenant,
  createUserClient,
  deleteUser,
  getAnonClient,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip

describeIfRls('RLS — platform_admins + feature_flags', () => {
  let service: SupabaseClient
  let admin: Awaited<ReturnType<typeof createUserClient>>
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let adminEmail: string
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  beforeAll(async () => {
    service = getServiceClient()
    adminEmail = uniqueEmail('superadmin')
    admin = await createUserClient({ email: adminEmail })
    owner = await createUserClient({ email: uniqueEmail('owner') })

    tenantA = await createTenant({ name: 'Bar A', slug: uniqueSlug('bara'), ownerId: owner.userId })
    tenantB = await createTenant({ name: 'Bar B', slug: uniqueSlug('barb'), ownerId: admin.userId })

    // Promovemos al admin insertando su email en la allowlist (solo service_role).
    await service.from('platform_admins').insert({ email: adminEmail })
    // Refrescamos el JWT del admin para que el claim email esté presente (ya lo está al sign-in).
  })

  afterAll(async () => {
    await service.from('platform_admins').delete().eq('email', adminEmail)
    if (admin) await deleteUser(admin.userId)
    if (owner) await deleteUser(owner.userId)
  })

  it('is_platform_admin() devuelve true sólo para el admin', async () => {
    const { data: asAdmin } = await admin.client.rpc('is_platform_admin')
    expect(asAdmin).toBe(true)
    const { data: asOwner } = await owner.client.rpc('is_platform_admin')
    expect(asOwner).toBe(false)
  })

  it('un no-admin NO puede leer platform_admins; el admin sí', async () => {
    const { data: ownerRows } = await owner.client.from('platform_admins').select('email')
    expect(ownerRows ?? []).toEqual([])

    const { data: adminRows } = await admin.client.from('platform_admins').select('email')
    expect((adminRows ?? []).some((r) => r.email?.toLowerCase() === adminEmail)).toBe(true)
  })

  it('un owner NO puede flipear feature_flags de su propio bar (trigger)', async () => {
    const { error } = await owner.client
      .from('tenants')
      .update({ feature_flags: { table_service: true } })
      .eq('id', tenantA.id)
    expect(error).not.toBeNull()

    // El valor real no cambió.
    const { data } = await service
      .from('tenants')
      .select('feature_flags')
      .eq('id', tenantA.id)
      .single()
    expect((data?.feature_flags as Record<string, boolean>)?.table_service).not.toBe(true)
  })

  it('un owner NO puede flipear feature_flags de otro bar (RLS)', async () => {
    await owner.client
      .from('tenants')
      .update({ feature_flags: { kitchen: true } })
      .eq('id', tenantB.id)
    const { data } = await service
      .from('tenants')
      .select('feature_flags')
      .eq('id', tenantB.id)
      .single()
    expect((data?.feature_flags as Record<string, boolean>)?.kitchen).not.toBe(true)
  })

  it('el admin SÍ puede flipear feature_flags de cualquier bar', async () => {
    const { error } = await admin.client
      .from('tenants')
      .update({ feature_flags: { table_service: true } })
      .eq('id', tenantA.id)
    expect(error).toBeNull()

    const { data } = await service
      .from('tenants')
      .select('feature_flags')
      .eq('id', tenantA.id)
      .single()
    expect((data?.feature_flags as Record<string, boolean>)?.table_service).toBe(true)
  })

  it('anon no puede leer platform_admins', async () => {
    const anon = getAnonClient()
    const { data } = await anon.from('platform_admins').select('email')
    expect(data ?? []).toEqual([])
  })
})
