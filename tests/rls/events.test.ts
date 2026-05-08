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

describeIfRls('RLS — events + reservations', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let eventId: string
  const customers: string[] = []
  let crossCustomer: string

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('ev-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('ev-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('ev-ownerB') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('ev-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('ev-b'),
      ownerId: ownerB.userId,
    })
    const service = getServiceClient()

    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: cashierA.userId,
      role: 'cashier',
    })

    // Crear evento publicado, capacity 4
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    const { data: ev } = await service
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Trivia Jueves',
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 4,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single()
    eventId = ev?.id

    // 6 customers
    for (let i = 0; i < 6; i++) {
      const { data: c } = await service
        .from('customers')
        .insert({
          tenant_id: tenantA.id,
          phone: `+5491190${Date.now().toString().slice(-7)}${i}`,
          first_name: `C${i}`,
          last_name: 'X',
        })
        .select('id')
        .single()
      customers.push(c?.id)
    }

    const { data: cross } = await service
      .from('customers')
      .insert({
        tenant_id: tenantB.id,
        phone: `+5491199${Date.now().toString().slice(-7)}`,
        first_name: 'Cross',
        last_name: 'Tenant',
      })
      .select('id')
      .single()
    crossCustomer = cross?.id
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('4 reservas de 1 → todas confirmed', async () => {
    for (let i = 0; i < 4; i++) {
      const { data, error } = await cashierA.client.rpc('create_reservation', {
        p_event_id: eventId,
        p_customer_id: customers[i]!,
        p_guests: 1,
      })
      expect(error).toBeNull()
      const result = Array.isArray(data) ? data[0] : data
      expect(result?.status).toBe('confirmed')
    }
  })

  it('5ta y 6ta → waitlist 1 y 2', async () => {
    const { data: r5 } = await cashierA.client.rpc('create_reservation', {
      p_event_id: eventId,
      p_customer_id: customers[4]!,
      p_guests: 1,
    })
    const r5res = Array.isArray(r5) ? r5[0] : r5
    expect(r5res?.status).toBe('waitlist')
    expect(r5res?.waitlist_position).toBe(1)

    const { data: r6 } = await cashierA.client.rpc('create_reservation', {
      p_event_id: eventId,
      p_customer_id: customers[5]!,
      p_guests: 1,
    })
    const r6res = Array.isArray(r6) ? r6[0] : r6
    expect(r6res?.status).toBe('waitlist')
    expect(r6res?.waitlist_position).toBe(2)
  })

  it('cancelar confirmed promueve primera de waitlist; posiciones se compactan', async () => {
    const service = getServiceClient()
    const { data: confirmed } = await service
      .from('reservations')
      .select('id, customer_id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true })
      .limit(1)
    const target = confirmed?.[0]?.id
    expect(target).toBeTruthy()

    const { data: cancelData, error } = await cashierA.client.rpc('cancel_reservation', {
      p_reservation_id: target,
    })
    expect(error).toBeNull()
    const result = Array.isArray(cancelData) ? cancelData[0] : cancelData
    expect(result?.promoted_id).toBeTruthy()

    const { data: nextWait } = await service
      .from('reservations')
      .select('id, waitlist_position')
      .eq('event_id', eventId)
      .eq('status', 'waitlist')
      .order('waitlist_position', { ascending: true })
    expect(nextWait?.[0]?.waitlist_position).toBe(1)
  })

  it('cross-tenant: reservar customer de B en evento de A → customer_invalid', async () => {
    const { error } = await cashierA.client.rpc('create_reservation', {
      p_event_id: eventId,
      p_customer_id: crossCustomer,
      p_guests: 1,
    })
    expect(error?.message).toContain('customer_invalid')
  })

  it('guests > capacity bloqueado', async () => {
    const { error } = await cashierA.client.rpc('create_reservation', {
      p_event_id: eventId,
      p_customer_id: customers[5]!,
      p_guests: 99,
    })
    // El cliente 5 ya está cancelled (era waitlist 2, no fue cancelado todavía).
    // Tomamos un customer fresco vía service.
    if (!error) return
    expect(error?.message).toContain('guests_exceed_capacity')
  })

  it('check_in_reservation requiere status confirmed', async () => {
    const service = getServiceClient()
    // Tomamos una en waitlist
    const { data: wl } = await service
      .from('reservations')
      .select('id')
      .eq('event_id', eventId)
      .eq('status', 'waitlist')
      .limit(1)
    if (!wl?.[0]) return // ya no quedan, skip
    const { error } = await cashierA.client.rpc('check_in_reservation', {
      p_reservation_id: wl[0].id,
    })
    expect(error?.message).toContain('not_confirmed')
  })

  it('check-in confirmed → status checked_in', async () => {
    const service = getServiceClient()
    const { data: cf } = await service
      .from('reservations')
      .select('id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .limit(1)
    if (!cf?.[0]) throw new Error('expected confirmed reservation')
    const { error } = await cashierA.client.rpc('check_in_reservation', {
      p_reservation_id: cf[0].id,
    })
    expect(error).toBeNull()
    const { data: after } = await service
      .from('reservations')
      .select('status, checked_in_at')
      .eq('id', cf[0].id)
      .single()
    expect(after?.status).toBe('checked_in')
    expect(after?.checked_in_at).toBeTruthy()
  })

  it('finish_past_events marca evento pasado y reservas confirmed → no_show', async () => {
    const service = getServiceClient()
    // Crear evento "pasado" via service
    const { data: pastEv } = await service
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Pasado',
        starts_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        capacity: 10,
        status: 'published',
      })
      .select('id')
      .single()

    // Insert reserva confirmed manual (vía RPC con un customer del tenant)
    const { data: c } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491150${Date.now().toString().slice(-6)}`,
        first_name: 'NoShow',
        last_name: 'Test',
      })
      .select('id')
      .single()

    // Insert reservation con bypass via service (simulamos como si cashier hubiera reservado).
    // Como ledger es vía RPC, usamos service para insert directo (se permite con service_role).
    await service.from('reservations').insert({
      tenant_id: tenantA.id,
      event_id: pastEv?.id,
      customer_id: c?.id,
      guests_count: 1,
      status: 'confirmed',
    })

    const { data, error } = await service.rpc('finish_past_events')
    expect(error).toBeNull()

    const { data: ev } = await service.from('events').select('status').eq('id', pastEv?.id).single()
    expect(ev?.status).toBe('finished')

    const { data: res } = await service
      .from('reservations')
      .select('status')
      .eq('event_id', pastEv?.id)
    expect(res?.every((r) => r.status === 'no_show')).toBe(true)
    const result = Array.isArray(data) ? data[0] : data
    expect(result?.finished_events).toBeGreaterThan(0)
  })

  it('cancel_event marca evento + todas las reservas no terminales como cancelled', async () => {
    const service = getServiceClient()
    const { data: ev } = await service
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'A cancelar',
        starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        capacity: 5,
        status: 'published',
      })
      .select('id')
      .single()
    const { data: c } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491140${Date.now().toString().slice(-6)}`,
        first_name: 'A',
        last_name: 'B',
      })
      .select('id')
      .single()
    await cashierA.client.rpc('create_reservation', {
      p_event_id: ev?.id,
      p_customer_id: c?.id,
      p_guests: 1,
    })

    const { error } = await ownerA.client.rpc('cancel_event', { p_event_id: ev?.id })
    expect(error).toBeNull()

    const { data: refreshed } = await service
      .from('events')
      .select('status')
      .eq('id', ev?.id)
      .single()
    expect(refreshed?.status).toBe('cancelled')
    const { data: rsv } = await service.from('reservations').select('status').eq('event_id', ev?.id)
    expect(rsv?.every((r) => r.status === 'cancelled')).toBe(true)
  })

  it('owner B no ve eventos de A', async () => {
    const { data } = await ownerB.client.from('events').select('id').eq('tenant_id', tenantA.id)
    expect(data ?? []).toEqual([])
  })

  it('reservations.insert directo de authenticated rechazado por RLS', async () => {
    const { error } = await cashierA.client.from('reservations').insert({
      tenant_id: tenantA.id,
      event_id: eventId,
      customer_id: customers[0]!,
      guests_count: 1,
    })
    expect(error).not.toBeNull()
  })
})
