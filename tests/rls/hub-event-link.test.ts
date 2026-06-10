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

describeIfRls('RLS — link salon_reservation ↔ event', () => {
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let eventId: string
  let eventBId: string
  let managerId: string

  async function makeReservation(guests: number, name: string): Promise<string> {
    const service = getServiceClient()
    const { data, error } = await service
      .from('salon_reservations')
      .insert({
        tenant_id: tenantA.id,
        guest_name: name,
        kind: 'normal',
        meal_type: 'hub_event',
        reservation_date: '2026-06-20',
        reservation_time_local: '21:00:00',
        zone: 'planta_alta',
        estimated_guests: guests,
        origin: 'in_person',
        primary_manager_id: managerId,
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  }

  beforeAll(async () => {
    cashierA = await createUserClient({ email: uniqueEmail('hub-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('hub-ownerB') })
    const ownerA = await createUserClient({ email: uniqueEmail('hub-ownerA') })
    tenantA = await createTenant({
      name: 'Bar A',
      slug: uniqueSlug('hub-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar B',
      slug: uniqueSlug('hub-b'),
      ownerId: ownerB.userId,
    })
    const service = getServiceClient()
    await service.from('memberships').insert({
      tenant_id: tenantA.id,
      user_id: cashierA.userId,
      role: 'cashier',
    })

    const { data: mgr } = await service
      .from('reservation_managers')
      .insert({ tenant_id: tenantA.id, display_name: 'Gestor A' })
      .select('id')
      .single()
    managerId = (mgr as { id: string }).id

    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    const { data: ev } = await service
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Trivia',
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 4,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single()
    eventId = (ev as { id: string }).id

    const { data: evB } = await service
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Peña B',
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: 10,
        waitlist_enabled: true,
        status: 'published',
      })
      .select('id')
      .single()
    eventBId = (evB as { id: string }).id
  })

  afterAll(async () => {
    if (cashierA) await deleteUser(cashierA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('linkea como confirmed cuando hay cupo; invitado sin cliente', async () => {
    const resId = await makeReservation(3, 'Juan Invitado')
    const { data, error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    expect(error).toBeNull()
    const r = Array.isArray(data) ? data[0] : data
    expect(r?.status).toBe('confirmed')

    const service = getServiceClient()
    const { data: mirror } = await service
      .from('event_attendees')
      .select('customer_id, guests_count, salon_reservation_id, status')
      .eq('salon_reservation_id', resId)
      .single()
    expect(mirror?.customer_id).toBeNull()
    expect(mirror?.guests_count).toBe(3)
    expect(mirror?.status).toBe('confirmed')

    const { data: res } = await service
      .from('salon_reservations')
      .select('hub_event_id')
      .eq('id', resId)
      .single()
    expect(res?.hub_event_id).toBe(eventId)
  })

  it('al pasarse de cupo va a waitlist', async () => {
    const resId = await makeReservation(2, 'Ana Espera')
    const { data } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    const r = Array.isArray(data) ? data[0] : data
    expect(r?.status).toBe('waitlist')
    expect(r?.waitlist_position).toBe(1)
  })

  it('unlink libera cupo y promueve waitlist', async () => {
    const service = getServiceClient()
    const { data: conf } = await service
      .from('event_attendees')
      .select('salon_reservation_id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .not('salon_reservation_id', 'is', null)
      .limit(1)
      .single()
    const target = (conf as { salon_reservation_id: string }).salon_reservation_id

    const { data, error } = await cashierA.client.rpc('unlink_salon_reservation_from_event', {
      p_reservation_id: target,
    })
    expect(error).toBeNull()
    const r = Array.isArray(data) ? data[0] : data
    expect(r?.promoted_id).toBeTruthy()

    const { data: res } = await service
      .from('salon_reservations')
      .select('hub_event_id')
      .eq('id', target)
      .single()
    expect(res?.hub_event_id).toBeNull()
  })

  it('guests > capacity bloqueado', async () => {
    const resId = await makeReservation(99, 'Grupo Grande')
    const { error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventId,
    })
    expect(error?.message).toContain('guests_exceed_capacity')
  })

  it('cross-tenant: no se linkea a un evento de otro local', async () => {
    const resId = await makeReservation(1, 'Cross')
    const { error } = await cashierA.client.rpc('link_salon_reservation_to_event', {
      p_reservation_id: resId,
      p_event_id: eventBId,
    })
    expect(error?.message).toMatch(/forbidden|tenant_mismatch/)
  })

  it('owner B no ve los anotados de A', async () => {
    const { data } = await ownerB.client
      .from('event_attendees')
      .select('id')
      .eq('event_id', eventId)
    expect(data ?? []).toEqual([])
  })
})
