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

/**
 * El tablero de marketing y el link público son OWNER-ONLY. Estas tablas no
 * llevan la policy de aislamiento por membresía sino la de rol
 * (`user_role_in_tenant(tenant_id) = 'owner'`), así que hay dos cosas distintas
 * que probar: que un bar no ve al otro, y que dentro del MISMO bar un mozo no
 * ve nada.
 */
describeIfRls('RLS — marketing (tareas, rutinas y links públicos)', () => {
  let service: SupabaseClient
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let taskId: string
  let routineId: string
  let linkId: string

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('mkt-ownerA') })
    ownerB = await createUserClient({ email: uniqueEmail('mkt-ownerB') })
    waiterA = await createUserClient({ email: uniqueEmail('mkt-waiterA') })

    tenantA = await createTenant({
      name: 'Bar Marketing A',
      slug: uniqueSlug('mkta'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Marketing B',
      slug: uniqueSlug('mktb'),
      ownerId: ownerB.userId,
    })

    // Mozo DEL MISMO bar A: el caso que la policy de rol tiene que cortar.
    await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' })

    const { data: task } = await service
      .from('marketing_tasks')
      .insert({ tenant_id: tenantA.id, title: 'Grabar el reel', category: 'eventos' })
      .select('id')
      .single()
    taskId = (task as { id: string }).id

    const { data: routine } = await service
      .from('marketing_routines')
      .insert({ tenant_id: tenantA.id, title: 'Historia de happy hour', slots: 2 })
      .select('id')
      .single()
    routineId = (routine as { id: string }).id

    const { data: link } = await service
      .from('public_links')
      .insert({ tenant_id: tenantA.id, label: 'Menús', url: 'https://ejemplo.test/carta' })
      .select('id')
      .single()
    linkId = (link as { id: string }).id

    await service
      .from('public_link_pages')
      .insert({ tenant_id: tenantA.id, headline: 'Bar A', bio: 'Hola' })
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
    if (waiterA) await deleteUser(waiterA.userId)
  })

  it('el owner ve lo suyo; el owner del otro bar no ve nada', async () => {
    const mine = await ownerA.client.from('marketing_tasks').select('id')
    expect((mine.data ?? []).map((r) => r.id)).toContain(taskId)

    const theirs = await ownerB.client.from('marketing_tasks').select('id')
    expect((theirs.data ?? []).map((r) => r.id)).not.toContain(taskId)

    const theirLinks = await ownerB.client.from('public_links').select('id')
    expect((theirLinks.data ?? []).map((r) => r.id)).not.toContain(linkId)
  })

  it('un mozo del MISMO bar no ve el tablero ni los links', async () => {
    for (const table of [
      'marketing_tasks',
      'marketing_routines',
      'marketing_routine_checks',
      'public_links',
      'public_link_pages',
    ] as const) {
      const { data } = await waiterA.client.from(table).select('*')
      expect(data ?? []).toEqual([])
    }
  })

  it('un mozo tampoco puede escribir', async () => {
    const { error } = await waiterA.client
      .from('marketing_tasks')
      .insert({ tenant_id: tenantA.id, title: 'No debería entrar' })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('el owner del otro bar no puede escribir en el bar ajeno', async () => {
    const { error } = await ownerB.client
      .from('marketing_tasks')
      .insert({ tenant_id: tenantA.id, title: 'Cruzando de bar' })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('anon no llega a ninguna de las tablas (la página pública lee con service-role)', async () => {
    const anon = getAnonClient()
    for (const table of ['marketing_tasks', 'public_links', 'public_link_pages'] as const) {
      const { data, error } = await anon.from(table).select('*')
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    }
  })

  it('un tilde no puede apuntar a una rutina de otro bar (FK compuesta)', async () => {
    // El owner de B intenta tildar una rutina de A poniendo SU tenant_id: la FK
    // (routine_id, tenant_id) → marketing_routines(id, tenant_id) lo corta a
    // nivel motor, sin depender de la RLS.
    const { error } = await ownerB.client
      .from('marketing_routine_checks')
      .insert({
        tenant_id: tenantB.id,
        routine_id: routineId,
        week_start: '2026-08-31',
        slot: 0,
      })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('el owner tilda y destilda una rutina de su bar', async () => {
    const insert = await ownerA.client
      .from('marketing_routine_checks')
      .insert({ tenant_id: tenantA.id, routine_id: routineId, week_start: '2026-08-31', slot: 0 })
      .select('id')
      .single()
    expect(insert.error).toBeNull()

    // El unique (routine_id, week_start, slot) impide tildar dos veces el mismo
    // casillero — es lo que hace idempotente el toggle optimista de la UI.
    const dup = await ownerA.client
      .from('marketing_routine_checks')
      .insert({ tenant_id: tenantA.id, routine_id: routineId, week_start: '2026-08-31', slot: 0 })
      .select('id')
    expect(dup.error?.code).toBe('23505')

    const del = await ownerA.client
      .from('marketing_routine_checks')
      .delete()
      .eq('routine_id', routineId)
      .eq('week_start', '2026-08-31')
      .eq('slot', 0)
    expect(del.error).toBeNull()
  })

  it('get_marketing_team devuelve el equipo del bar propio y rebota al de otro', async () => {
    const { data, error } = await ownerA.client.rpc('get_marketing_team', {
      p_tenant: tenantA.id,
    })
    expect(error).toBeNull()
    const ids = ((data ?? []) as Array<{ member_id: string }>).map((r) => r.member_id)
    expect(ids).toContain(ownerA.userId)
    // El mozo NO es asignable: la función excluye a los roles de salón.
    expect(ids).not.toContain(waiterA.userId)

    const cross = await ownerB.client.rpc('get_marketing_team', { p_tenant: tenantA.id })
    expect(cross.error).not.toBeNull()
  })
})
