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

describeIfRls('RPC mark_session_paid', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let cashier: Awaited<ReturnType<typeof createUserClient>>
  let kitchen: Awaited<ReturnType<typeof createUserClient>>
  let outsider: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string
  let menuItemId: string
  let sessionId: string
  let guestId: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('cbOwn') })
    cashier = await createUserClient({ email: uniqueEmail('cbCas') })
    kitchen = await createUserClient({ email: uniqueEmail('cbKit') })
    outsider = await createUserClient({ email: uniqueEmail('cbOut') })

    tenant = await createTenant({
      name: 'Cobro Bar',
      slug: uniqueSlug('cb-bar'),
      ownerId: owner.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenant.id, user_id: cashier.userId, role: 'cashier' },
      { tenant_id: tenant.id, user_id: kitchen.userId, role: 'kitchen' },
    ])

    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'CB-1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('failed seed pt')
    qrToken = pt.qr_token

    const { data: cat } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenant.id, name: 'Tragos' })
      .select('id')
      .single()
    if (!cat) throw new Error('failed cat')

    const { data: item } = await service
      .from('menu_items')
      .insert({
        tenant_id: tenant.id,
        category_id: cat.id,
        name: 'Fernet',
        price_cents: 350000,
      })
      .select('id')
      .single()
    if (!item) throw new Error('failed item')
    menuItemId = item.id

    // Regla de puntos: cada $1000 = 10 pts.
    await service.from('points_rules').insert({
      tenant_id: tenant.id,
      type: 'per_amount',
      config: { every_cents: 100000, points: 10 },
      priority: 0,
      active: true,
    })

    // El staff abre la mesa (ya no hay auto-create al escanear el QR).
    await owner.client.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 2,
      p_source: 'manual',
      p_alias: null,
    })

    // Comensal escanea, se registra, pide.
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'cobroBrowserTok1',
      p_display_name: 'Tester',
    })
    await anon.rpc('register_customer_for_session', {
      p_qr_token: qrToken,
      p_browser_token: 'cobroBrowserTok1',
      p_phone: `+5491100${Date.now().toString().slice(-7)}`,
      p_first_name: 'Tester',
      p_last_name: 'Uno',
      p_birthdate: null,
      p_opt_in_marketing: false,
      p_ip: null,
      p_user_agent: null,
    })

    const { data: sess } = await service
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .single()
    if (!sess) throw new Error('no session')
    sessionId = sess.id

    const { data: g } = await service
      .from('session_guests')
      .select('id')
      .eq('session_id', sessionId)
      .single()
    if (!g) throw new Error('no guest')
    guestId = g.id

    // Submit y aceptar 2 fernets (= $7000)
    const { data: subm } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'cobroBrowserTok1',
      p_items: [
        {
          menu_item_id: menuItemId,
          quantity: 2,
          notes: null,
          assigned_to_guest_id: guestId,
        },
      ],
      p_idempotency_key: `cb-idem-${Date.now()}`,
    })
    const tkId = (subm as { ticket_id: string }).ticket_id
    await owner.client.rpc('accept_ticket', { p_ticket_id: tkId })
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(cashier.userId)
    await deleteUser(kitchen.userId)
    await deleteUser(outsider.userId)
  })

  it('cashier puede mark_session_paid y se calculan puntos', async () => {
    const { data, error } = await cashier.client.rpc('mark_session_paid', {
      p_session_id: sessionId,
    })
    expect(error).toBeNull()
    const result = data as {
      status: string
      idempotent: boolean
      total_cents: number
      total_points: number
      visits_created: number
    }
    expect(result.status).toBe('paid')
    expect(result.idempotent).toBe(false)
    expect(result.total_cents).toBe(700000) // 2 × 350000
    expect(result.visits_created).toBe(1)
    expect(result.total_points).toBe(70) // 7000 / 1000 × 10
  })

  it('mark_session_paid es idempotente', async () => {
    const { data } = await cashier.client.rpc('mark_session_paid', { p_session_id: sessionId })
    const result = data as { idempotent: boolean }
    expect(result.idempotent).toBe(true)
  })

  it('qr_token rotó tras cobrar', async () => {
    const service = getServiceClient()
    const { data: pt } = await service
      .from('physical_tables')
      .select('qr_token')
      .eq('tenant_id', tenant.id)
      .single()
    expect(pt?.qr_token).not.toBe(qrToken)
  })

  it('kitchen no puede mark_session_paid', async () => {
    const service = getServiceClient()
    const { data: pt2 } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'CB-2' })
      .select('qr_token')
      .single()
    if (!pt2) throw new Error('failed pt2')

    await owner.client.rpc('activate_table_session', {
      p_qr_token: pt2.qr_token,
      p_party_size: 2,
      p_source: 'manual',
      p_alias: null,
    })

    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: pt2.qr_token,
      p_browser_token: 'cobroKitchenTok1',
      p_display_name: null,
    })
    const { data: sess2 } = await service
      .from('table_sessions')
      .select('id')
      .eq('status', 'open')
      .neq('id', sessionId)
      .limit(1)
      .single()
    if (!sess2) throw new Error('no second session')

    const { error } = await kitchen.client.rpc('mark_session_paid', {
      p_session_id: sess2.id,
    })
    expect(error?.message).toMatch(/forbidden|role/)
  })

  it('outsider no ve el visit ni el points_transaction creado', async () => {
    const { data: visits } = await outsider.client
      .from('visits')
      .select('id')
      .eq('tenant_id', tenant.id)
    expect(visits?.length ?? 0).toBe(0)

    const { data: txs } = await outsider.client
      .from('points_transactions')
      .select('id')
      .eq('tenant_id', tenant.id)
    expect(txs?.length ?? 0).toBe(0)
  })
})
