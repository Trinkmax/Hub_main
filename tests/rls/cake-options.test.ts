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
 * El menú de tortas es una decisión de carta: lo LEE todo el equipo (el selector
 * vive en el alta de reserva, que carga el cajero y el anfitrión) y lo ESCRIBE
 * solo el dueño. Las policies son la única barrera — las Server Actions validan
 * el rol, pero la Data API está abierta a cualquiera con sesión.
 *
 * El último bloque cubre la otra mitad: que la torta de un bar no pueda entrar
 * en la reserva de otro. Eso no lo puede tapar RLS (filtra filas al leer, no
 * valores al escribir); lo garantiza la FK compuesta (id, tenant_id) de la
 * migración 20260904204655.
 */
describeIfRls('RLS — cake_options', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let hostA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let cakeA: { id: string }
  let cakeB: { id: string }

  function cake(extra: Record<string, unknown> = {}) {
    return {
      tenant_id: tenantA.id,
      name: `Opción ${uniqueSlug('x')}`,
      base: 'Bizcochuelo de vainilla',
      fillings: ['Dulce de leche', 'Crema chantilly y frutillas'],
      position: 1,
      active: true,
      ...extra,
    }
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('cake-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('cake-cashier') })
    hostA = await createUserClient({ email: uniqueEmail('cake-host') })
    ownerB = await createUserClient({ email: uniqueEmail('cake-ownerB') })
    tenantA = await createTenant({
      name: 'Bar CAKE A',
      slug: uniqueSlug('cake-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar CAKE B',
      slug: uniqueSlug('cake-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: hostA.userId, role: 'host' },
    ])

    const { data: rowA } = await service
      .from('cake_options')
      .insert(cake({ name: 'Opción A' }))
      .select('id')
      .single()
    cakeA = rowA as { id: string }

    const { data: rowB } = await service
      .from('cake_options')
      .insert(cake({ tenant_id: tenantB.id, name: 'Opción B' }))
      .select('id')
      .single()
    cakeB = rowB as { id: string }
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (hostA) await deleteUser(hostA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  // ── Lectura: todo el equipo, porque el selector vive en el alta de reserva.

  it('el cajero de A ve el menú de A', async () => {
    const { data, error } = await cashierA.client
      .from('cake_options')
      .select('id')
      .eq('id', cakeA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('el anfitrión de A ve el menú de A', async () => {
    const { data } = await hostA.client.from('cake_options').select('id').eq('id', cakeA.id)
    expect(data).toHaveLength(1)
  })

  it('el dueño de B NO ve el menú de A', async () => {
    const { data } = await ownerB.client.from('cake_options').select('id').eq('id', cakeA.id)
    expect(data ?? []).toHaveLength(0)
  })

  // ── Escritura: solo el dueño. Qué tortas hace el bar no lo decide el servicio.

  it('el dueño de A crea una torta', async () => {
    const { data, error } = await ownerA.client
      .from('cake_options')
      .insert(cake({ name: 'Opción del dueño' }))
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('el cajero de A NO puede crear una torta', async () => {
    const { error } = await cashierA.client
      .from('cake_options')
      .insert(cake({ name: 'Opción del cajero' }))
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })

  it('el anfitrión de A NO puede editar una torta', async () => {
    await hostA.client.from('cake_options').update({ base: 'Hackeado' }).eq('id', cakeA.id)
    const service = getServiceClient()
    const { data } = await service.from('cake_options').select('base').eq('id', cakeA.id).single()
    expect((data as { base: string }).base).not.toBe('Hackeado')
  })

  it('el dueño de B NO puede editar ni borrar una torta de A', async () => {
    await ownerB.client.from('cake_options').update({ base: 'Del otro bar' }).eq('id', cakeA.id)
    await ownerB.client.from('cake_options').delete().eq('id', cakeA.id)
    const service = getServiceClient()
    const { data } = await service.from('cake_options').select('base').eq('id', cakeA.id).single()
    expect((data as { base: string }).base).toBe('Bizcochuelo de vainilla')
  })

  it('el dueño de A NO puede crear una torta en el tenant B', async () => {
    const { error } = await ownerA.client
      .from('cake_options')
      .insert(cake({ tenant_id: tenantB.id, name: 'Colada' }))
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })

  // ── Integridad cruzada: la FK compuesta (id, tenant_id).

  it('una reserva de A no puede elegir una torta de B', async () => {
    const service = getServiceClient()
    const { data: manager } = await service
      .from('reservation_managers')
      .select('id')
      .eq('tenant_id', tenantA.id)
      .limit(1)
      .single()

    const { error } = await service.from('salon_reservations').insert({
      tenant_id: tenantA.id,
      guest_name: 'Cross tenant',
      kind: 'birthday',
      meal_type: 'dinner',
      reservation_date: '2026-12-31',
      reservation_time_local: '21:00',
      zone: 'planta_alta',
      estimated_guests: 2,
      cake_count: 1,
      // La torta es del OTRO bar: la FK simple lo dejaba pasar.
      cake_option_id: cakeB.id,
      primary_manager_id: (manager as { id: string }).id,
    })
    expect(error).not.toBeNull()
  })
})
