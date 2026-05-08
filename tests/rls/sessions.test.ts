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

describeIfRls('RLS — sessions / guests / events (read-only para authenticated)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let sessionA: { id: string }
  let physicalTableA: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('seA') })
    ownerB = await createUserClient({ email: uniqueEmail('seB') })
    tenantA = await createTenant({
      name: 'SE A',
      slug: uniqueSlug('se-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'SE B',
      slug: uniqueSlug('se-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'SE-T1' })
      .select('id')
      .single()
    if (!pt) throw new Error('failed to seed physical_table')
    physicalTableA = pt

    const { data: sess } = await service
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: pt.id })
      .select('id')
      .single()
    if (!sess) throw new Error('failed to seed session')
    sessionA = sess

    await service.from('session_guests').insert({
      session_id: sess.id,
      browser_token: 'guestSession12345',
      display_name: 'Guest #1',
    })

    await service.from('table_session_events').insert({
      session_id: sess.id,
      type: 'session_opened',
      payload: { initial: true },
    })
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(ownerB.userId)
  })

  it('owner of A reads sessions, guests and events of A', async () => {
    const { data: sessions } = await ownerA.client.from('table_sessions').select('id, status')
    expect(sessions?.find((s) => s.id === sessionA.id)).toBeDefined()

    const { data: guests } = await ownerA.client
      .from('session_guests')
      .select('id, browser_token')
      .eq('session_id', sessionA.id)
    expect(guests?.length).toBe(1)

    const { data: events } = await ownerA.client
      .from('table_session_events')
      .select('id, type')
      .eq('session_id', sessionA.id)
    expect(events?.[0]?.type).toBe('session_opened')
  })

  it('owner of B cannot read sessions or guests of A', async () => {
    const { data: sessions } = await ownerB.client
      .from('table_sessions')
      .select('id')
      .eq('id', sessionA.id)
    expect(sessions?.length ?? 0).toBe(0)

    const { data: guests } = await ownerB.client
      .from('session_guests')
      .select('id')
      .eq('session_id', sessionA.id)
    expect(guests?.length ?? 0).toBe(0)
  })

  it('owner cannot INSERT into table_sessions directly (must use RPC)', async () => {
    const { error } = await ownerA.client
      .from('table_sessions')
      .insert({ tenant_id: tenantA.id, physical_table_id: physicalTableA.id })
    expect(error).not.toBeNull()
  })

  it('owner cannot INSERT into session_guests directly', async () => {
    const { error } = await ownerA.client.from('session_guests').insert({
      session_id: sessionA.id,
      browser_token: 'attemptedDirect12',
    })
    expect(error).not.toBeNull()
  })

  it('owner cannot INSERT into table_session_events directly', async () => {
    const { error } = await ownerA.client.from('table_session_events').insert({
      session_id: sessionA.id,
      type: 'session_opened',
    })
    expect(error).not.toBeNull()
  })

  it('tenantB exists for cross-tenant isolation tests', () => {
    // Sanity check: tenantB se usa en los tests anteriores via ownerB.
    expect(tenantB.id).toBeDefined()
  })
})

describeIfRls('RPCs públicas — get_session_state / join / register', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('rpc') })
    tenant = await createTenant({
      name: 'RPC Bar',
      slug: uniqueSlug('rpc-bar'),
      ownerId: owner.userId,
    })
    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('failed to seed physical_table for RPC tests')
    qrToken = pt.qr_token
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
  })

  it('get_session_state opens a new session on first scan', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      table_label: 'RPC-T1',
      tenant_name: 'RPC Bar',
      was_new_session: true,
      guest_id: null,
    })
  })

  it('get_session_state returns same session on second scan', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(data).toMatchObject({ was_new_session: false })
  })

  it('get_session_state with invalid qr_token raises', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('get_session_state', {
      p_qr_token: 'doesNotExistAtAll',
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error?.message).toContain('invalid_qr_token')
  })

  it('join_session_as_guest creates a guest', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcGuestToken123',
      p_display_name: 'Lucia',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_new_guest: true })
    const result = data as { guest_id: string }
    expect(result.guest_id).toBeDefined()
  })

  it('join_session_as_guest is idempotent on second call', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcGuestToken123',
      p_display_name: 'Lucia',
    })
    expect(data).toMatchObject({ was_new_guest: false })
  })

  it('register_customer_for_session creates a new customer and links the guest', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcRegisterToken1',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('register_customer_for_session', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcRegisterToken1',
      p_phone: '+5491134567890',
      p_first_name: 'Carla',
      p_last_name: 'Roldan',
      p_birthdate: '1985-03-12',
      p_opt_in_marketing: true,
      p_ip: '10.0.0.1',
      p_user_agent: 'vitest',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_new_customer: true })
  })

  it('register_customer_for_session deduplicates by phone within the tenant', async () => {
    const anon = getAnonClient()
    const service = getServiceClient()
    const { data: pt2 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T2' })
      .select('qr_token')
      .single()
    if (!pt2) throw new Error('failed to seed physical_table for dedupe test')
    await anon.rpc('join_session_as_guest', {
      p_qr_token: pt2.qr_token,
      p_browser_token: 'rpcDupToken12345',
      p_display_name: null,
    })
    const { data } = await anon.rpc('register_customer_for_session', {
      p_qr_token: pt2.qr_token,
      p_browser_token: 'rpcDupToken12345',
      p_phone: '+5491134567890',
      p_first_name: 'Carla',
      p_last_name: 'Roldan',
      p_birthdate: null,
      p_opt_in_marketing: false,
      p_ip: null,
      p_user_agent: null,
    })
    expect(data).toMatchObject({ was_new_customer: false })
  })
})
