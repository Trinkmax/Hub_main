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

describeIfRls('RLS — tickets / ticket_items', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let waiter: Awaited<ReturnType<typeof createUserClient>>
  let cashier: Awaited<ReturnType<typeof createUserClient>>
  let kitchen: Awaited<ReturnType<typeof createUserClient>>
  let outsider: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string
  let menuItemId: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('tkOwn') })
    waiter = await createUserClient({ email: uniqueEmail('tkWai') })
    cashier = await createUserClient({ email: uniqueEmail('tkCas') })
    kitchen = await createUserClient({ email: uniqueEmail('tkKit') })
    outsider = await createUserClient({ email: uniqueEmail('tkOut') })

    tenant = await createTenant({
      name: 'Tickets Bar',
      slug: uniqueSlug('tk-bar'),
      ownerId: owner.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
      { tenant_id: tenant.id, user_id: cashier.userId, role: 'cashier' },
      { tenant_id: tenant.id, user_id: kitchen.userId, role: 'kitchen' },
    ])

    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'TK-1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('failed seed pt')
    qrToken = pt.qr_token

    const { data: cat } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenant.id, name: 'Tragos' })
      .select('id')
      .single()
    if (!cat) throw new Error('failed seed cat')

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
    if (!item) throw new Error('failed seed item')
    menuItemId = item.id

    // La sesión la abre el staff (ya no hay auto-create al escanear el QR).
    await owner.client.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 2,
      p_source: 'manual',
      p_alias: null,
    })
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(waiter.userId)
    await deleteUser(cashier.userId)
    await deleteUser(kitchen.userId)
    await deleteUser(outsider.userId)
  })

  it('comensal anon submit_ticket crea ticket pending', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: 'idem-001',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'pending', total_items: 2, idempotent_replay: false })
  })

  it('submit_ticket es idempotente con misma idempotency_key', async () => {
    const anon = getAnonClient()
    const { data } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowser1234567',
      p_items: [
        { menu_item_id: menuItemId, quantity: 99, notes: null, assigned_to_guest_id: null },
      ],
      p_idempotency_key: 'idem-001',
    })
    expect(data).toMatchObject({ idempotent_replay: true })
  })

  it('owner authenticated NO puede insertar ticket directamente', async () => {
    const { error } = await owner.client.from('tickets').insert({
      tenant_id: tenant.id,
      session_id: '00000000-0000-0000-0000-000000000000',
      status: 'pending',
    })
    expect(error).not.toBeNull()
  })

  it('waiter accept_ticket marca como accepted', async () => {
    const service = getServiceClient()
    const { data: tk } = await service
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending')
      .limit(1)
      .single()
    if (!tk) throw new Error('no pending ticket to accept')

    const { data, error } = await waiter.client.rpc('accept_ticket', { p_ticket_id: tk.id })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'accepted' })
  })

  it('cashier no puede accept_ticket (role no permitido)', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCash123',
      p_display_name: null,
    })
    const { data: submitData } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCash123',
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: `idem-${Date.now()}`,
    })
    const tkId = (submitData as { ticket_id: string }).ticket_id

    const { error } = await cashier.client.rpc('accept_ticket', { p_ticket_id: tkId })
    expect(error?.message).toMatch(/role_not_allowed|forbidden/)
  })

  it('kitchen puede update_ticket_status accepted -> preparing', async () => {
    const service = getServiceClient()
    const { data: tk } = await service
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'accepted')
      .limit(1)
      .single()
    if (!tk) throw new Error('no accepted ticket')

    const { error } = await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: tk.id,
      p_new_status: 'preparing',
    })
    expect(error).toBeNull()
  })

  it('kitchen NO puede marcar served (solo waiter/owner)', async () => {
    const service = getServiceClient()
    const { data: tk } = await service
      .from('tickets')
      .update({ status: 'ready' })
      .eq('tenant_id', tenant.id)
      .eq('status', 'preparing')
      .select('id')
      .limit(1)
      .single()
    if (!tk) throw new Error('no preparing ticket')

    const { error } = await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: tk.id,
      p_new_status: 'served',
    })
    expect(error?.message).toMatch(/invalid_transition_or_role|role_not_allowed/)
  })

  it('outsider no puede ver tickets del tenant', async () => {
    const { data } = await outsider.client.from('tickets').select('id').eq('tenant_id', tenant.id)
    expect(data?.length ?? 0).toBe(0)
  })

  it('cancel_pending_ticket falla si ticket ya está accepted', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCancel1',
      p_display_name: null,
    })
    const { data: submitData } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserCancel1',
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: `idem-cancel-${Date.now()}`,
    })
    const tkId = (submitData as { ticket_id: string }).ticket_id
    await waiter.client.rpc('accept_ticket', { p_ticket_id: tkId })

    const { error } = await anon.rpc('cancel_pending_ticket', {
      p_ticket_id: tkId,
      p_browser_token: 'tkBrowserCancel1',
    })
    expect(error?.message).toContain('ticket_not_cancellable')
  })

  it('add_staff_ticket por waiter crea ticket en accepted', async () => {
    const service = getServiceClient()
    const { data: sess } = await service
      .from('table_sessions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .limit(1)
      .single()
    if (!sess) throw new Error('no session')

    const { data, error } = await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sess.id,
      p_items: [
        {
          menu_item_id: menuItemId,
          quantity: 1,
          notes: 'cortesía',
          assigned_to_guest_id: null,
        },
      ],
      p_assigned_to_guest_id: null,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'accepted' })
  })

  it('cancel_ticket_item por kitchen marca cancelled_at', async () => {
    const service = getServiceClient()
    // Scope a este tenant: con tests en paralelo, ticket_items de otros tenants
    // pueden colarse en un query sin filtro y kitchen no es miembro de ellos.
    const { data: myTickets } = await service
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
    const myTicketIds = (myTickets ?? []).map((t) => t.id)
    const { data: ti } = await service
      .from('ticket_items')
      .select('id')
      .in('ticket_id', myTicketIds)
      .is('cancelled_at', null)
      .limit(1)
      .single()
    if (!ti) throw new Error('no item')

    const { error } = await kitchen.client.rpc('cancel_ticket_item', {
      p_ticket_item_id: ti.id,
      p_reason: 'sin stock',
    })
    expect(error).toBeNull()
  })

  it('request_bill escribe evento bill_requested', async () => {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserBill456',
      p_display_name: null,
    })
    const { data, error } = await anon.rpc('request_bill', {
      p_qr_token: qrToken,
      p_browser_token: 'tkBrowserBill456',
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ requested: true })
  })
})

describeIfRls('RLS — update_ticket_status con kitchen_flow_enabled', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let waiter: Awaited<ReturnType<typeof createUserClient>>
  let kitchen: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrToken: string
  let menuItemId: string

  // Crea un ticket fresco en estado 'accepted' y devuelve su id.
  async function freshAcceptedTicket(browserToken: string): Promise<string> {
    const anon = getAnonClient()
    await anon.rpc('join_session_as_guest', {
      p_qr_token: qrToken,
      p_browser_token: browserToken,
      p_display_name: null,
    })
    const { data: submit } = await anon.rpc('submit_ticket', {
      p_qr_token: qrToken,
      p_browser_token: browserToken,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_idempotency_key: `kf-${browserToken}`,
    })
    const ticketId = (submit as { ticket_id: string }).ticket_id
    await owner.client.rpc('accept_ticket', { p_ticket_id: ticketId })
    return ticketId
  }

  async function setKitchenFlow(enabled: boolean) {
    const service = getServiceClient()
    await service.from('tenants').update({ kitchen_flow_enabled: enabled }).eq('id', tenant.id)
  }

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('kfOwn') })
    waiter = await createUserClient({ email: uniqueEmail('kfWai') })
    kitchen = await createUserClient({ email: uniqueEmail('kfKit') })
    tenant = await createTenant({
      name: 'Kitchen Flow Bar',
      slug: uniqueSlug('kf-bar'),
      ownerId: owner.userId,
    })
    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
      { tenant_id: tenant.id, user_id: kitchen.userId, role: 'kitchen' },
    ])
    const { data: pt } = await service
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'KF-1' })
      .select('qr_token')
      .single()
    if (!pt) throw new Error('seed pt failed')
    qrToken = pt.qr_token
    // Activar la mesa (owner) para que el comensal pueda submit.
    await owner.client.rpc('activate_table_session', {
      p_qr_token: qrToken,
      p_party_size: 2,
      p_source: 'manual',
      p_alias: null,
    })
    const { data: cat } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenant.id, name: 'Café' })
      .select('id')
      .single()
    if (!cat) throw new Error('seed cat failed')
    const { data: item } = await service
      .from('menu_items')
      .insert({ tenant_id: tenant.id, category_id: cat.id, name: 'Cortado', price_cents: 90000 })
      .select('id')
      .single()
    if (!item) throw new Error('seed item failed')
    menuItemId = item.id
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(waiter.userId)
    await deleteUser(kitchen.userId)
  })

  it('flag OFF: waiter puede accepted → preparing', async () => {
    await setKitchenFlow(false)
    const ticketId = await freshAcceptedTicket('kfOffWaiter12345')
    const { error } = await waiter.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'preparing',
    })
    expect(error).toBeNull()
  })

  it('flag ON: waiter NO puede accepted → preparing', async () => {
    await setKitchenFlow(true)
    const ticketId = await freshAcceptedTicket('kfOnWaiter123456')
    const { error } = await waiter.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'preparing',
    })
    expect(error?.message).toMatch(/invalid_transition_or_role|role_not_allowed/)
  })

  it('flag ON: kitchen sí puede accepted → preparing', async () => {
    await setKitchenFlow(true)
    const ticketId = await freshAcceptedTicket('kfOnKitchen12345')
    const { error } = await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'preparing',
    })
    expect(error).toBeNull()
  })

  it('flag ON: owner puede accepted → preparing (override)', async () => {
    await setKitchenFlow(true)
    const ticketId = await freshAcceptedTicket('kfOnOwner1234567')
    const { error } = await owner.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'preparing',
    })
    expect(error).toBeNull()
  })

  it('flag ON: waiter sí puede ready → served (entregar es del mozo)', async () => {
    await setKitchenFlow(true)
    const ticketId = await freshAcceptedTicket('kfOnServe1234567')
    // Llevar a ready vía kitchen.
    await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'preparing',
    })
    await kitchen.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'ready',
    })
    const { error } = await waiter.client.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'served',
    })
    expect(error).toBeNull()
  })
})
