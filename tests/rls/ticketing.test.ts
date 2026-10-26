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
