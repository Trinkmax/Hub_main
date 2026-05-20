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

describeIfRls('RLS — salon_reservations + commission_ledger', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let managerLuzA: { id: string }
  let templateA: { id: string }
  let reservationA: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('sr-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('sr-cashier') })
    waiterA = await createUserClient({ email: uniqueEmail('sr-waiter') })
    ownerB = await createUserClient({ email: uniqueEmail('sr-ownerB') })
    tenantA = await createTenant({
      name: 'Bar SR A',
      slug: uniqueSlug('sr-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar SR B',
      slug: uniqueSlug('sr-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()

    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])

    // Configurar capacidades default + gestor + tarifa para tenantA
    await service
      .from('tenants')
      .update({
        settings: { salon_capacities: { planta_alta: 50, planta_baja: 50 } },
      })
      .eq('id', tenantA.id)

    const { data: mgr } = await service
      .from('reservation_managers')
      .insert({
        tenant_id: tenantA.id,
        display_name: 'Luz Test',
        commission_eligible: true,
        active: true,
      })
      .select('id')
      .single()
    managerLuzA = mgr as { id: string }

    const { data: tpl } = await service
      .from('scheduled_event_templates')
      .insert({
        tenant_id: tenantA.id,
        name: 'Test Libre',
        slug: 'test-libre',
        consume_special_reservations: true,
        default_capacity: 20,
        default_meal_type: 'dinner',
        color_hex: '#0ea5e9',
      })
      .select('id')
      .single()
    templateA = tpl as { id: string }

    await service.from('commission_rate_tiers').insert([
      {
        tenant_id: tenantA.id,
        meal_type: 'dinner',
        min_guests: 1,
        max_guests: null,
        rate_per_guest_cents: 9000,
        active: true,
      },
    ])
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (waiterA) await deleteUser(waiterA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('cashier de A crea reserva → ok, recibe el row', async () => {
    const { data, error } = await cashierA.client
      .from('salon_reservations')
      .insert({
        tenant_id: tenantA.id,
        guest_name: 'Test Juan',
        meal_type: 'dinner',
        reservation_date: '2026-12-31',
        reservation_time_local: '21:30',
        zone: 'planta_alta',
        estimated_guests: 4,
        origin: 'whatsapp',
        primary_manager_id: managerLuzA.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    reservationA = data as { id: string }
  })

  it('owner B NO ve reservas de A', async () => {
    const { data } = await ownerB.client
      .from('salon_reservations')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('cashier A NO puede crear reserva con tenant_id de B (RLS with_check)', async () => {
    const { error } = await cashierA.client.from('salon_reservations').insert({
      tenant_id: tenantB.id,
      guest_name: 'Cross Tenant',
      meal_type: 'dinner',
      reservation_date: '2026-12-31',
      reservation_time_local: '21:30',
      zone: 'planta_alta',
      estimated_guests: 4,
      origin: 'whatsapp',
      primary_manager_id: managerLuzA.id,
    })
    expect(error).not.toBeNull()
  })

  it('waiter A NO puede INSERT directo (RLS sr_staff_write excluye waiter)', async () => {
    const { error } = await waiterA.client.from('salon_reservations').insert({
      tenant_id: tenantA.id,
      guest_name: 'Waiter Tried',
      meal_type: 'dinner',
      reservation_date: '2026-12-31',
      reservation_time_local: '22:00',
      zone: 'planta_alta',
      estimated_guests: 2,
      origin: 'whatsapp',
      primary_manager_id: managerLuzA.id,
    })
    expect(error).not.toBeNull()
  })

  it('waiter A SÍ puede ejecutar transition_reservation_status (RPC SECURITY DEFINER)', async () => {
    const { data, error } = await waiterA.client.rpc('transition_reservation_status', {
      p_reservation_id: reservationA.id,
      p_to: 'arrived',
      p_actual_guests: null,
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row?.status).toBe('arrived')
  })

  it('evaluate_day_capacity devuelve buckets para tenantA', async () => {
    const { data, error } = await cashierA.client.rpc('evaluate_day_capacity', {
      p_tenant_id: tenantA.id,
      p_date: '2026-12-31',
    })
    expect(error).toBeNull()
    const buckets = (data ?? []) as Array<{ bucket: string; capacity: number; used: number }>
    const pa = buckets.find((b) => b.bucket === 'zone:planta_alta')
    expect(pa?.capacity).toBe(50)
    expect(pa?.used).toBeGreaterThanOrEqual(4)
  })

  it('owner B NO puede evaluar capacidad de A', async () => {
    const { error } = await ownerB.client.rpc('evaluate_day_capacity', {
      p_tenant_id: tenantA.id,
      p_date: '2026-12-31',
    })
    expect(error?.message).toContain('forbidden')
  })

  it('owner A puede cerrar mesa con cantidad real → genera entry en commission_ledger', async () => {
    const { error } = await ownerA.client.rpc('transition_reservation_status', {
      p_reservation_id: reservationA.id,
      p_to: 'seated',
      p_actual_guests: null,
    })
    expect(error).toBeNull()

    const { error: closeError } = await ownerA.client.rpc('transition_reservation_status', {
      p_reservation_id: reservationA.id,
      p_to: 'closed',
      p_actual_guests: 5,
    })
    expect(closeError).toBeNull()

    const { data: ledger } = await ownerA.client
      .from('commission_ledger')
      .select('id, manager_id, payable_cents, guests_billed')
      .eq('reservation_id', reservationA.id)
    expect(ledger?.length).toBe(1)
    expect(ledger?.[0]?.payable_cents).toBe(5 * 9000)
    expect(ledger?.[0]?.guests_billed).toBe(5)
  })

  it('cashier A NO ve commission_ledger (solo owner)', async () => {
    const { data } = await cashierA.client
      .from('commission_ledger')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('owner B NO ve commission_ledger de A', async () => {
    const { data } = await ownerB.client
      .from('commission_ledger')
      .select('id')
      .eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('scheduled_events: cashier puede crear; waiter no', async () => {
    const { data: ev, error } = await cashierA.client
      .from('scheduled_events')
      .insert({
        tenant_id: tenantA.id,
        template_id: templateA.id,
        event_date: '2026-12-30',
        starts_at_local: '21:00',
        capacity: 20,
        meal_type: 'dinner',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(ev?.id).toBeTruthy()

    const { error: waiterErr } = await waiterA.client.from('scheduled_events').insert({
      tenant_id: tenantA.id,
      template_id: templateA.id,
      event_date: '2026-12-29',
      starts_at_local: '21:00',
      capacity: 20,
      meal_type: 'dinner',
    })
    expect(waiterErr).not.toBeNull()
  })

  it('mark_commission_paid: solo owner del tenant', async () => {
    const { data: ledgerRow } = await ownerA.client
      .from('commission_ledger')
      .select('id')
      .eq('reservation_id', reservationA.id)
      .limit(1)
      .single()

    // owner B intenta marcar paga → 0 actualizadas
    const { data: nB } = await ownerB.client.rpc('mark_commission_paid', {
      p_ledger_ids: [ledgerRow?.id],
      p_paid_at: new Date().toISOString(),
    })
    expect(nB).toBe(0)

    // owner A → 1 actualizada
    const { data: nA } = await ownerA.client.rpc('mark_commission_paid', {
      p_ledger_ids: [ledgerRow?.id],
      p_paid_at: new Date().toISOString(),
    })
    expect(nA).toBe(1)
  })
})
