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
 * Grupos privados (migración 20261002120000, C1 de los socios del 02/10/2026).
 *
 * 1. El tilde es de la fecha y lo escribe el staff que ya escribe fechas
 *    (`sev_staff_write`: owner, cashier, host); el mozo y otro bar no.
 * 2. Invariante «un grupo privado no lleva pauta ni la plata de la noche»,
 *    desde los dos lados y con triggers SECURITY DEFINER (el anfitrión no ve la
 *    pauta, y el trigger igual la tiene que ver):
 *    - marcar privada una fecha con plata → `private_group_has_money`;
 *    - cargar plata en una fecha privada → `event_is_private_group`;
 *    - una «No tuvo pauta» pelada convive con el tilde;
 *    - el dueño de otro bar recibe siempre el error de RLS: el trigger de la
 *      pauta es AFTER y no le dice si una fecha ajena es privada.
 *    (La carrera entre los dos lados —los dos al mismo tiempo— se cubre con un
 *    lock en el trigger y se probó con dos sesiones en un PG 17: acá cada
 *    pedido es su propia transacción y no se puede reproducir.)
 * 3. `ensure_scheduled_event_for_template` crea la fecha ad-hoc ya privada, y
 *    si el formato ya estaba ese día devuelve esa fecha sin tocarla. `anon` no
 *    la puede ejecutar.
 * 4. «Se usa para grupos privados» del formato: lo escribe quien edita
 *    formatos (owner, host), no el cajero.
 */
describeIfRls('RLS — grupos privados (scheduled_events.private_group)', () => {
  let service: SupabaseClient
  let ownerA: UserClient
  let cashierA: UserClient
  let hostA: UserClient
  let waiterA: UserClient
  let ownerB: UserClient
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let templateA: string
  /** Con pauta gastada: nunca puede ser privada. */
  let eventWithAds: string
  /** Con «No tuvo pauta» pelada: puede ser privada. */
  let eventBare: string
  /** Sin fila de pauta. */
  let eventEmpty: string

  async function createEvent(tenantId: string, templateId: string, date: string) {
    const { data, error } = await service
      .from('scheduled_events')
      .insert({
        tenant_id: tenantId,
        template_id: templateId,
        event_date: date,
        starts_at_local: '21:00:00',
        capacity: 60,
        meal_type: 'dinner',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`scheduled_event insert failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  beforeAll(async () => {
    service = getServiceClient()
    ownerA = await createUserClient({ email: uniqueEmail('pg-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('pg-cashierA') })
    hostA = await createUserClient({ email: uniqueEmail('pg-hostA') })
    waiterA = await createUserClient({ email: uniqueEmail('pg-waiterA') })
    ownerB = await createUserClient({ email: uniqueEmail('pg-ownerB') })

    tenantA = await createTenant({
      name: 'Bar Privado A',
      slug: uniqueSlug('pg-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar Privado B',
      slug: uniqueSlug('pg-b'),
      ownerId: ownerB.userId,
    })
    const { error: memberError } = await service.from('memberships').insert([
      { tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' },
      { tenant_id: tenantA.id, user_id: hostA.userId, role: 'host' },
      { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
    ])
    if (memberError) throw new Error(`memberships insert failed: ${memberError.message}`)

    const { data: tpl, error: tplError } = await service
      .from('scheduled_event_templates')
      .insert({
        tenant_id: tenantA.id,
        name: 'Pizza libre',
        slug: uniqueSlug('pg-pizza'),
        default_capacity: 60,
        default_meal_type: 'dinner',
      })
      .select('id')
      .single()
    if (tplError || !tpl) throw new Error(`template insert failed: ${tplError?.message}`)
    templateA = (tpl as { id: string }).id

    eventWithAds = await createEvent(tenantA.id, templateA, '2026-09-21')
    eventBare = await createEvent(tenantA.id, templateA, '2026-09-18')
    eventEmpty = await createEvent(tenantA.id, templateA, '2026-09-17')

    const { error: seedError } = await service.from('scheduled_event_marketing').insert([
      {
        tenant_id: tenantA.id,
        scheduled_event_id: eventWithAds,
        ad_spend_usd_cents: 15_900,
        messages: 156,
      },
      { tenant_id: tenantA.id, scheduled_event_id: eventBare, ad_spend_usd_cents: 0 },
    ])
    if (seedError) throw new Error(`seed insert failed: ${seedError.message}`)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    if (service) {
      // La pauta tiene FK sin cascade a la fecha, pero cascadea con el bar.
      await service.from('tenants').delete().in('id', [tenantA?.id, tenantB?.id].filter(Boolean))
    }
    for (const user of [ownerA, cashierA, hostA, waiterA, ownerB]) {
      if (user) await deleteUser(user.userId)
    }
  }, HOOK_TIMEOUT)

  it(
    'las fechas nacen como evento: el default de la columna es false',
    async () => {
      const { data } = await service
        .from('scheduled_events')
        .select('private_group')
        .eq('id', eventEmpty)
        .single()
      expect(data?.private_group).toBe(false)
    },
    TEST_TIMEOUT,
  )

  it(
    'el anfitrión no puede marcar privada una fecha con pauta (aunque no la vea)',
    async () => {
      const res = await hostA.client
        .from('scheduled_events')
        .update({ private_group: true })
        .eq('tenant_id', tenantA.id)
        .eq('id', eventWithAds)
        .select('id')
      expect(res.error?.message).toContain('private_group_has_money')
    },
    TEST_TIMEOUT,
  )

  it(
    'una «No tuvo pauta» pelada convive con el tilde; el dueño no le puede cargar plata',
    async () => {
      const marked = await hostA.client
        .from('scheduled_events')
        .update({ private_group: true })
        .eq('tenant_id', tenantA.id)
        .eq('id', eventBare)
        .select('private_group')
        .single()
      expect(marked.error).toBeNull()
      expect(marked.data?.private_group).toBe(true)

      const money = await ownerA.client
        .from('scheduled_event_marketing')
        .update({ revenue_per_guest_ars_cents: 1_200_000 })
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventBare)
        .select('scheduled_event_id')
      expect(money.error?.message).toContain('event_is_private_group')

      const ads = await ownerA.client
        .from('scheduled_event_marketing')
        .update({ ad_spend_usd_cents: 5_000, messages: 10 })
        .eq('tenant_id', tenantA.id)
        .eq('scheduled_event_id', eventBare)
        .select('scheduled_event_id')
      expect(ads.error?.message).toContain('event_is_private_group')

      // Destildar siempre se puede.
      const unmarked = await ownerA.client
        .from('scheduled_events')
        .update({ private_group: false })
        .eq('tenant_id', tenantA.id)
        .eq('id', eventBare)
        .select('private_group')
        .single()
      expect(unmarked.error).toBeNull()
      expect(unmarked.data?.private_group).toBe(false)
    },
    TEST_TIMEOUT,
  )

  it(
    'el cajero marca; el mozo y el dueño de otro bar no tocan nada',
    async () => {
      const cashier = await cashierA.client
        .from('scheduled_events')
        .update({ private_group: true })
        .eq('tenant_id', tenantA.id)
        .eq('id', eventEmpty)
        .select('private_group')
      expect(cashier.error).toBeNull()
      expect(cashier.data).toEqual([{ private_group: true }])

      const waiter = await waiterA.client
        .from('scheduled_events')
        .update({ private_group: false })
        .eq('id', eventEmpty)
        .select('id')
      expect(waiter.error).toBeNull()
      expect(waiter.data ?? []).toEqual([])

      const otherBar = await ownerB.client
        .from('scheduled_events')
        .update({ private_group: false })
        .eq('id', eventEmpty)
        .select('id')
      expect(otherBar.error).toBeNull()
      expect(otherBar.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )

  it(
    'el dueño de otro bar no averigua si una fecha ajena es privada: siempre el error de RLS',
    async () => {
      // Con el trigger de la pauta BEFORE, una fecha privada contestaba
      // 'event_is_private_group' antes que la RLS, y una que no, el error de
      // RLS: un bit de otro bar para quien supiera los dos uuid.
      const privateDate = await createEvent(tenantA.id, templateA, '2026-09-16')
      const openDate = await createEvent(tenantA.id, templateA, '2026-09-15')
      const marked = await service
        .from('scheduled_events')
        .update({ private_group: true })
        .eq('id', privateDate)
      expect(marked.error).toBeNull()

      for (const scheduledEventId of [privateDate, openDate]) {
        const res = await ownerB.client.from('scheduled_event_marketing').insert({
          tenant_id: tenantA.id,
          scheduled_event_id: scheduledEventId,
          ad_spend_usd_cents: 15_000,
        })
        expect(res.error?.code).toBe('42501')
        expect(res.error?.message).not.toContain('event_is_private_group')
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'ensure_scheduled_event_for_template: la fecha ad-hoc nace privada; la ya programada no cambia',
    async () => {
      const created = await hostA.client.rpc('ensure_scheduled_event_for_template', {
        p_template_id: templateA,
        p_event_date: '2026-10-20',
        p_starts_at_local: '20:00',
        p_capacity: null,
      })
      expect(created.error).toBeNull()
      const { data: adHoc } = await service
        .from('scheduled_events')
        .select('private_group, notes')
        .eq('id', created.data as string)
        .single()
      expect(adHoc).toEqual({ private_group: true, notes: 'Ad-hoc creado por reserva especial' })

      const existing = await hostA.client.rpc('ensure_scheduled_event_for_template', {
        p_template_id: templateA,
        p_event_date: '2026-09-21',
        p_starts_at_local: '21:00',
        p_capacity: null,
      })
      expect(existing.error).toBeNull()
      expect(existing.data).toBe(eventWithAds)
      const { data: same } = await service
        .from('scheduled_events')
        .select('private_group')
        .eq('id', eventWithAds)
        .single()
      expect(same?.private_group).toBe(false)

      const anon = await getAnonClient().rpc('ensure_scheduled_event_for_template', {
        p_template_id: templateA,
        p_event_date: '2026-10-21',
        p_starts_at_local: '20:00',
        p_capacity: null,
      })
      expect(anon.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    '«Se usa para grupos privados»: lo marca quien edita formatos, no el cajero',
    async () => {
      const host = await hostA.client
        .from('scheduled_event_templates')
        .update({ default_private_group: true })
        .eq('tenant_id', tenantA.id)
        .eq('id', templateA)
        .select('default_private_group')
      expect(host.error).toBeNull()
      expect(host.data).toEqual([{ default_private_group: true }])

      const cashier = await cashierA.client
        .from('scheduled_event_templates')
        .update({ default_private_group: false })
        .eq('id', templateA)
        .select('id')
      expect(cashier.data ?? []).toEqual([])
    },
    TEST_TIMEOUT,
  )
})
