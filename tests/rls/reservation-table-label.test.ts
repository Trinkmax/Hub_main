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

/**
 * La mesa la carga el MOZO al sentar a la gente (pedido del dueño, 23/09/2026),
 * pero la policy `sr_staff_write` de `salon_reservations` deja escribir solo a
 * owner/cashier/host. El puente es la RPC `set_reservation_table_label`
 * (SECURITY DEFINER, migración 20260923130000): lo que se testea acá es
 * exactamente ese desnivel — por la RPC sí, por la tabla no, y nunca desde otro
 * bar.
 */
describeIfRls('RLS — set_reservation_table_label (la mesa la carga el mozo)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let reservationA: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('tbl-ownerA') })
    waiterA = await createUserClient({ email: uniqueEmail('tbl-waiter') })
    ownerB = await createUserClient({ email: uniqueEmail('tbl-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Mesa A',
      slug: uniqueSlug('tbl-a'),
      ownerId: ownerA.userId,
    })
    // El tenant de B existe solo para que su owner sea un usuario válido de
    // OTRO bar: tiene que recibir 'forbidden', no una lista vacía.
    tenantB = await createTenant({
      name: 'Bar Mesa B',
      slug: uniqueSlug('tbl-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' })

    // `primary_manager_id` es NOT NULL: toda reserva tiene quién la tomó.
    const { data: mgr } = await service
      .from('reservation_managers')
      .insert({
        tenant_id: tenantA.id,
        display_name: 'Luz Mesa',
        commission_eligible: false,
        active: true,
      })
      .select('id')
      .single()

    const { data, error } = await service
      .from('salon_reservations')
      .insert({
        tenant_id: tenantA.id,
        guest_name: 'Test Mesa',
        meal_type: 'dinner',
        reservation_date: '2026-12-31',
        reservation_time_local: '21:30',
        zone: 'planta_alta',
        estimated_guests: 4,
        origin: 'whatsapp',
        primary_manager_id: (mgr as { id: string }).id,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed reserva falló: ${error?.message}`)
    reservationA = data as { id: string }
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (waiterA) await deleteUser(waiterA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('waiter de A NO puede hacer UPDATE directo de table_label (policy sr_staff_write)', async () => {
    const { data } = await waiterA.client
      .from('salon_reservations')
      .update({ table_label: 'Directo' })
      .eq('id', reservationA.id)
      .select('id, table_label')

    // La RLS no tira error: simplemente no ve la fila para escribirla.
    expect(data ?? []).toEqual([])

    const service = getServiceClient()
    const { data: row } = await service
      .from('salon_reservations')
      .select('table_label')
      .eq('id', reservationA.id)
      .single()
    expect(row?.table_label).toBeNull()
  })

  it('waiter de A SÍ puede asignar la mesa por la RPC', async () => {
    const { data, error } = await waiterA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: '  12+13  ',
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    // La RPC normaliza igual que el zod del borde: trim + espacios colapsados.
    expect(row?.table_label).toBe('12+13')
  })

  it('waiter de A puede quitarla mandando vacío (queda null, no string en blanco)', async () => {
    const { data, error } = await waiterA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: '   ',
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row?.table_label).toBeNull()
  })

  it('owner de A también puede (es el mismo camino para todos los roles del salón)', async () => {
    const { data, error } = await ownerA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: 'Barra',
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row?.table_label).toBe('Barra')
  })

  it('owner de OTRO bar recibe forbidden y no toca la mesa', async () => {
    const { error } = await ownerB.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: 'Robada',
    })
    expect(error?.message).toContain('forbidden')

    const service = getServiceClient()
    const { data: row } = await service
      .from('salon_reservations')
      .select('table_label')
      .eq('id', reservationA.id)
      .single()
    expect(row?.table_label).toBe('Barra')
  })

  // `p_tenant_id` es el bar de la URL. Sin este chequeo, alguien con membresía
  // en dos bares podía entrar por el slug de uno y escribir en el otro mandando
  // un id ajeno (la auditoría quedaba en el bar equivocado).
  it('el bar de la URL tiene que ser el de la reserva, aunque el rol alcance', async () => {
    const { error } = await ownerA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: 'Otra',
      p_tenant_id: tenantB.id,
    })
    expect(error?.message).toContain('forbidden')

    const service = getServiceClient()
    const { data: row } = await service
      .from('salon_reservations')
      .select('table_label')
      .eq('id', reservationA.id)
      .single()
    expect(row?.table_label).toBe('Barra')
  })

  it('con el bar correcto sí escribe', async () => {
    const { data, error } = await ownerA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: 'Barra',
      p_tenant_id: tenantA.id,
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row?.table_label).toBe('Barra')
  })

  it('etiqueta más larga que el máximo → table_label_too_long', async () => {
    const { error } = await waiterA.client.rpc('set_reservation_table_label', {
      p_reservation_id: reservationA.id,
      p_table_label: 'x'.repeat(25),
    })
    expect(error?.message).toContain('table_label_too_long')
  })

  it('reserva inexistente → reservation_not_found', async () => {
    const { error } = await waiterA.client.rpc('set_reservation_table_label', {
      p_reservation_id: '00000000-0000-0000-0000-000000000000',
      p_table_label: '9',
    })
    expect(error?.message).toContain('reservation_not_found')
  })
})
