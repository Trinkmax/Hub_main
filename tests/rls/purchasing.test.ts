import type { SupabaseClient } from '@supabase/supabase-js'
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
type UserClient = Awaited<ReturnType<typeof createUserClient>>

const HOOK_TIMEOUT = 180_000
const TEST_TIMEOUT = 60_000

/**
 * Compras (migración 20261106180000): el catálogo lo leen dueño, cocina y caja y lo edita el dueño; la cocina
 * cuenta y recibe (estas dos por RPC) pero no toca los pedidos; el mozo no ve nada; otro bar, tampoco.
 */
describeIfRls('RLS — Compras (conteo, pedidos y recepción)', () => {
  let service: SupabaseClient
  let owner: UserClient
  let kitchen: UserClient
  let waiter: UserClient
  let otherOwner: UserClient
  let tenant: { id: string }
  let otherTenant: { id: string }
  let supplierId: string
  let itemId: string

  beforeAll(async () => {
    service = getServiceClient()
    owner = await createUserClient({ email: uniqueEmail('pur-owner') })
    kitchen = await createUserClient({ email: uniqueEmail('pur-kitchen') })
    waiter = await createUserClient({ email: uniqueEmail('pur-waiter') })
    otherOwner = await createUserClient({ email: uniqueEmail('pur-other') })
    tenant = await createTenant({
      name: 'Bar de compras',
      slug: uniqueSlug('compras'),
      ownerId: owner.userId,
    })
    otherTenant = await createTenant({
      name: 'Otro bar',
      slug: uniqueSlug('compras-b'),
      ownerId: otherOwner.userId,
    })
    await service.from('memberships').insert([
      { tenant_id: tenant.id, user_id: kitchen.userId, role: 'kitchen' },
      { tenant_id: tenant.id, user_id: waiter.userId, role: 'waiter' },
    ])
    const zone = await owner.client
      .from('pur_zones')
      .insert({ tenant_id: tenant.id, name: 'Cámara de frío', area: 'Planta alta', sort_order: 10 })
      .select('id')
      .single()
    expect(zone.error).toBeNull()
    const supplier = await owner.client
      .from('pur_suppliers')
      .insert({
        tenant_id: tenant.id,
        name: 'Va Food',
        whatsapp: '5493511234567',
        delivery_weekdays: [3, 5],
      })
      .select('id')
      .single()
    expect(supplier.error).toBeNull()
    supplierId = (supplier.data as { id: string }).id
    const item = await owner.client
      .from('pur_items')
      .insert({
        tenant_id: tenant.id,
        name: 'Bondiola de cerdo',
        unit: 'kg',
        target_qty: 10,
        pack_label: 'Por kg',
        pack_size: 1,
        zone_id: (zone.data as { id: string }).id,
        supplier_id: supplierId,
      })
      .select('id')
      .single()
    expect(item.error).toBeNull()
    itemId = (item.data as { id: string }).id
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    await service.from('tenants').delete().in('id', [tenant.id, otherTenant.id])
    for (const u of [owner, kitchen, waiter, otherOwner]) await deleteUser(u.userId)
  }, HOOK_TIMEOUT)

  it(
    'el catálogo: la cocina lo lee y no lo edita; el mozo y otro bar no lo ven',
    async () => {
      const k = await kitchen.client.from('pur_items').select('id').eq('tenant_id', tenant.id)
      expect(k.data).toHaveLength(1)
      const kEdit = await kitchen.client
        .from('pur_items')
        .update({ target_qty: 99 })
        .eq('id', itemId)
        .select('id')
      expect(kEdit.data ?? []).toHaveLength(0)
      const w = await waiter.client.from('pur_items').select('id').eq('tenant_id', tenant.id)
      expect(w.data ?? []).toHaveLength(0)
      const o = await otherOwner.client.from('pur_items').select('id').eq('tenant_id', tenant.id)
      expect(o.data ?? []).toHaveLength(0)
      const events = await waiter.client.rpc('pur_events_between', {
        p_tenant_id: tenant.id,
        p_from: '2026-11-01',
        p_to: '2026-11-07',
      })
      expect(events.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'la cocina cuenta, manda, y recibe con diferencias; solo el dueño mueve los pedidos',
    async () => {
      const count = await kitchen.client
        .from('pur_counts')
        .insert({
          tenant_id: tenant.id,
          kind: 'order',
          count_date: '2026-11-02',
          events_until: '2026-11-03',
          counted_by_name: 'Gustavo',
        })
        .select('id')
        .single()
      expect(count.error).toBeNull()
      const countId = (count.data as { id: string }).id

      // Uno solo abierto por bar.
      const second = await owner.client.from('pur_counts').insert({
        tenant_id: tenant.id,
        kind: 'top_up',
        count_date: '2026-11-02',
        events_until: '2026-11-03',
        counted_by_name: 'Otro',
      })
      expect(second.error?.code).toBe('23505')

      const line = await kitchen.client
        .from('pur_count_lines')
        .insert({ tenant_id: tenant.id, count_id: countId, item_id: itemId, state: 'none' })
      expect(line.error).toBeNull()

      const submit = await kitchen.client.rpc('pur_submit_count', {
        p_count_id: countId,
        p_orders: [
          {
            supplier_id: supplierId,
            expected_date: '2026-11-04',
            lines: [
              {
                item_id: itemId,
                name: 'Bondiola de cerdo',
                unit: 'kg',
                pack_label: 'Por kg',
                pack_size: 1,
                counted_qty: 0,
                count_state: 'none',
                target_qty: 10,
                event_qty: 0,
                event_names: [],
                in_transit_qty: 0,
                suggested_packs: 10,
                ordered_packs: 10,
              },
            ],
          },
        ],
      })
      expect(submit.error).toBeNull()

      // Enviado, el conteo ya no se toca.
      const late = await kitchen.client
        .from('pur_count_lines')
        .update({ state: 'enough', quantity: null })
        .eq('count_id', countId)
        .select('id')
      expect(late.data ?? []).toHaveLength(0)

      const orders = await kitchen.client
        .from('pur_orders')
        .select('id, status, pur_order_lines(id)')
        .eq('tenant_id', tenant.id)
      expect(orders.data).toHaveLength(1)
      const order = (
        orders.data as Array<{ id: string; status: string; pur_order_lines: { id: string }[] }>
      )[0]
      expect(order?.status).toBe('draft')

      // La cocina no puede mandarlo ni recibir un borrador.
      const kSend = await kitchen.client
        .from('pur_orders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', order?.id ?? '')
        .select('id')
      expect(kSend.data ?? []).toHaveLength(0)
      const draftReceive = await kitchen.client.rpc('pur_receive_order', {
        p_order_id: order?.id ?? '',
        p_received_by_name: 'Gustavo',
        p_lines: [],
      })
      expect(draftReceive.error).not.toBeNull()

      const send = await owner.client
        .from('pur_orders')
        .update({ status: 'sent', sent_at: new Date().toISOString(), message: 'Hola' })
        .eq('id', order?.id ?? '')
        .select('id')
      expect(send.data).toHaveLength(1)

      const receive = await kitchen.client.rpc('pur_receive_order', {
        p_order_id: order?.id ?? '',
        p_received_by_name: 'Gustavo',
        p_lines: [{ id: order?.pur_order_lines[0]?.id, state: 'partial', packs: 6 }],
      })
      expect(receive.error).toBeNull()
      expect((receive.data as { status: string }).status).toBe('with_differences')

      const waiterReceive = await waiter.client.rpc('pur_receive_order', {
        p_order_id: order?.id ?? '',
        p_received_by_name: 'Mozo',
        p_lines: [],
      })
      expect(waiterReceive.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'un pedido armado a mano (lo arma Tex, `createDraft`): lo crea el dueño; la cocina y otro bar no',
    async () => {
      const created = await owner.client
        .from('pur_orders')
        .insert({
          tenant_id: tenant.id,
          supplier_id: supplierId,
          status: 'draft',
          expected_date: '2026-11-11',
          supplier_note: 'Antes de las 11',
          created_by: owner.userId,
        })
        .select('id')
        .single()
      expect(created.error).toBeNull()
      const orderId = (created.data as { id: string }).id
      const lines = await owner.client.from('pur_order_lines').insert({
        tenant_id: tenant.id,
        order_id: orderId,
        item_id: itemId,
        name: 'Bondiola de cerdo',
        unit: 'kg',
        pack_label: 'Por kg',
        pack_size: 1,
        target_qty: 10,
        ordered_packs: 4,
        added_by_hand: true,
        sort_order: 1,
      })
      expect(lines.error).toBeNull()

      const kitchenCreate = await kitchen.client
        .from('pur_orders')
        .insert({ tenant_id: tenant.id, supplier_id: supplierId, status: 'draft' })
      expect(kitchenCreate.error).not.toBeNull()
      const kitchenLine = await kitchen.client.from('pur_order_lines').insert({
        tenant_id: tenant.id,
        order_id: orderId,
        item_id: itemId,
        name: 'Bondiola de cerdo',
        unit: 'kg',
        ordered_packs: 40,
      })
      expect(kitchenLine.error).not.toBeNull()
      const otherCreate = await otherOwner.client
        .from('pur_orders')
        .insert({ tenant_id: tenant.id, supplier_id: supplierId, status: 'draft' })
      expect(otherCreate.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )
})
