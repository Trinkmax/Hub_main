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

  it('get_session_state devuelve is_activated:false cuando la mesa no fue activada por el mozo', async () => {
    const anon = getAnonClient()
    const { data, error } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      is_activated: false,
      table_label: 'RPC-T1',
      tenant_name: 'RPC Bar',
    })
  })

  it('anon NO puede ejecutar activate_table_session', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 2,
      p_source: 'scan',
    })
    // GRANT está solo para authenticated → anon recibe permission denied o auth error.
    expect(error).not.toBeNull()
  })

  it('owner puede activar la mesa via activate_table_session', async () => {
    const { data, error } = await owner.client.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 4,
      p_source: 'scan',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      was_already_active: false,
      party_size: 4,
      table_label: 'RPC-T1',
    })
  })

  it('segundo activate sobre la misma mesa devuelve was_already_active:true', async () => {
    const { data, error } = await owner.client.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 5, // distinto, pero no debe cambiar el actual
      p_source: 'manual',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_already_active: true, party_size: 4 })
  })

  it('activate_table_session con party_size <= 0 raise', async () => {
    const service = getServiceClient()
    const { data: pt3 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T3' })
      .select('qr_token')
      .single()
    if (!pt3) throw new Error('failed to seed pt3')
    const { error } = await owner.client.rpc('activate_table_session', {
      p_qr_token: pt3.qr_token,
      p_party_size: 0,
      p_source: 'scan',
    })
    expect(error?.message).toContain('party_size_invalid')
  })

  it('get_session_state tras activación devuelve is_activated:true con la sesión', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('get_session_state', {
      p_qr_token: qrToken,
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(data).toMatchObject({ is_activated: true, party_size: 4 })
  })

  it('get_session_state with invalid qr_token raises', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('get_session_state', {
      p_qr_token: 'doesNotExistAtAll',
      p_browser_token: 'rpcBrowserToken1',
    })
    expect(error?.message).toContain('invalid_qr_token')
  })

  it('join_session_as_guest raise si la mesa no fue activada', async () => {
    const service = getServiceClient()
    const { data: ptNoActive } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'RPC-T-NO-ACTIVE' })
      .select('qr_token')
      .single()
    if (!ptNoActive) throw new Error('failed to seed ptNoActive')
    const anon = getAnonClient()
    const { error } = await anon.rpc('join_session_as_guest', {
      p_qr_token: ptNoActive.qr_token,
      p_browser_token: 'noActiveGuestToken1',
      p_display_name: null,
    })
    expect(error?.message).toContain('no_active_session')
  })

  it('join_session_as_guest creates a guest tras activación', async () => {
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
    // Activamos la mesa con el owner antes de unirse como guest.
    await owner.client.rpc('activate_table_session', {
      p_qr_token: pt2.qr_token,
      p_party_size: 2,
      p_source: 'manual',
    })
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

describeIfRls('Activación de mesa — multi-rol y ocupación', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let _tenantB: { id: string; slug: string }
  let qrTokenA: string
  let qrTokenA2: string

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('actA-owner') })
    waiterA = await createUserClient({ email: uniqueEmail('actA-w') })
    cashierA = await createUserClient({ email: uniqueEmail('actA-c') })
    ownerB = await createUserClient({ email: uniqueEmail('actB-owner') })
    tenantA = await createTenant({
      name: 'Activación A',
      slug: uniqueSlug('act-a'),
      ownerId: ownerA.userId,
    })
    _tenantB = await createTenant({
      name: 'Activación B',
      slug: uniqueSlug('act-b'),
      ownerId: ownerB.userId,
    })
    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
    ])
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'ACT-A1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('seed pt failed')
    qrTokenA = pt.qr_token
    const { data: pt2 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'ACT-A2' })
      .select('qr_token')
      .single()
    if (!pt2) throw new Error('seed pt2 failed')
    qrTokenA2 = pt2.qr_token
  })

  afterAll(async () => {
    await deleteUser(ownerA.userId)
    await deleteUser(waiterA.userId)
    await deleteUser(cashierA.userId)
    await deleteUser(ownerB.userId)
  })

  it('waiter puede ejecutar activate_table_session', async () => {
    const { data, error } = await waiterA.client.rpc('activate_table_session', {
      p_qr_token: qrTokenA,
      p_party_size: 3,
      p_source: 'scan',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ was_already_active: false, party_size: 3 })
  })

  it('cashier puede ejecutar activate_table_session', async () => {
    const { error } = await cashierA.client.rpc('activate_table_session', {
      p_qr_token: qrTokenA2,
      p_party_size: 2,
      p_source: 'manual',
    })
    expect(error).toBeNull()
  })

  it('owner de tenant B NO puede activar mesa de tenant A', async () => {
    const service = getServiceClient()
    const { data: pt3 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenantA.id, label: 'ACT-A3' })
      .select('qr_token')
      .single()
    if (!pt3) throw new Error('seed pt3 failed')
    const { error } = await ownerB.client.rpc('activate_table_session', {
      p_qr_token: pt3.qr_token,
      p_party_size: 2,
      p_source: 'scan',
    })
    expect(error?.message).toMatch(/forbidden|invalid_qr_token/)
  })

  it('update_session_party_size: waiter ajusta exitosamente', async () => {
    const service = getServiceClient()
    const { data: sess } = await service
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (!sess) throw new Error('no open session found')
    const { data, error } = await waiterA.client.rpc('update_session_party_size', {
      p_session_id: sess.id,
      p_party_size: 6,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ party_size: 6 })
  })

  it('update_session_party_size con party_size 0 raise', async () => {
    const service = getServiceClient()
    const { data: sess } = await service
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle()
    if (!sess) throw new Error('no open session found')
    const { error } = await waiterA.client.rpc('update_session_party_size', {
      p_session_id: sess.id,
      p_party_size: 0,
    })
    expect(error?.message).toContain('party_size_invalid')
  })

  it('get_salon_occupancy refleja la suma de party_size', async () => {
    const { data, error } = await ownerA.client.rpc('get_salon_occupancy', {
      p_tenant_id: tenantA.id,
    })
    expect(error).toBeNull()
    const r = data as {
      total_seats: number | null
      occupied_seats: number
      available_seats: number | null
      open_sessions: number
    }
    expect(r.total_seats).toBeNull() // no se configuró en este test
    expect(r.available_seats).toBeNull()
    expect(r.occupied_seats).toBeGreaterThanOrEqual(8) // 6 (actualizado) + 2 (cashier)
    expect(r.open_sessions).toBeGreaterThanOrEqual(2)
  })

  it('get_salon_occupancy: cuando total_seats está configurado, available se calcula', async () => {
    const service = getServiceClient()
    await service
      .from('tenants')
      .update({ total_seats: 50 } as never)
      .eq('id', tenantA.id)
    const { data } = await ownerA.client.rpc('get_salon_occupancy', {
      p_tenant_id: tenantA.id,
    })
    const r = data as {
      total_seats: number | null
      occupied_seats: number
      available_seats: number | null
    }
    expect(r.total_seats).toBe(50)
    expect(r.available_seats).toBe(Math.max(50 - r.occupied_seats, 0))
  })

  it('mark_session_paid NO rota el qr_token', async () => {
    // Necesito una sesión open con su mesa. Usamos qrTokenA (sesión waiter activó con party=6).
    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .select('id, qr_token')
      .eq('qr_token', qrTokenA)
      .single()
    if (!pt) throw new Error('pt not found')
    const tokenBefore = pt.qr_token

    const { data: sess } = await service
      .from('table_sessions')
      .select('id, status')
      .eq('physical_table_id', pt.id)
      .eq('status', 'open')
      .maybeSingle()
    if (!sess) throw new Error('no open session on qrTokenA mesa')

    const { error } = await ownerA.client.rpc('mark_session_paid', { p_session_id: sess.id })
    expect(error).toBeNull()

    const { data: ptAfter } = await service
      .from('physical_tables')
      .select('qr_token')
      .eq('id', pt.id)
      .single()
    expect(ptAfter?.qr_token).toBe(tokenBefore)
  })
})
