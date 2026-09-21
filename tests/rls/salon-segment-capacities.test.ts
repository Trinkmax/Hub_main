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

const WEEKLY = 'salon_segment_capacities'
const OVERRIDES = 'salon_segment_capacity_overrides'
const SETTINGS = 'salon_segment_settings'

/**
 * El proyecto de dev es remoto (sin stack local): crear 3 usuarios y 2 bares
 * tarda bastante más que los 10 s por defecto de un hook.
 */
const HOOK_TIMEOUT = 180_000
const TEST_TIMEOUT = 60_000

/**
 * Cupos por servicio (migración 20260921120000_salon_segment_capacities).
 *
 * A diferencia de la pauta (owner-only), el cupo lo LEE todo el bar: la
 * anfitriona y los mozos lo ven en el form, en el calendario y en el salón.
 * Escribir (grilla semanal, cupo especial del día, hora sugerida y nota del
 * aviso) es solo del owner, igual que salon_zone_capacity_overrides.
 *
 * Qué se prueba, en este orden (los tests comparten la fila (lunch, lunes)
 * que carga el primero):
 * 1. El owner carga y edita la grilla con upsert (lo que hace saveSegmentConfig).
 * 2. El mozo del MISMO bar lee pero no escribe: el insert falla y el
 *    update/delete no tocan filas (RLS las filtra en silencio, sin error).
 * 3. El owner de OTRO bar no ve ni escribe nada; anon no llega a la tabla.
 * 4. Los CHECK devuelven 23514 y los UNIQUE 23505 (las actions los traducen).
 * 5. Lo mismo, abreviado, para los cupos especiales y los ajustes por servicio.
 * 6. Borrar el bar cascadea las tres tablas.
 */
describeIfRls('RLS — cupos por servicio (salon_segment_*)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let waiterA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let tenantADeleted = false

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('ssc-ownerA') })
    waiterA = await createUserClient({ email: uniqueEmail('ssc-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('ssc-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Cupos A',
      slug: uniqueSlug('ssc-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Cupos B',
      slug: uniqueSlug('ssc-b'),
      ownerId: ownerB.userId,
    })

    const { error: memberError } = await service
      .from('memberships')
      .insert({ tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' })
    if (memberError) throw new Error(`membership insert failed: ${memberError.message}`)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    // createTenant no limpia: los bares de prueba se borran acá (los cupos
    // cascadean con el bar, que es lo que prueba el último test).
    if (service) {
      const ids = [tenantB?.id, tenantADeleted ? undefined : tenantA?.id].filter(
        (id): id is string => typeof id === 'string',
      )
      if (ids.length > 0) await service.from('tenants').delete().in('id', ids)
    }
    for (const user of [ownerA, waiterA, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  }, HOOK_TIMEOUT)

  it(
    'el owner de A carga la grilla semanal con upsert y la edita sin duplicar',
    async () => {
      const first = await ownerA.client
        .from(WEEKLY)
        .upsert(
          { tenant_id: tenantA.id, segment: 'lunch', iso_dow: 1, capacity: 60, warn_at: null },
          { onConflict: 'tenant_id,segment,iso_dow' },
        )
        .select('created_at, updated_at')
        .single()
      expect(first.error).toBeNull()

      // Segundo guardado de la misma celda: pisa, no suma otra fila.
      const second = await ownerA.client
        .from(WEEKLY)
        .upsert(
          { tenant_id: tenantA.id, segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
          { onConflict: 'tenant_id,segment,iso_dow' },
        )
        .select('updated_at')
        .single()
      expect(second.error).toBeNull()
      // El trigger set_updated_at corre en el update del upsert.
      expect(second.data?.updated_at).not.toBe(first.data?.updated_at)

      const read = await ownerA.client
        .from(WEEKLY)
        .select('segment, iso_dow, capacity, warn_at')
        .eq('tenant_id', tenantA.id)
      expect(read.error).toBeNull()
      expect(read.data).toEqual([{ segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 }])
    },
    TEST_TIMEOUT,
  )

  it(
    'el mozo de A lee el cupo pero no lo escribe',
    async () => {
      const select = await waiterA.client.from(WEEKLY).select('segment, iso_dow, capacity')
      expect(select.error).toBeNull()
      expect(select.data).toEqual([{ segment: 'lunch', iso_dow: 1, capacity: 70 }])

      const insert = await waiterA.client
        .from(WEEKLY)
        .insert({ tenant_id: tenantA.id, segment: 'dinner', iso_dow: 1, capacity: 120 })
        .select('id')
      expect(insert.error).not.toBeNull()

      // UPDATE/DELETE sin policy para su rol: 0 filas y sin error.
      const update = await waiterA.client
        .from(WEEKLY)
        .update({ capacity: 999 })
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(update.data ?? []).toEqual([])

      const del = await waiterA.client
        .from(WEEKLY)
        .delete()
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(del.data ?? []).toEqual([])

      const untouched = await ownerA.client
        .from(WEEKLY)
        .select('capacity')
        .eq('tenant_id', tenantA.id)
        .eq('segment', 'lunch')
        .eq('iso_dow', 1)
        .single()
      expect(untouched.data).toEqual({ capacity: 70 })
    },
    TEST_TIMEOUT,
  )

  it(
    'el owner de B no ve ni escribe el cupo de A',
    async () => {
      const all = await ownerB.client.from(WEEKLY).select('id')
      expect(all.error).toBeNull()
      expect(all.data ?? []).toEqual([])

      const scoped = await ownerB.client.from(WEEKLY).select('id').eq('tenant_id', tenantA.id)
      expect(scoped.data ?? []).toEqual([])

      const intoA = await ownerB.client
        .from(WEEKLY)
        .insert({ tenant_id: tenantA.id, segment: 'dinner', iso_dow: 2, capacity: 1 })
        .select('id')
      expect(intoA.error).not.toBeNull()

      const edit = await ownerB.client
        .from(WEEKLY)
        .update({ capacity: 1 })
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(edit.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )

  it(
    'anon no llega a ninguna de las tres tablas',
    async () => {
      const anon = getAnonClient()
      for (const table of [WEEKLY, OVERRIDES, SETTINGS]) {
        const { data, error } = await anon.from(table).select('*')
        expect(error !== null || (data ?? []).length === 0).toBe(true)
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'los CHECK cortan servicios y valores fuera de rango (23514)',
    async () => {
      const weeklyCases = [
        // breakfast y hub_event existen en el enum pero no son servicios configurables.
        { segment: 'breakfast', iso_dow: 2, capacity: 70, warn_at: null },
        { segment: 'hub_event', iso_dow: 2, capacity: 70, warn_at: null },
        { segment: 'lunch', iso_dow: 8, capacity: 70, warn_at: null },
        { segment: 'lunch', iso_dow: 2, capacity: 1000, warn_at: null },
        { segment: 'lunch', iso_dow: 2, capacity: -1, warn_at: null },
        // El aviso no puede pasar el cupo.
        { segment: 'lunch', iso_dow: 2, capacity: 70, warn_at: 80 },
        { segment: 'lunch', iso_dow: 2, capacity: 70, warn_at: 0 },
      ]
      for (const row of weeklyCases) {
        const res = await ownerA.client
          .from(WEEKLY)
          .insert({ tenant_id: tenantA.id, ...row })
          .select('id')
        expect(res.error?.code, JSON.stringify(row)).toBe('23514')
      }

      const longReason = await ownerA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'lunch',
          override_date: '2026-10-12',
          capacity: 120,
          reason: 'x'.repeat(121),
        })
        .select('id')
      expect(longReason.error?.code).toBe('23514')

      const overrideWarnOverCap = await ownerA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'lunch',
          override_date: '2026-10-12',
          capacity: 40,
          warn_at: 50,
        })
        .select('id')
      expect(overrideWarnOverCap.error?.code).toBe('23514')

      // La nota vacía se guarda como NULL (lo hace el zod); '' en la DB no entra.
      const emptyNote = await ownerA.client
        .from(SETTINGS)
        .insert({ tenant_id: tenantA.id, segment: 'lunch', default_time: '13:00', warn_note: '' })
        .select('id')
      expect(emptyNote.error?.code).toBe('23514')

      const nothingLeaked = await service
        .from(WEEKLY)
        .select('segment, iso_dow')
        .eq('tenant_id', tenantA.id)
      expect(nothingLeaked.data).toEqual([{ segment: 'lunch', iso_dow: 1 }])
    },
    TEST_TIMEOUT,
  )

  it(
    'cupos especiales por fecha: lee el miembro, escribe solo el owner, uno por (fecha, servicio)',
    async () => {
      const created = await ownerA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'lunch',
          override_date: '2026-10-12',
          capacity: 120,
          reason: 'Feriado',
          updated_by: ownerA.userId,
        })
        .select('override_date, segment, capacity, warn_at, reason')
        .single()
      expect(created.error).toBeNull()
      expect(created.data).toEqual({
        override_date: '2026-10-12',
        segment: 'lunch',
        capacity: 120,
        warn_at: null,
        reason: 'Feriado',
      })

      const dup = await ownerA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'lunch',
          override_date: '2026-10-12',
          capacity: 90,
        })
        .select('id')
      expect(dup.error?.code).toBe('23505')

      // Otro servicio el mismo día sí entra.
      const dinner = await ownerA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'dinner',
          override_date: '2026-10-12',
          capacity: 0,
        })
        .select('id')
      expect(dinner.error).toBeNull()

      const waiterRead = await waiterA.client
        .from(OVERRIDES)
        .select('segment, capacity')
        .eq('override_date', '2026-10-12')
        .order('segment')
      expect(waiterRead.error).toBeNull()
      expect((waiterRead.data ?? []).length).toBe(2)

      const waiterInsert = await waiterA.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'tea_time',
          override_date: '2026-10-12',
          capacity: 1,
        })
        .select('id')
      expect(waiterInsert.error).not.toBeNull()

      const waiterUpdate = await waiterA.client
        .from(OVERRIDES)
        .update({ capacity: 1 })
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(waiterUpdate.data ?? []).toEqual([])

      const waiterDelete = await waiterA.client
        .from(OVERRIDES)
        .delete()
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(waiterDelete.data ?? []).toEqual([])

      const ownerBRead = await ownerB.client.from(OVERRIDES).select('id')
      expect(ownerBRead.data ?? []).toEqual([])

      const ownerBInsert = await ownerB.client
        .from(OVERRIDES)
        .insert({
          tenant_id: tenantA.id,
          segment: 'tea_time',
          override_date: '2026-10-12',
          capacity: 1,
        })
        .select('id')
      expect(ownerBInsert.error).not.toBeNull()

      // `delete … returning` devuelve lo borrado: removeSegmentOverride lo usa
      // para el Deshacer y el audit.
      const removed = await ownerA.client
        .from(OVERRIDES)
        .delete()
        .eq('tenant_id', tenantA.id)
        .eq('override_date', '2026-10-12')
        .eq('segment', 'dinner')
        .select('segment, capacity')
      expect(removed.error).toBeNull()
      expect(removed.data).toEqual([{ segment: 'dinner', capacity: 0 }])
    },
    TEST_TIMEOUT,
  )

  it(
    'ajustes por servicio: lee el miembro, escribe solo el owner, uno por servicio',
    async () => {
      const created = await ownerA.client
        .from(SETTINGS)
        .insert([
          {
            tenant_id: tenantA.id,
            segment: 'lunch',
            default_time: '13:00',
            warn_note: 'Conviene abrir la terraza',
          },
          { tenant_id: tenantA.id, segment: 'dinner', default_time: '21:00', warn_note: null },
        ])
        .select('segment')
      expect(created.error).toBeNull()
      expect((created.data ?? []).length).toBe(2)

      const dup = await ownerA.client
        .from(SETTINGS)
        .insert({ tenant_id: tenantA.id, segment: 'lunch', default_time: '12:30' })
        .select('id')
      expect(dup.error?.code).toBe('23505')

      // `time` vuelve como 'HH:MM:SS': el mapper del server lo recorta a HH:MM.
      const waiterRead = await waiterA.client
        .from(SETTINGS)
        .select('segment, default_time, warn_note')
        .eq('segment', 'lunch')
        .single()
      expect(waiterRead.error).toBeNull()
      expect(waiterRead.data).toEqual({
        segment: 'lunch',
        default_time: '13:00:00',
        warn_note: 'Conviene abrir la terraza',
      })

      const waiterUpdate = await waiterA.client
        .from(SETTINGS)
        .update({ warn_note: 'Abrí la terraza' })
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(waiterUpdate.data ?? []).toEqual([])

      const waiterInsert = await waiterA.client
        .from(SETTINGS)
        .insert({ tenant_id: tenantA.id, segment: 'tea_time', default_time: '15:30' })
        .select('id')
      expect(waiterInsert.error).not.toBeNull()

      const ownerBRead = await ownerB.client.from(SETTINGS).select('id')
      expect(ownerBRead.data ?? []).toEqual([])

      const ownerBUpdate = await ownerB.client
        .from(SETTINGS)
        .update({ default_time: '10:00' })
        .eq('tenant_id', tenantA.id)
        .select('id')
      expect(ownerBUpdate.data ?? []).toEqual([])

      const ownerEdit = await ownerA.client
        .from(SETTINGS)
        .update({ default_time: '20:30' })
        .eq('tenant_id', tenantA.id)
        .eq('segment', 'dinner')
        .select('default_time')
        .single()
      expect(ownerEdit.error).toBeNull()
      expect(ownerEdit.data).toEqual({ default_time: '20:30:00' })
    },
    TEST_TIMEOUT,
  )

  it(
    'borrar el bar cascadea las tres tablas',
    async () => {
      const { error } = await service.from('tenants').delete().eq('id', tenantA.id)
      expect(error).toBeNull()
      tenantADeleted = true

      for (const table of [WEEKLY, OVERRIDES, SETTINGS]) {
        const rows = await service.from(table).select('id').eq('tenant_id', tenantA.id)
        expect(rows.error).toBeNull()
        expect(rows.data ?? []).toEqual([])
      }
    },
    TEST_TIMEOUT,
  )
})
