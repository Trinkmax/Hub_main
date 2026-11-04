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

type UserClient = Awaited<ReturnType<typeof createUserClient>>

const HOOK_TIMEOUT = 180_000
const TEST_TIMEOUT = 60_000

/**
 * Entradas online (20261026120100/20261026120200).
 *
 * 1. La configuración se guarda como la guarda el panel: update y, si no hay
 *    fila, insert (el upsert de PostgREST pondría tenant_id en el SET y el
 *    GRANT de UPDATE por columna lo rechaza). El navegador del dueño NO puede
 *    leer ni escribir el token cifrado de Mercado Pago.
 * 2. Las películas son del dueño y de su bar; el staff y otro bar no las ven.
 * 3. Los pedidos solo los lee el dueño y no los escribe nadie desde la API:
 *    los crea y aplica el server con service_role (funciones de la base).
 * 4. anon no ve nada (las páginas públicas las arma el server).
 */
describeIfRls('RLS — entradas online (películas, configuración, pedidos)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let cashierA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let templateA: string
  let eventA: string
  let experienceA: string

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('tix-owner-a') })
    cashierA = await createUserClient({ email: uniqueEmail('tix-cashier-a') })
    ownerB = await createUserClient({ email: uniqueEmail('tix-owner-b') })
    tenantA = await createTenant({
      name: 'Bar Tix A',
      slug: uniqueSlug('tix-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Tix B',
      slug: uniqueSlug('tix-b'),
      ownerId: ownerB.userId,
    })
    await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' })

    const { data: tpl, error: tplError } = await service
      .from('scheduled_event_templates')
      .insert({
        tenant_id: tenantA.id,
        name: 'Cine Test',
        slug: uniqueSlug('tix-tpl'),
        color_hex: '#3f6aa0',
        default_capacity: 4,
        default_meal_type: 'dinner',
        active: true,
      })
      .select('id')
      .single()
    if (tplError || !tpl) throw new Error(`template insert failed: ${tplError?.message}`)
    templateA = (tpl as { id: string }).id

    const { data: ev, error: evError } = await service
      .from('scheduled_events')
      .insert({
        tenant_id: tenantA.id,
        template_id: templateA,
        event_date: '2031-03-03',
        starts_at_local: '21:00',
        capacity: 4,
        meal_type: 'dinner',
      })
      .select('id')
      .single()
    if (evError || !ev) throw new Error(`event insert failed: ${evError?.message}`)
    eventA = (ev as { id: string }).id
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    await service.from('tenants').delete().in('id', [tenantA?.id, tenantB?.id].filter(Boolean))
    for (const u of [ownerA, cashierA, ownerB]) if (u) await deleteUser(u.userId)
  }, HOOK_TIMEOUT)

  it(
    'el dueño guarda la configuración con update + insert, sin tocar el token',
    async () => {
      const values = { headline: 'Cine y degustación', hold_minutes: 12, updated_by: ownerA.userId }

      const first = await ownerA.client
        .from('ticketing_settings')
        .update(values)
        .eq('tenant_id', tenantA.id)
        .select('tenant_id')
        .maybeSingle()
      expect(first.error).toBeNull()
      expect(first.data).toBeNull() // todavía no hay fila

      const insert = await ownerA.client
        .from('ticketing_settings')
        .insert({ tenant_id: tenantA.id, ...values })
      expect(insert.error).toBeNull()

      const second = await ownerA.client
        .from('ticketing_settings')
        .update({ ...values, hold_minutes: 20 })
        .eq('tenant_id', tenantA.id)
        .select('tenant_id, hold_minutes')
        .maybeSingle()
      expect(second.error).toBeNull()
      expect(second.data).toMatchObject({ hold_minutes: 20 })

      // El token cifrado no se lee ni se escribe desde el navegador.
      const readToken = await ownerA.client
        .from('ticketing_settings')
        .select('mp_access_token_enc')
        .eq('tenant_id', tenantA.id)
      expect(readToken.error?.code).toBe('42501')
      const writeToken = await ownerA.client
        .from('ticketing_settings')
        .update({ mp_access_token_enc: 'x' })
        .eq('tenant_id', tenantA.id)
      expect(writeToken.error?.code).toBe('42501')
    },
    TEST_TIMEOUT,
  )

  it(
    'las películas son del dueño de ese bar',
    async () => {
      const { data, error } = await ownerA.client
        .from('event_experiences')
        .insert({
          tenant_id: tenantA.id,
          template_id: templateA,
          slug: 'cine-test',
          title: 'Cine Test',
          price_cents: 3_500_000,
          deposit_cents: 500_000,
          published: true,
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      experienceA = (data as { id: string }).id

      const cashier = await cashierA.client
        .from('event_experiences')
        .select('id')
        .eq('id', experienceA)
      expect(cashier.data ?? []).toHaveLength(0)

      const other = await ownerB.client.from('event_experiences').select('id').eq('id', experienceA)
      expect(other.data ?? []).toHaveLength(0)

      // Otro bar no puede colgar una película de un formato ajeno (FK compuesta).
      const cross = await ownerB.client.from('event_experiences').insert({
        tenant_id: tenantB.id,
        template_id: templateA,
        slug: 'robada',
        title: 'Robada',
        price_cents: 100_000,
      })
      expect(cross.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'los pedidos los crea el server; el dueño los lee y nadie los escribe por la API',
    async () => {
      const { data: order, error } = await service.rpc('ticketing_create_order', {
        p_tenant_id: tenantA.id,
        p_experience_id: experienceA,
        p_event_id: eventA,
        p_party_size: 2,
        p_option: 'deposit',
        p_guest_name: 'Ana Test',
        p_guest_phone: '+5493510000001',
        p_marketing_opt_in: false,
        p_client_ip: '10.0.0.1',
        p_meal_type: 'dinner',
      })
      expect(error).toBeNull()
      const orderId = (order as { id: string }).id

      const owner = await ownerA.client
        .from('ticket_orders')
        .select('id, total_cents')
        .eq('id', orderId)
      expect(owner.data).toEqual([{ id: orderId, total_cents: 1_000_000 }])

      const cashier = await cashierA.client.from('ticket_orders').select('id').eq('id', orderId)
      expect(cashier.data ?? []).toHaveLength(0)

      const tamper = await ownerA.client
        .from('ticket_orders')
        .update({ status: 'approved' })
        .eq('id', orderId)
      expect(tamper.error?.code).toBe('42501')

      // Las funciones son solo del server.
      const rpc = await ownerA.client.rpc('ticketing_settle_order', {
        p_tenant_id: tenantA.id,
        p_order_id: orderId,
        p_payment_id: '1',
        p_mp_status: 'approved',
        p_mp_status_detail: null,
        p_payment_type: null,
        p_paid_cents: 1_000_000,
        p_paid_at: null,
      })
      expect(rpc.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'anon no ve nada',
    async () => {
      const anon = getAnonClient()
      const exp = await anon.from('event_experiences').select('id').limit(1)
      expect(exp.data ?? []).toHaveLength(0)
      const orders = await anon.from('ticket_orders').select('id').limit(1)
      expect(orders.data ?? []).toHaveLength(0)
    },
    TEST_TIMEOUT,
  )
})

/**
 * La puerta (20261103190000): validar con QR.
 *
 * ticket_orders solo lo lee el dueño, pero en la puerta están mozos, cajeros y la
 * anfitriona: por eso funciones con el rol chequeado adentro. Cocina, otro bar y
 * anon no pasan; y la misma entrada no entra dos veces.
 */
describeIfRls('RLS — la puerta (validar entradas con QR)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let waiterA: UserClient
  let kitchenA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let orderToday: string
  let orderLater: string

  async function paidOrder(eventId: string, experienceId: string, partySize: number) {
    const { data: created, error } = await service.rpc('ticketing_create_order', {
      p_tenant_id: tenantA.id,
      p_experience_id: experienceId,
      p_event_id: eventId,
      p_party_size: partySize,
      p_option: 'deposit',
      p_guest_name: 'Ana Puerta',
      p_guest_phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      p_marketing_opt_in: false,
      p_client_ip: `10.0.${Math.floor(Math.random() * 200)}.1`,
      p_meal_type: 'dinner',
    })
    if (error) throw new Error(`create order failed: ${error.message}`)
    const id = (created as { id: string; total_cents: number }).id
    const total = (created as { id: string; total_cents: number }).total_cents
    const { error: settleError } = await service.rpc('ticketing_settle_order', {
      p_tenant_id: tenantA.id,
      p_order_id: id,
      p_payment_id: id,
      p_mp_status: 'approved',
      p_mp_status_detail: 'accredited',
      p_payment_type: 'credit_card',
      p_paid_cents: total,
      p_paid_at: new Date().toISOString(),
    })
    if (settleError) throw new Error(`settle failed: ${settleError.message}`)
    return id
  }

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('door-owner-a') })
    waiterA = await createUserClient({ email: uniqueEmail('door-waiter-a') })
    kitchenA = await createUserClient({ email: uniqueEmail('door-kitchen-a') })
    ownerB = await createUserClient({ email: uniqueEmail('door-owner-b') })
    tenantA = await createTenant({
      name: 'Bar Puerta A',
      slug: uniqueSlug('door-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Puerta B',
      slug: uniqueSlug('door-b'),
      ownerId: ownerB.userId,
    })
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
      { tenant_id: tenantA.id, user_id: kitchenA.userId, role: 'kitchen' },
    ])

    const { data: tpl, error: tplError } = await service
      .from('scheduled_event_templates')
      .insert({
        tenant_id: tenantA.id,
        name: 'Cine Puerta',
        slug: uniqueSlug('door-tpl'),
        color_hex: '#3f6aa0',
        default_capacity: 20,
        default_meal_type: 'dinner',
        active: true,
      })
      .select('id')
      .single()
    if (tplError || !tpl) throw new Error(`template insert failed: ${tplError?.message}`)
    const templateId = (tpl as { id: string }).id

    const { data: exp, error: expError } = await service
      .from('event_experiences')
      .insert({
        tenant_id: tenantA.id,
        template_id: templateId,
        slug: 'cine-puerta',
        title: 'Cine Puerta',
        price_cents: 1_000_000,
        deposit_cents: 500_000,
        terms: 'Las señas no tienen devolución.',
        published: true,
      })
      .select('id')
      .single()
    if (expError || !exp) throw new Error(`experience insert failed: ${expError?.message}`)
    const experienceId = (exp as { id: string }).id

    // Las dos funciones son a futuro (se venden hasta que empiezan). A la de «hoy»
    // se le corre la fecha DESPUÉS de pagarla, igual que si movieran el evento.
    const insertEvent = async (date: string) => {
      const { data, error } = await service
        .from('scheduled_events')
        .insert({
          tenant_id: tenantA.id,
          template_id: templateId,
          event_date: date,
          starts_at_local: '21:00',
          capacity: 20,
          meal_type: 'dinner',
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`event insert failed: ${error?.message}`)
      return (data as { id: string }).id
    }
    const eventToday = await insertEvent('2031-03-03')
    const eventLater = await insertEvent('2031-03-10')
    orderToday = await paidOrder(eventToday, experienceId, 2)
    orderLater = await paidOrder(eventLater, experienceId, 2)

    // El día de servicio del bar (Córdoba, corte a las 5 AM): UTC-3 y 5 horas.
    const day = new Date(Date.now() - 8 * 3_600_000).toISOString().slice(0, 10)
    const moved = await service
      .from('scheduled_events')
      .update({ event_date: day })
      .eq('id', eventToday)
    if (moved.error) throw new Error(`no se pudo mover el evento: ${moved.error.message}`)
    await service
      .from('salon_reservations')
      .update({ reservation_date: day })
      .eq('scheduled_event_id', eventToday)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    await service.from('tenants').delete().in('id', [tenantA?.id, tenantB?.id].filter(Boolean))
    for (const u of [ownerA, waiterA, kitchenA, ownerB]) if (u) await deleteUser(u.userId)
  }, HOOK_TIMEOUT)

  it(
    'el mozo no puede leer los pedidos, pero sí mirar una entrada: sin teléfono',
    async () => {
      const direct = await waiterA.client.from('ticket_orders').select('id').eq('id', orderToday)
      expect(direct.data ?? []).toHaveLength(0)

      const { data, error } = await waiterA.client.rpc('ticket_door_lookup', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ order_id: orderToday, guest_name: 'Ana Puerta', party_size: 2 })
      expect(JSON.stringify(data)).not.toContain('+549351')
    },
    TEST_TIMEOUT,
  )

  it(
    'cocina, otro bar y anon no pasan',
    async () => {
      const kitchen = await kitchenA.client.rpc('ticket_door_lookup', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(kitchen.error?.message).toContain('forbidden')

      const otherBar = await ownerB.client.rpc('ticket_door_admit', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
        p_guests: 1,
        p_expected_inside: 0,
      })
      expect(otherBar.error?.message).toContain('forbidden')

      const anon = await getAnonClient().rpc('ticket_door_lookup', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(anon.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'una entrada de otro bar no aparece en el mío',
    async () => {
      const { data, error } = await ownerB.client.rpc('ticket_door_lookup', {
        p_tenant_id: tenantB.id,
        p_order_id: orderToday,
      })
      expect(error).toBeNull()
      expect(data).toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'entran de a partes y la misma entrada no entra dos veces',
    async () => {
      const admit = (guests: number, expected: number) =>
        waiterA.client.rpc('ticket_door_admit', {
          p_tenant_id: tenantA.id,
          p_order_id: orderToday,
          p_guests: guests,
          p_expected_inside: expected,
        })

      const first = await admit(1, 0)
      expect(first.error).toBeNull()
      expect(first.data.reservation).toMatchObject({ status: 'arrived', actual_guests: 1 })

      // Otro celular que miró la pantalla antes: no suma a los mismos dos veces.
      const stale = await admit(1, 0)
      expect(stale.error?.message).toContain('ticket_stale')

      const tooMany = await admit(2, 1)
      expect(tooMany.error?.message).toContain('ticket_invalid_guests')

      const second = await admit(1, 1)
      expect(second.error).toBeNull()
      expect(second.data.reservation).toMatchObject({ status: 'arrived', actual_guests: 2 })

      const again = await admit(1, 2)
      expect(again.error?.message).toContain('ticket_already_used')
    },
    TEST_TIMEOUT,
  )

  it(
    'deshacer: solo quien dejó pasar y una sola vez',
    async () => {
      const otherPerson = await ownerA.client.rpc('ticket_door_undo', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(otherPerson.error?.message).toContain('ticket_undo_other_user')

      const undo = await waiterA.client.rpc('ticket_door_undo', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(undo.error).toBeNull()
      expect(undo.data.reservation).toMatchObject({ status: 'arrived', actual_guests: 1 })

      const twice = await waiterA.client.rpc('ticket_door_undo', {
        p_tenant_id: tenantA.id,
        p_order_id: orderToday,
      })
      expect(twice.error?.message).toContain('ticket_undo_unavailable')

      // Queda el rastro, y lo ve el dueño.
      const { data: trail } = await ownerA.client
        .from('audit_log')
        .select('action, user_id')
        .eq('entity_id', orderToday)
        .eq('action', 'ticket_order.door_undo')
      expect(trail).toEqual([{ action: 'ticket_order.door_undo', user_id: waiterA.userId }])
    },
    TEST_TIMEOUT,
  )

  it(
    'una entrada de otro día no pasa',
    async () => {
      const { error } = await waiterA.client.rpc('ticket_door_admit', {
        p_tenant_id: tenantA.id,
        p_order_id: orderLater,
        p_guests: 1,
        p_expected_inside: 0,
      })
      expect(error?.message).toContain('ticket_other_day')
    },
    TEST_TIMEOUT,
  )

  it(
    'cada compra guarda las condiciones de ese momento',
    async () => {
      const { data } = await ownerA.client
        .from('ticket_orders')
        .select('terms')
        .eq('id', orderToday)
        .single()
      expect((data as { terms: string | null }).terms).toBe('Las señas no tienen devolución.')
    },
    TEST_TIMEOUT,
  )
})
