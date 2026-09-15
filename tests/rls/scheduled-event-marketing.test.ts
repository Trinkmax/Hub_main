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

const TABLE = 'scheduled_event_marketing'

/**
 * El proyecto de dev es remoto (sin stack local): crear 5 usuarios, 2 bares y
 * 4 fechas tarda bastante más que los 10 s por defecto de un hook.
 */
const HOOK_TIMEOUT = 180_000
const TEST_TIMEOUT = 60_000

/**
 * La pauta por edición es plata del bar: OWNER-ONLY, SELECT incluido
 * (`sem_owner_all`). Es la excepción a la regla de §4 — el staff lee
 * `scheduled_events`, pero la pauta de esas mismas fechas no.
 *
 * Tres cosas distintas que probar:
 * 1. Dentro del MISMO bar, cajero, anfitrión y mozo no ven ni escriben nada.
 * 2. Entre bares, la RLS aísla y la FK compuesta (scheduled_event_id,
 *    tenant_id) impide que una fila apunte a una fecha ajena.
 * 3. La FK es NO ACTION a propósito: borrar una fecha con pauta falla con
 *    23503 (aunque quien borra no vea la pauta), y borrar el bar entero
 *    cascadea igual porque NO ACTION se chequea al final de la sentencia.
 */
describeIfRls('RLS — scheduled_event_marketing (pauta por edición, solo owner)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let cashierA: UserClient
  let hostA: UserClient
  let waiterA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  /** Fecha de A para el CRUD del owner (queda sin fila al final de ese test). */
  let eventA: string
  /** Fecha de A con una fila sembrada por service, para los tests de staff. */
  let eventStaff: string
  /** Fecha de A con pauta que el anfitrión intenta borrar del calendario. */
  let eventWithAds: string
  let eventB: string
  let tenantADeleted = false

  async function createEvent(tenantId: string, date: string): Promise<string> {
    // Un formato por fecha: el unique (template_id, event_date) no molesta.
    const { data: tpl, error: tplError } = await service
      .from('scheduled_event_templates')
      .insert({
        tenant_id: tenantId,
        name: 'Noche Pauta Test',
        slug: uniqueSlug('sem-tpl'),
        color_hex: '#ed4094',
        default_capacity: 70,
        default_meal_type: 'dinner',
        active: true,
      })
      .select('id')
      .single()
    if (tplError || !tpl) throw new Error(`template insert failed: ${tplError?.message}`)

    const { data: ev, error: evError } = await service
      .from('scheduled_events')
      .insert({
        tenant_id: tenantId,
        template_id: (tpl as { id: string }).id,
        event_date: date,
        starts_at_local: '21:00:00',
        capacity: 70,
        meal_type: 'dinner',
      })
      .select('id')
      .single()
    if (evError || !ev) throw new Error(`scheduled_event insert failed: ${evError?.message}`)
    return (ev as { id: string }).id
  }

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('sem-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('sem-cashierA') })
    hostA = await createUserClient({ email: uniqueEmail('sem-hostA') })
    waiterA = await createUserClient({ email: uniqueEmail('sem-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('sem-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Pauta A',
      slug: uniqueSlug('sem-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Pauta B',
      slug: uniqueSlug('sem-b'),
      ownerId: ownerB.userId,
    })

    const { error: memberError } = await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: hostA.userId, role: 'host' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])
    if (memberError) throw new Error(`memberships insert failed: ${memberError.message}`)

    eventA = await createEvent(tenantA.id, '2026-09-09')
    eventStaff = await createEvent(tenantA.id, '2026-09-10')
    eventWithAds = await createEvent(tenantA.id, '2026-10-20')
    eventB = await createEvent(tenantB.id, '2026-09-09')

    const { error: seedError } = await service.from(TABLE).insert([
      {
        tenant_id: tenantA.id,
        scheduled_event_id: eventStaff,
        ad_spend_usd_cents: 4500,
        messages: 9,
      },
      {
        tenant_id: tenantA.id,
        scheduled_event_id: eventWithAds,
        ad_spend_usd_cents: 6000,
        messages: 12,
      },
    ])
    if (seedError) throw new Error(`seed insert failed: ${seedError.message}`)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    // createTenant no limpia: los bares de prueba se borran acá (la pauta
    // cascadea con el bar, que es justamente lo que prueba el último test).
    if (service) {
      const ids = [tenantB?.id, tenantADeleted ? undefined : tenantA?.id].filter(
        (id): id is string => typeof id === 'string',
      )
      if (ids.length > 0) await service.from('tenants').delete().in('id', ids)
    }
    for (const user of [ownerA, cashierA, hostA, waiterA, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  }, HOOK_TIMEOUT)

  it(
    'el owner de A carga, lee, edita y borra la pauta de su fecha',
    async () => {
      const insert = await ownerA.client
        .from(TABLE)
        .insert({
          tenant_id: tenantA.id,
          scheduled_event_id: eventA,
          ad_spend_usd_cents: 17526,
          messages: 51,
          reach: 8420,
          revenue_ars_cents: 248_000_000,
          usd_ars_rate: 1450.5,
          notes: 'campaña de reels',
          created_by: ownerA.userId,
          updated_by: ownerA.userId,
        })
        .select('ad_spend_usd_cents, usd_ars_rate, updated_at')
        .single()
      expect(insert.error).toBeNull()
      expect(Number(insert.data?.ad_spend_usd_cents)).toBe(17526)
      // numeric(12,2): el mapper hace Number() por si llega como string.
      expect(Number(insert.data?.usd_ars_rate)).toBe(1450.5)
      const firstVersion = insert.data?.updated_at as string
      expect(firstVersion).toBeTruthy()

      const read = await ownerA.client
        .from(TABLE)
        .select('scheduled_event_id, messages')
        .eq('scheduled_event_id', eventA)
      expect(read.error).toBeNull()
      expect(read.data).toEqual([{ scheduled_event_id: eventA, messages: 51 }])

      // Una sola fila por edición: el alta concurrente de otro dueño es 23505 →
      // la action lo devuelve como `stale`.
      const dup = await ownerA.client
        .from(TABLE)
        .insert({ tenant_id: tenantA.id, scheduled_event_id: eventA, ad_spend_usd_cents: 100 })
        .select('scheduled_event_id')
      expect(dup.error?.code).toBe('23505')

      // Edición optimista: el mismo filtro por `updated_at` que usa la action,
      // con el timestamp tal como lo devolvió PostgREST (microsegundos y +00:00).
      const update = await ownerA.client
        .from(TABLE)
        .update({ messages: 52, updated_by: ownerA.userId })
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventA)
        .eq('updated_at', firstVersion)
        .select('messages, updated_at')
        .maybeSingle()
      expect(update.error).toBeNull()
      expect(update.data?.messages).toBe(52)
      const secondVersion = update.data?.updated_at as string
      expect(secondVersion).toBeTruthy()
      expect(secondVersion).not.toBe(firstVersion)

      // Otro dueño con la versión vieja: 0 filas, sin error → `stale`.
      const staleUpdate = await ownerA.client
        .from(TABLE)
        .update({ messages: 99 })
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventA)
        .eq('updated_at', firstVersion)
        .select('messages')
        .maybeSingle()
      expect(staleUpdate.error).toBeNull()
      expect(staleUpdate.data).toBeNull()

      const staleDelete = await ownerA.client
        .from(TABLE)
        .delete()
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventA)
        .eq('updated_at', firstVersion)
        .select('scheduled_event_id')
      expect(staleDelete.error).toBeNull()
      expect(staleDelete.data ?? []).toEqual([])

      // `delete … returning` devuelve los números borrados (van al audit).
      const del = await ownerA.client
        .from(TABLE)
        .delete()
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventA)
        .eq('updated_at', secondVersion)
        .select('ad_spend_usd_cents, messages')
      expect(del.error).toBeNull()
      expect(del.data).toEqual([{ ad_spend_usd_cents: 17526, messages: 52 }])

      const after = await service.from(TABLE).select('id').eq('scheduled_event_id', eventA)
      expect(after.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )

  it(
    '«No tuvo pauta» es gasto 0 pelado: los CHECK cortan las filas raras',
    async () => {
      const noAdsWithMessages = await ownerA.client
        .from(TABLE)
        .insert({
          tenant_id: tenantA.id,
          scheduled_event_id: eventA,
          ad_spend_usd_cents: 0,
          messages: 3,
        })
        .select('scheduled_event_id')
      expect(noAdsWithMessages.error?.code).toBe('23514')

      const revenueWithoutRate = await ownerA.client
        .from(TABLE)
        .insert({
          tenant_id: tenantA.id,
          scheduled_event_id: eventA,
          ad_spend_usd_cents: 1000,
          revenue_ars_cents: 100_000,
        })
        .select('scheduled_event_id')
      expect(revenueWithoutRate.error?.code).toBe('23514')

      const noAds = await ownerA.client
        .from(TABLE)
        .insert({ tenant_id: tenantA.id, scheduled_event_id: eventA, ad_spend_usd_cents: 0 })
        .select('ad_spend_usd_cents, messages')
        .single()
      expect(noAds.error).toBeNull()
      expect(noAds.data).toEqual({ ad_spend_usd_cents: 0, messages: null })

      const cleanup = await ownerA.client.from(TABLE).delete().eq('scheduled_event_id', eventA)
      expect(cleanup.error).toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'cajero, anfitrión y mozo del MISMO bar no ven ni escriben la pauta',
    async () => {
      for (const staff of [cashierA, hostA, waiterA]) {
        const select = await staff.client.from(TABLE).select('*')
        expect(select.error).toBeNull()
        expect(select.data ?? []).toEqual([])

        const insert = await staff.client
          .from(TABLE)
          .insert({ tenant_id: tenantA.id, scheduled_event_id: eventA, ad_spend_usd_cents: 100 })
          .select('scheduled_event_id')
        expect(insert.error).not.toBeNull()

        const update = await staff.client
          .from(TABLE)
          .update({ ad_spend_usd_cents: 1 })
          .eq('scheduled_event_id', eventStaff)
          .select('scheduled_event_id')
        expect(update.data ?? []).toEqual([])

        const del = await staff.client
          .from(TABLE)
          .delete()
          .eq('scheduled_event_id', eventStaff)
          .select('scheduled_event_id')
        expect(del.data ?? []).toEqual([])

        // Pero la fecha en sí sí la ven (`sev_select_member`): la excepción es la plata.
        const event = await staff.client.from('scheduled_events').select('id').eq('id', eventStaff)
        expect((event.data ?? []).map((r) => r.id)).toEqual([eventStaff])
      }

      const untouched = await service
        .from(TABLE)
        .select('ad_spend_usd_cents, messages')
        .eq('scheduled_event_id', eventStaff)
        .single()
      expect(untouched.data).toEqual({ ad_spend_usd_cents: 4500, messages: 9 })
    },
    TEST_TIMEOUT,
  )

  it(
    'el owner de B no ve nada de A ni puede escribirle',
    async () => {
      const theirs = await ownerB.client.from(TABLE).select('scheduled_event_id')
      expect(theirs.error).toBeNull()
      expect(theirs.data ?? []).toEqual([])

      const intoA = await ownerB.client
        .from(TABLE)
        .insert({ tenant_id: tenantA.id, scheduled_event_id: eventA, ad_spend_usd_cents: 100 })
        .select('scheduled_event_id')
      expect(intoA.error).not.toBeNull()

      const edit = await ownerB.client
        .from(TABLE)
        .update({ ad_spend_usd_cents: 1 })
        .eq('scheduled_event_id', eventStaff)
        .select('scheduled_event_id')
      expect(edit.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )

  it(
    'una fila no puede apuntar a una fecha de otro bar (FK compuesta → 23503)',
    async () => {
      // Owner de A, con SU tenant_id (pasa la RLS), apuntando a la fecha de B.
      const crossA = await ownerA.client
        .from(TABLE)
        .insert({ tenant_id: tenantA.id, scheduled_event_id: eventB, ad_spend_usd_cents: 100 })
        .select('scheduled_event_id')
      expect(crossA.error?.code).toBe('23503')

      // Y al revés: owner de B con el tenant de B, apuntando a una fecha de A.
      const crossB = await ownerB.client
        .from(TABLE)
        .insert({ tenant_id: tenantB.id, scheduled_event_id: eventA, ad_spend_usd_cents: 100 })
        .select('scheduled_event_id')
      expect(crossB.error?.code).toBe('23503')
    },
    TEST_TIMEOUT,
  )

  it(
    'anon no llega a la tabla',
    async () => {
      const anon = getAnonClient()
      const { data, error } = await anon.from(TABLE).select('*')
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    },
    TEST_TIMEOUT,
  )

  it(
    'borrar una fecha con pauta falla con 23503, aunque quien borra no vea la pauta',
    async () => {
      // El anfitrión puede borrar fechas (`sev_staff_write`) pero no ve la pauta:
      // la FK se chequea sin RLS y lo frena igual.
      const byHost = await hostA.client.from('scheduled_events').delete().eq('id', eventWithAds)
      expect(byHost.error?.code).toBe('23503')
      // `deleteScheduledEvent` reconoce el caso por el nombre de la tabla en el mensaje.
      expect(byHost.error?.message).toContain('scheduled_event_marketing')

      const byOwner = await ownerA.client.from('scheduled_events').delete().eq('id', eventWithAds)
      expect(byOwner.error?.code).toBe('23503')

      const stillThere = await service.from('scheduled_events').select('id').eq('id', eventWithAds)
      expect((stillThere.data ?? []).length).toBe(1)
    },
    TEST_TIMEOUT,
  )

  it(
    'borrar el bar entero cascadea la pauta sin chocar con la FK',
    async () => {
      const { error } = await service.from('tenants').delete().eq('id', tenantA.id)
      expect(error).toBeNull()
      tenantADeleted = true

      const rows = await service.from(TABLE).select('id').eq('tenant_id', tenantA.id)
      expect(rows.error).toBeNull()
      expect(rows.data ?? []).toEqual([])

      const events = await service.from('scheduled_events').select('id').eq('tenant_id', tenantA.id)
      expect(events.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )
})
