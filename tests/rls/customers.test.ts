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

describeIfRls('RLS — customers + capture', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let linkA: { id: string; slug: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('cust-ownerA') })
    ownerB = await createUserClient({ email: uniqueEmail('cust-ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('cust-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('cust-b'),
      ownerId: ownerB.userId,
    })

    // Crear capture link activo para tenantA via service
    const service = getServiceClient()
    const slug = `mesa${Date.now().toString(36)}`
    const { data, error } = await service
      .from('customer_capture_links')
      .insert({ tenant_id: tenantA.id, slug, label: 'Mesa 1' })
      .select('id, slug')
      .single()
    if (error || !data) throw new Error(`create link failed: ${error?.message}`)
    linkA = data
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('owner A no ve customers de B', async () => {
    const service = getServiceClient()
    await service.from('customers').insert({
      tenant_id: tenantB.id,
      phone: '+5491100000001',
      first_name: 'Foo',
      last_name: 'Bar',
    })

    const { data } = await ownerA.client
      .from('customers')
      .select('id, tenant_id')
      .eq('tenant_id', tenantB.id)
    expect(data).toEqual([])
  })

  it('anon NO puede SELECT customers', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    )
    const { data } = await anonClient.from('customers').select('id')
    expect(data ?? []).toEqual([])
  })

  it('anon NO puede SELECT capture_submissions', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    )
    const { data } = await anonClient.from('customer_capture_submissions').select('id')
    expect(data ?? []).toEqual([])
  })

  it('submit_capture (anon) crea customer + submission', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    )
    const phone = `+549351${Date.now().toString().slice(-7)}`
    const { data, error } = await anonClient.rpc('submit_capture', {
      p_link_slug: linkA.slug,
      p_phone: phone,
      p_first_name: 'Lucía',
      p_last_name: 'Méndez',
      p_opt_in: true,
      p_ip: '1.2.3.4',
      p_user_agent: 'vitest',
    })
    expect(error).toBeNull()
    const result = Array.isArray(data) ? data[0] : data
    expect(result?.was_new).toBe(true)

    const service = getServiceClient()
    const { data: rows } = await service
      .from('customers')
      .select('id, phone, opt_in_marketing')
      .eq('tenant_id', tenantA.id)
      .eq('phone', phone)
    expect(rows?.length).toBe(1)
    expect(rows?.[0]?.opt_in_marketing).toBe(true)
  })

  it('submit_capture deduplica por phone (no crea segundo customer)', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    )
    const phone = `+549351${Date.now().toString().slice(-7)}`
    await anonClient.rpc('submit_capture', {
      p_link_slug: linkA.slug,
      p_phone: phone,
      p_first_name: 'Pedro',
      p_last_name: 'Salinas',
      p_opt_in: false,
      p_ip: '1.2.3.4',
      p_user_agent: 'vitest',
    })
    const { data: second } = await anonClient.rpc('submit_capture', {
      p_link_slug: linkA.slug,
      p_phone: phone,
      p_first_name: 'PedroX',
      p_last_name: 'SalinasX',
      p_opt_in: true,
      p_ip: '1.2.3.4',
      p_user_agent: 'vitest',
    })
    const second_result = Array.isArray(second) ? second[0] : second
    expect(second_result?.was_new).toBe(false)

    const service = getServiceClient()
    const { data: rows } = await service
      .from('customers')
      .select('id, first_name, opt_in_marketing')
      .eq('tenant_id', tenantA.id)
      .eq('phone', phone)
    expect(rows?.length).toBe(1)
    // primer envío ganó el nombre, no se sobrescribe
    expect(rows?.[0]?.first_name).toBe('Pedro')
    // pero opt-in se actualizó porque el segundo lo aceptó
    expect(rows?.[0]?.opt_in_marketing).toBe(true)

    const { count } = await service
      .from('customer_capture_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantA.id)
      .eq('phone', phone)
    expect(count).toBe(2)
  })

  it('submit_capture rechaza link inactivo', async () => {
    const service = getServiceClient()
    const inactiveSlug = `inactive${Date.now().toString(36)}`
    await service
      .from('customer_capture_links')
      .insert({ tenant_id: tenantA.id, slug: inactiveSlug, label: 'X', active: false })

    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    )
    const { error } = await anonClient.rpc('submit_capture', {
      p_link_slug: inactiveSlug,
      p_phone: '+5493515559999',
      p_first_name: 'X',
      p_last_name: 'Y',
      p_opt_in: false,
      p_ip: '1.2.3.4',
      p_user_agent: 'vitest',
    })
    expect(error?.message).toContain('invalid_or_inactive_link')
  })

  it('tag cross-tenant es rechazado por la RLS', async () => {
    const service = getServiceClient()
    // Tag de A
    const { data: tagA } = await service
      .from('customer_tags')
      .insert({ tenant_id: tenantA.id, name: `vip-${Date.now()}` })
      .select('id')
      .single()
    // Customer de B
    const { data: custB } = await service
      .from('customers')
      .insert({
        tenant_id: tenantB.id,
        phone: `+5491155${Date.now().toString().slice(-6)}`,
        first_name: 'Z',
        last_name: 'Z',
      })
      .select('id')
      .single()

    if (!tagA || !custB) throw new Error('setup data missing')

    const { error } = await ownerB.client
      .from('customer_tag_assignments')
      .insert({ customer_id: custB.id, tag_id: tagA.id })
    expect(error).not.toBeNull()
  })
})
