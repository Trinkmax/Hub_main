import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
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

/** UUID que no existe: alcanza para probar permisos, que se chequean antes de correr la función. */
const MISSING_ID = '00000000-0000-0000-0000-0000000000aa'

/** Tarifa de la reserva de prueba: 4 personas × $ 90 = $ 360 de comisión (en centavos). */
const RATE_PER_GUEST_CENTS = 9_000

/** Sin EXECUTE, Postgres corta con 42501 antes de correr una sola línea de la función. */
function expectNoExecute(error: PostgrestError | null) {
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
}

/** El envoltorio corta con 'forbidden' (P0001 o 42501, el mismo código que tiraba el original). */
function expectForbidden(error: PostgrestError | null) {
  expect(error).not.toBeNull()
  expect(error?.message).toContain('forbidden')
}

/**
 * Migración 20261007120000_security_rpc_hardening (fase 0 del Sprint 1, spec
 * §B.8-B.9). Lo que se prueba:
 *
 * 1. `anon` ya no ejecuta ninguna de las 10 RPC que tenía abiertas (ni las dos
 *    internas de comisiones y nivel).
 * 2. Las RPC que escriben reservas y comisiones exigen un rol de
 *    RESERVATION_OPERATOR_ROLES (owner, cashier, waiter, host) EN EL BAR DE LA
 *    RESERVA: el mozo marca «Llegó» y la comisión se recalcula; cocina,
 *    contenido y el dueño de otro bar reciben 'forbidden' y la reserva no cambia.
 * 3. Las lecturas «cualquier miembro» pasan para los seis roles de hoy y
 *    rechazan al dueño de otro bar.
 * 4. Cron e internas: ningún usuario las dispara (`permission denied`).
 * 5. Rotar el QR vuelve a funcionar para el dueño (32 hex nuevos) y el rol nulo
 *    (otro bar) ya no pasa.
 * 6. Lo que corre SIN usuario sigue andando: el service role recalcula, y el
 *    trigger del nivel de las tarjetas de sellos llega a `customer_effective_tier`
 *    sin chequeo (como antes).
 *
 * Los envoltorios conservan los códigos del original: 'unauthenticated' de
 * `transition_reservation_status` sigue saliendo sin errcode (P0001).
 */
describeIfRls('Seguridad — envoltorios y revokes de RPC (fase 0)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let cashierA: UserClient
  let waiterA: UserClient
  let hostA: UserClient
  let kitchenA: UserClient
  let editorA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let managerId: string
  let customerId: string
  let tierId: string
  let templateId: string

  /** Reserva nueva de A (pendiente, cena, 4 personas) para que cada caso arranque limpio. */
  async function createReservation(guestName: string): Promise<string> {
    const { data, error } = await service
      .from('salon_reservations')
      .insert({
        tenant_id: tenantA.id,
        guest_name: guestName,
        meal_type: 'dinner',
        reservation_date: '2026-12-30',
        reservation_time_local: '21:00',
        zone: 'planta_alta',
        estimated_guests: 4,
        origin: 'whatsapp',
        primary_manager_id: managerId,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed reserva falló: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function reservationState(id: string) {
    const { data } = await service
      .from('salon_reservations')
      .select('status, actual_guests')
      .eq('id', id)
      .single()
    return data as { status: string; actual_guests: number | null } | null
  }

  async function unpaidCommissionCents(reservationId: string): Promise<number[]> {
    const { data } = await service
      .from('commission_ledger')
      .select('payable_cents')
      .eq('reservation_id', reservationId)
      .is('paid_at', null)
    return ((data ?? []) as Array<{ payable_cents: number }>).map((r) => Number(r.payable_cents))
  }

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('srh-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('srh-cashierA') })
    waiterA = await createUserClient({ email: uniqueEmail('srh-waiterA') })
    hostA = await createUserClient({ email: uniqueEmail('srh-hostA') })
    kitchenA = await createUserClient({ email: uniqueEmail('srh-kitchenA') })
    editorA = await createUserClient({ email: uniqueEmail('srh-editorA') })
    ownerB = await createUserClient({ email: uniqueEmail('srh-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Seguridad A',
      slug: uniqueSlug('srh-a'),
      ownerId: ownerA.userId,
    })
    // B existe para que su dueño sea un usuario válido de OTRO bar: tiene que
    // recibir 'forbidden', no una lista vacía.
    tenantB = await createTenant({
      name: 'Bar Seguridad B',
      slug: uniqueSlug('srh-b'),
      ownerId: ownerB.userId,
    })

    const { error: memberError } = await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
      { tenant_id: tenantA.id, user_id: hostA.userId, role: 'host' },
      { tenant_id: tenantA.id, user_id: kitchenA.userId, role: 'kitchen' },
      { tenant_id: tenantA.id, user_id: editorA.userId, role: 'editor' },
    ])
    if (memberError) throw new Error(`memberships insert falló: ${memberError.message}`)

    const { data: mgr, error: mgrError } = await service
      .from('reservation_managers')
      .insert({
        tenant_id: tenantA.id,
        display_name: 'Gestora Seguridad',
        commission_eligible: true,
        active: true,
      })
      .select('id')
      .single()
    if (mgrError || !mgr) throw new Error(`gestor falló: ${mgrError?.message}`)
    managerId = (mgr as { id: string }).id

    const { error: rateError } = await service.from('commission_rate_tiers').insert({
      tenant_id: tenantA.id,
      meal_type: 'dinner',
      min_guests: 1,
      max_guests: null,
      rate_per_guest_cents: RATE_PER_GUEST_CENTS,
      active: true,
    })
    if (rateError) throw new Error(`tarifa falló: ${rateError.message}`)

    const { data: customer, error: customerError } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: '+5493515550101',
        first_name: 'Socia',
        last_name: 'Seguridad',
      })
      .select('id')
      .single()
    if (customerError || !customer) throw new Error(`cliente falló: ${customerError?.message}`)
    customerId = (customer as { id: string }).id

    // Tarjeta de sellos restringida a un nivel que la socia tiene (Classic, desde 0
    // puntos): el trigger del nivel tiene que dejarla sellar sin usuario.
    const { data: reward, error: rewardError } = await service
      .from('rewards')
      .insert({ tenant_id: tenantA.id, name: 'Premio Seguridad', cost_points: 10 })
      .select('id')
      .single()
    if (rewardError || !reward) throw new Error(`premio falló: ${rewardError?.message}`)

    const { data: tier, error: tierError } = await service
      .from('loyalty_tiers')
      .insert({ tenant_id: tenantA.id, name: 'Classic', min_category_points: 0 })
      .select('id')
      .single()
    if (tierError || !tier) throw new Error(`nivel falló: ${tierError?.message}`)
    tierId = (tier as { id: string }).id

    const { data: template, error: templateError } = await service
      .from('punch_card_templates')
      .insert({
        tenant_id: tenantA.id,
        name: 'Tarjeta Seguridad',
        trigger_type: 'manual',
        threshold: 5,
        reward_id: (reward as { id: string }).id,
      })
      .select('id')
      .single()
    if (templateError || !template) throw new Error(`tarjeta falló: ${templateError?.message}`)
    templateId = (template as { id: string }).id

    const { error: linkError } = await service
      .from('punch_card_template_tiers')
      .insert({ tenant_id: tenantA.id, template_id: templateId, tier_id: tierId })
    if (linkError) throw new Error(`tarjeta-nivel falló: ${linkError.message}`)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    if (service) {
      // Borrar los bares cascadea reservas, comisiones, clientes y tarjetas.
      await service.from('tenants').delete().in('id', [tenantA?.id, tenantB?.id].filter(Boolean))
    }
    for (const user of [ownerA, cashierA, waiterA, hostA, kitchenA, editorA, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  }, HOOK_TIMEOUT)

  describe('anon sin EXECUTE', () => {
    // Se arma adentro de cada caso: los ids de A recién existen después del beforeAll.
    const cases: Array<[string, () => Record<string, unknown>]> = [
      ['recalc_reservation_commission', () => ({ p_reservation_id: MISSING_ID })],
      ['transition_reservation_status', () => ({ p_reservation_id: MISSING_ID, p_to: 'arrived' })],
      [
        'update_reservation_actual_guests',
        () => ({ p_reservation_id: MISSING_ID, p_actual_guests: 3 }),
      ],
      ['mark_commission_paid', () => ({ p_ledger_ids: [] })],
      ['evaluate_day_capacity', () => ({ p_tenant_id: tenantA.id, p_date: '2026-12-30' })],
      ['get_salon_occupancy', () => ({ p_tenant_id: tenantA.id })],
      ['rotate_customer_qr_token', () => ({ p_customer_id: customerId })],
      ['auto_abandon_stale_sessions', () => ({})],
      ['expire_punch_cards', () => ({})],
      [
        'internal_activate_session_for_table',
        () => ({
          p_table_id: MISSING_ID,
          p_party_size: 2,
          p_source: 'scan',
          p_user_id: MISSING_ID,
        }),
      ],
      ['recalc_event_commissions', () => ({ p_scheduled_event_id: MISSING_ID })],
      ['customer_effective_tier', () => ({ p_customer_id: customerId })],
    ]

    it.each(cases)(
      '%s → permission denied',
      async (fn, args) => {
        const { error } = await getAnonClient().rpc(fn, args())
        expectNoExecute(error)
      },
      TEST_TIMEOUT,
    )
  })

  describe('reservas y comisiones: RESERVATION_OPERATOR_ROLES en el bar de la reserva', () => {
    it(
      'el mozo marca «Llegó» y la comisión se recalcula',
      async () => {
        const reservationId = await createReservation('Mozo Llegó')
        const { data, error } = await waiterA.client.rpc('transition_reservation_status', {
          p_reservation_id: reservationId,
          p_to: 'arrived',
        })
        expect(error).toBeNull()
        const row = (Array.isArray(data) ? data[0] : data) as { status: string } | null
        expect(row?.status).toBe('arrived')
        expect(await unpaidCommissionCents(reservationId)).toEqual([4 * RATE_PER_GUEST_CENTS])

        // Corregir las personas también recalcula (mismo envoltorio, misma allowlist).
        const guests = await waiterA.client.rpc('update_reservation_actual_guests', {
          p_reservation_id: reservationId,
          p_actual_guests: 6,
        })
        expect(guests.error).toBeNull()
        expect(await unpaidCommissionCents(reservationId)).toEqual([6 * RATE_PER_GUEST_CENTS])
      },
      TEST_TIMEOUT,
    )

    it(
      'anfitriona y dueño también pasan; el cajero recalcula (lo que hace editar o cancelar)',
      async () => {
        const forHost = await createReservation('Anfitriona Llegó')
        const host = await hostA.client.rpc('transition_reservation_status', {
          p_reservation_id: forHost,
          p_to: 'arrived',
        })
        expect(host.error).toBeNull()

        const forOwner = await createReservation('Dueño Llegó')
        const owner = await ownerA.client.rpc('transition_reservation_status', {
          p_reservation_id: forOwner,
          p_to: 'arrived',
        })
        expect(owner.error).toBeNull()

        const recalc = await cashierA.client.rpc('recalc_reservation_commission', {
          p_reservation_id: forOwner,
        })
        expect(recalc.error).toBeNull()
        expect(await unpaidCommissionCents(forOwner)).toEqual([4 * RATE_PER_GUEST_CENTS])
      },
      TEST_TIMEOUT,
    )

    it(
      'cocina y contenido → forbidden, y la reserva no se mueve',
      async () => {
        const reservationId = await createReservation('Cocina No')
        for (const user of [kitchenA, editorA]) {
          const transition = await user.client.rpc('transition_reservation_status', {
            p_reservation_id: reservationId,
            p_to: 'arrived',
          })
          expectForbidden(transition.error)

          const guests = await user.client.rpc('update_reservation_actual_guests', {
            p_reservation_id: reservationId,
            p_actual_guests: 2,
          })
          expectForbidden(guests.error)

          const recalc = await user.client.rpc('recalc_reservation_commission', {
            p_reservation_id: reservationId,
          })
          expectForbidden(recalc.error)
        }
        expect(await reservationState(reservationId)).toEqual({
          status: 'pending',
          actual_guests: null,
        })
      },
      TEST_TIMEOUT,
    )

    it(
      'el dueño de OTRO bar → forbidden sobre una reserva de A',
      async () => {
        const reservationId = await createReservation('Otro Bar No')
        const transition = await ownerB.client.rpc('transition_reservation_status', {
          p_reservation_id: reservationId,
          p_to: 'arrived',
        })
        expectForbidden(transition.error)

        const guests = await ownerB.client.rpc('update_reservation_actual_guests', {
          p_reservation_id: reservationId,
          p_actual_guests: 2,
        })
        expectForbidden(guests.error)

        const recalc = await ownerB.client.rpc('recalc_reservation_commission', {
          p_reservation_id: reservationId,
        })
        expectForbidden(recalc.error)

        expect(await reservationState(reservationId)).toEqual({
          status: 'pending',
          actual_guests: null,
        })
      },
      TEST_TIMEOUT,
    )

    it(
      'reserva inexistente → reservation_not_found (mismo error que antes)',
      async () => {
        const { error } = await waiterA.client.rpc('transition_reservation_status', {
          p_reservation_id: MISSING_ID,
          p_to: 'arrived',
        })
        expect(error?.message).toContain('reservation_not_found')
      },
      TEST_TIMEOUT,
    )

    it(
      'sin usuario: el service role recalcula y transition sigue diciendo unauthenticated',
      async () => {
        const reservationId = await createReservation('Servicio')
        const recalc = await service.rpc('recalc_reservation_commission', {
          p_reservation_id: reservationId,
        })
        expect(recalc.error).toBeNull()

        const transition = await service.rpc('transition_reservation_status', {
          p_reservation_id: reservationId,
          p_to: 'arrived',
        })
        expect(transition.error?.message).toContain('unauthenticated')
      },
      TEST_TIMEOUT,
    )

    it(
      'recalc_event_commissions como usuario → permission denied (solo la llama transition)',
      async () => {
        const { error } = await ownerA.client.rpc('recalc_event_commissions', {
          p_scheduled_event_id: MISSING_ID,
        })
        expectNoExecute(error)
      },
      TEST_TIMEOUT,
    )
  })

  describe('lecturas «cualquier miembro» → los seis roles de hoy', () => {
    it(
      'cocina y contenido leen cupo y ocupación; el dueño de otro bar no',
      async () => {
        for (const user of [kitchenA, editorA, waiterA]) {
          const capacity = await user.client.rpc('evaluate_day_capacity', {
            p_tenant_id: tenantA.id,
            p_date: '2026-12-30',
          })
          expect(capacity.error).toBeNull()
          expect(Array.isArray(capacity.data)).toBe(true)

          const occupancy = await user.client.rpc('get_salon_occupancy', {
            p_tenant_id: tenantA.id,
          })
          expect(occupancy.error).toBeNull()
        }

        const capacityB = await ownerB.client.rpc('evaluate_day_capacity', {
          p_tenant_id: tenantA.id,
          p_date: '2026-12-30',
        })
        expectForbidden(capacityB.error)

        const occupancyB = await ownerB.client.rpc('get_salon_occupancy', {
          p_tenant_id: tenantA.id,
        })
        expectForbidden(occupancyB.error)
      },
      TEST_TIMEOUT,
    )

    it(
      'customer_effective_tier: el staff de A lo ve, el dueño de otro bar no',
      async () => {
        const kitchen = await kitchenA.client.rpc('customer_effective_tier', {
          p_customer_id: customerId,
        })
        expect(kitchen.error).toBeNull()
        expect(kitchen.data).toBe(tierId)

        const other = await ownerB.client.rpc('customer_effective_tier', {
          p_customer_id: customerId,
        })
        expectForbidden(other.error)
      },
      TEST_TIMEOUT,
    )
  })

  describe('cron e internas: ningún usuario las dispara', () => {
    it(
      'auto_abandon_stale_sessions, expire_punch_cards e internal_activate_session_for_table → permission denied',
      async () => {
        expectNoExecute((await ownerA.client.rpc('auto_abandon_stale_sessions')).error)
        expectNoExecute((await ownerA.client.rpc('expire_punch_cards')).error)
        const internal = await ownerA.client.rpc('internal_activate_session_for_table', {
          p_table_id: MISSING_ID,
          p_party_size: 2,
          p_source: 'scan',
          p_user_id: ownerA.userId,
        })
        expectNoExecute(internal.error)
      },
      TEST_TIMEOUT,
    )
  })

  describe('rotar el QR del cliente', () => {
    it(
      'el dueño de A lo rota: 32 hex nuevos y guardados',
      async () => {
        const { data: before } = await service
          .from('customers')
          .select('qr_token')
          .eq('id', customerId)
          .single()
        const oldToken = (before as { qr_token: string } | null)?.qr_token

        const { data, error } = await ownerA.client.rpc('rotate_customer_qr_token', {
          p_customer_id: customerId,
        })
        expect(error).toBeNull()
        expect(typeof data).toBe('string')
        expect(data).toMatch(/^[0-9a-f]{32}$/)
        expect(data).not.toBe(oldToken)

        const { data: after } = await service
          .from('customers')
          .select('qr_token')
          .eq('id', customerId)
          .single()
        expect((after as { qr_token: string } | null)?.qr_token).toBe(data)
      },
      TEST_TIMEOUT,
    )

    it(
      'el cajero de A y el dueño de otro bar → forbidden',
      async () => {
        const cashier = await cashierA.client.rpc('rotate_customer_qr_token', {
          p_customer_id: customerId,
        })
        expectForbidden(cashier.error)

        const other = await ownerB.client.rpc('rotate_customer_qr_token', {
          p_customer_id: customerId,
        })
        expectForbidden(other.error)
      },
      TEST_TIMEOUT,
    )
  })

  describe('lo que corre sin usuario sigue andando', () => {
    it(
      'sellar con service role pasa por el trigger del nivel sin chequeo de rol',
      async () => {
        const { data, error } = await service
          .from('customer_punch_cards')
          .insert({
            tenant_id: tenantA.id,
            customer_id: customerId,
            template_id: templateId,
            current_stamps: 1,
            threshold_snapshot: 5,
          })
          .select('current_stamps')
          .single()
        expect(error).toBeNull()
        expect((data as { current_stamps: number } | null)?.current_stamps).toBe(1)
      },
      TEST_TIMEOUT,
    )
  })
})
