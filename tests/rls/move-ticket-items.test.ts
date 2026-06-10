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

// Helpers locales ---------------------------------------------------------

type Svc = ReturnType<typeof getServiceClient>

async function seedMenuItem(svc: Svc, tenantId: string, priceCents: number) {
  const { data: cat } = await svc
    .from('menu_categories')
    .insert({ tenant_id: tenantId, name: 'Tragos' })
    .select('id')
    .single()
  if (!cat) throw new Error('seed cat failed')
  const { data: item } = await svc
    .from('menu_items')
    .insert({ tenant_id: tenantId, category_id: cat.id, name: 'Birra', price_cents: priceCents })
    .select('id')
    .single()
  if (!item) throw new Error('seed item failed')
  return item.id as string
}

async function openSessionOnTable(
  client: Awaited<ReturnType<typeof createUserClient>>['client'],
  qrToken: string,
): Promise<string> {
  // activate_table_session devuelve { session_id, ... } — usar ESE id, no un
  // select global "última sesión open" (que en tests acumulados devolvería otra mesa).
  const { data, error } = await client.rpc('activate_table_session', {
    p_qr_token: qrToken,
    p_party_size: 2,
    p_source: 'manual',
    p_alias: null,
  })
  if (error || !data) throw new Error(`activate failed: ${error?.message}`)
  return (data as { session_id: string }).session_id
}

describeIfRls('RPC — move_ticket_items', () => {
  let owner: Awaited<ReturnType<typeof createUserClient>>
  let waiter: Awaited<ReturnType<typeof createUserClient>>
  let cashier: Awaited<ReturnType<typeof createUserClient>>
  let tenant: { id: string; slug: string }
  let qrA: string
  let qrC: string
  let tableA: string
  let tableB: string
  let menuItemId: string

  beforeAll(async () => {
    owner = await createUserClient({ email: uniqueEmail('miOwn') })
    waiter = await createUserClient({ email: uniqueEmail('miWai') })
    cashier = await createUserClient({ email: uniqueEmail('miCas') })
    tenant = await createTenant({
      name: 'Move Items Bar',
      slug: uniqueSlug('mi-bar'),
      ownerId: owner.userId,
    })
    const svc = getServiceClient()
    await svc.from('memberships').insert([
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
      { tenant_id: tenant.id, user_id: cashier.userId, role: 'cashier' },
    ])
    const { data: a } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-A' })
      .select('id, qr_token')
      .single()
    const { data: b } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-B' })
      .select('id, qr_token')
      .single()
    const { data: c } = await svc
      .from('physical_tables')
      .insert({ tenant_id: tenant.id, label: 'MI-C' })
      .select('id, qr_token')
      .single()
    if (!a || !b || !c) throw new Error('seed tables failed')
    tableA = a.id
    tableB = b.id
    qrA = a.qr_token
    qrC = c.qr_token
    menuItemId = await seedMenuItem(svc, tenant.id, 100000) // $1000
  })

  afterAll(async () => {
    await deleteUser(owner.userId)
    await deleteUser(waiter.userId)
    await deleteUser(cashier.userId)
  })

  it('mueve cantidad parcial a una mesa libre: crea sesión destino, descuenta origen, cuadran totales', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    // 3 birras compartidas
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 3, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id, ticket_id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no item')

    const { data, error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: 'mv-partial-1',
    })
    expect(error).toBeNull()
    const res = data as { target_session_id: string; moved_count: number }
    expect(res.moved_count).toBe(1)

    // Origen: la línea quedó en 2.
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('quantity, line_total_cents')
      .eq('id', item.id)
      .single()
    expect(srcItem?.quantity).toBe(2)
    expect(srcItem?.line_total_cents).toBe(200000)

    // Destino: sesión open nueva en B con un ticket served + 1 ítem.
    const { data: destSess } = await svc
      .from('table_sessions')
      .select('id, total_cents, status')
      .eq('id', res.target_session_id)
      .single()
    expect(destSess?.status).toBe('open')
    expect(destSess?.total_cents).toBe(100000)

    const { data: srcSess } = await svc
      .from('table_sessions')
      .select('total_cents')
      .eq('id', sessA)
      .single()
    expect(srcSess?.total_cents).toBe(200000)

    const { data: destTicket } = await svc
      .from('tickets')
      .select('status')
      .eq('session_id', res.target_session_id)
      .single()
    expect(destTicket?.status).toBe('served')
  })

  it('move total soft-cancela el ítem origen', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id, quantity')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no item')

    await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: item.quantity, assign: 'auto' }],
      p_idempotency_key: `mv-full-${item.id}`,
    })
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('cancelled_at, cancellation_reason')
      .eq('id', item.id)
      .single()
    expect(srcItem?.cancelled_at).not.toBeNull()
    expect(srcItem?.cancellation_reason).toMatch(/Movido a/i)
  })

  it('auto-carry: un ítem de cliente registrado crea/asocia su comensal en destino', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    // Cliente registrado + comensal en sesión A.
    const { data: cust } = await svc
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: 'Ana',
        last_name: 'Registrada',
        phone: `+54935100${Math.floor(Math.random() * 90000) + 10000}`,
      })
      .select('id')
      .single()
    if (!cust) throw new Error('no customer')
    const { data: guest } = await svc
      .from('session_guests')
      .insert({
        session_id: sessA,
        browser_token: `guestAna${Math.floor(Math.random() * 1e9)}`,
        display_name: 'Ana',
        customer_id: cust.id,
      })
      .select('id')
      .single()
    if (!guest) throw new Error('no guest')
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [
        { menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: guest.id },
      ],
      p_assigned_to_guest_id: guest.id,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .eq('assigned_to_guest_id', guest.id)
      .is('cancelled_at', null)
      .single()
    if (!item) throw new Error('no assigned item')

    const { data } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-reg-${item.id}`,
    })
    const res = data as { target_session_id: string }
    // El comensal del destino tiene el mismo customer_id.
    const { data: destGuests } = await svc
      .from('session_guests')
      .select('customer_id')
      .eq('session_id', res.target_session_id)
    expect((destGuests ?? []).some((g) => g.customer_id === cust.id)).toBe(true)
  })

  it('ítem compartido sigue compartido (assigned_to_guest_id null en destino)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('assigned_to_guest_id', null)
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!item) throw new Error('no shared item')

    const { data } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-shared-${item.id}`,
    })
    const res = data as { target_ticket_id: string }
    const { data: destItems } = await svc
      .from('ticket_items')
      .select('assigned_to_guest_id')
      .eq('ticket_id', res.target_ticket_id)
    expect((destItems ?? []).every((i) => i.assigned_to_guest_id === null)).toBe(true)
  })

  it('cashier no puede mover ítems (rol no permitido)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const { error } = await cashier.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-cash-${item?.id}`,
    })
    expect(error?.message).toMatch(/role_not_allowed|forbidden/)
  })

  it('rechaza mover a la misma mesa', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const { error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessA,
      p_target_table_id: tableA,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-same-${item?.id}`,
    })
    expect(error?.message).toMatch(/same_table_move/)
  })

  it('es idempotente con la misma idempotency_key (no duplica el movimiento)', async () => {
    const svc = getServiceClient()
    const sessA = await openSessionOnTable(waiter.client, qrA)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessA,
      p_items: [{ menu_item_id: menuItemId, quantity: 2, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    const key = `mv-idem-${item?.id}`
    const args = {
      p_source_session_id: sessA,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: key,
    }
    const first = await waiter.client.rpc('move_ticket_items', args)
    const second = await waiter.client.rpc('move_ticket_items', args)
    expect((second.data as { idempotent: boolean }).idempotent).toBe(true)
    // El ítem origen quedó en 1 (solo se movió una vez), no en 0.
    const { data: srcItem } = await svc
      .from('ticket_items')
      .select('quantity')
      .eq('id', item?.id)
      .single()
    expect(srcItem?.quantity).toBe(1)
    expect((first.data as { target_ticket_id: string }).target_ticket_id).toBe(
      (second.data as { target_ticket_id: string }).target_ticket_id,
    )
  })

  it('rechaza si la sesión origen no está open', async () => {
    const svc = getServiceClient()
    const sessC = await openSessionOnTable(waiter.client, qrC)
    await waiter.client.rpc('add_staff_ticket', {
      p_session_id: sessC,
      p_items: [{ menu_item_id: menuItemId, quantity: 1, notes: null, assigned_to_guest_id: null }],
      p_assigned_to_guest_id: null,
    })
    const { data: item } = await svc
      .from('ticket_items')
      .select('id')
      .is('cancelled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    await svc
      .from('table_sessions')
      .update({ status: 'abandoned', abandoned_reason: 'test' })
      .eq('id', sessC)
    const { error } = await waiter.client.rpc('move_ticket_items', {
      p_source_session_id: sessC,
      p_target_table_id: tableB,
      p_moves: [{ ticket_item_id: item?.id, quantity: 1, assign: 'auto' }],
      p_idempotency_key: `mv-closed-${item?.id}`,
    })
    expect(error?.message).toMatch(/session_not_open/)
  })
})
