import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPhone } from '@/lib/phone'
import {
  createUserClient,
  deleteUser,
  getServiceClient,
  RLS_TESTS_ENABLED,
  uniqueEmail,
  uniqueSlug,
} from './setup'

/**
 * Compras ↔ Administración (migración 20261111222154): un proveedor de Compras unido a una o más razones
 * sociales. Unir es del dueño que carga en Administración; al unir se completa lo que falta; después, los
 * días de entrega y la anticipación quedan iguales en los dos lados (y en las otras razones sociales), y el
 * WhatsApp sigue al teléfono mientras sean el mismo número. La cuenta del teléfono de la base es la misma
 * que la de `canonicalPhone` (lib/phone.ts). Corre contra el Supabase local del job `rls`.
 */

const describeIfRls = RLS_TESTS_ENABLED ? describe : describe.skip
type UserCtx = Awaited<ReturnType<typeof createUserClient>>

const HOOK_TIMEOUT = 180_000
const TEST_TIMEOUT = 60_000

function booksStart(): string {
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10)
}

describeIfRls('Compras ↔ Administración: un proveedor, sus razones sociales y sus datos', () => {
  let service: SupabaseClient
  let owner: UserCtx
  let ownerNoAcc: UserCtx
  let tenantId: string
  let supplierId: string
  let p1: string
  let p2: string

  async function accountOf(systemKey: string): Promise<string> {
    const { data, error } = await service
      .from('acc_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('system_key', systemKey)
      .single()
    if (error || !data) throw new Error(`account ${systemKey} failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function supplier() {
    const { data, error } = await service
      .from('pur_suppliers')
      .select('delivery_weekdays, lead_days, whatsapp')
      .eq('id', supplierId)
      .single()
    if (error || !data) throw new Error(`supplier failed: ${error?.message}`)
    return data as { delivery_weekdays: number[]; lead_days: number; whatsapp: string | null }
  }

  async function party(id: string) {
    const { data, error } = await service
      .from('acc_parties')
      .select('delivery_days, order_lead_days, phone')
      .eq('id', id)
      .single()
    if (error || !data) throw new Error(`party failed: ${error?.message}`)
    return data as { delivery_days: number[]; order_lead_days: number | null; phone: string | null }
  }

  beforeAll(async () => {
    service = getServiceClient()
    owner = await createUserClient({ email: uniqueEmail('purAccOwner') })
    ownerNoAcc = await createUserClient({ email: uniqueEmail('purAccOther') })
    const created = await service
      .from('tenants')
      .insert({
        name: 'Bar de razones sociales',
        slug: uniqueSlug('pur-razones'),
        feature_flags: { accounting: true, purchasing: true },
      })
      .select('id')
      .single()
    if (created.error || !created.data) throw new Error(`tenant failed: ${created.error?.message}`)
    tenantId = (created.data as { id: string }).id
    const members = await service.from('memberships').insert([
      { tenant_id: tenantId, user_id: owner.userId, role: 'owner' },
      { tenant_id: tenantId, user_id: ownerNoAcc.userId, role: 'owner' },
    ])
    if (members.error) throw new Error(`memberships failed: ${members.error.message}`)
    const boot = await owner.client.rpc('acc_bootstrap', {
      p_tenant_id: tenantId,
      p_payload: {
        settings: {
          legal_name: 'Bar de Prueba SAS',
          cuit: '30718765435',
          books_start_date: booksStart(),
          iva_condition: 'responsable_inscripto',
          fiscal_year_end_month: 12,
        },
        treasuries: [{ key: 'cash_main', name: 'Caja', kind: 'cash' }],
        sales: { transfer_destination: 'cash_main', enabled_methods: ['cash'], sales_points: [] },
      },
    })
    if (boot.error) throw new Error(`acc_bootstrap failed: ${boot.error.message}`)

    const payable = await accountOf('payable_suppliers')
    const receivable = await accountOf('receivable_customers')
    const parties = await service
      .from('acc_parties')
      .insert([
        {
          tenant_id: tenantId,
          kind: 'supplier',
          name: 'Vittis Vino SA',
          delivery_days: [1, 2, 3, 4, 5],
          order_lead_days: 2,
          phone: '351 555-1234',
          payable_account_id: payable,
          receivable_account_id: receivable,
        },
        {
          // Con todas las columnas: en un insert de varias filas, la que falta va como null.
          tenant_id: tenantId,
          kind: 'supplier',
          name: 'Vittis Distribuidora SRL',
          delivery_days: [],
          order_lead_days: null,
          phone: null,
          payable_account_id: payable,
          receivable_account_id: receivable,
        },
      ])
      .select('id, name')
    if (parties.error || !parties.data) throw new Error(`parties failed: ${parties.error?.message}`)
    const rows = parties.data as { id: string; name: string }[]
    p1 = rows.find((r) => r.name === 'Vittis Vino SA')?.id ?? ''
    p2 = rows.find((r) => r.name === 'Vittis Distribuidora SRL')?.id ?? ''

    const sup = await owner.client
      .from('pur_suppliers')
      .insert({ tenant_id: tenantId, name: 'Vittis' })
      .select('id')
      .single()
    if (sup.error || !sup.data) throw new Error(`supplier failed: ${sup.error?.message}`)
    supplierId = (sup.data as { id: string }).id
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    if (tenantId) await service.from('tenants').delete().eq('id', tenantId)
    for (const u of [owner, ownerNoAcc]) if (u) await deleteUser(u.userId)
  }, HOOK_TIMEOUT)

  it(
    'unir es del dueño que carga en Administración',
    async () => {
      const denied = await ownerNoAcc.client.from('pur_supplier_parties').insert({
        tenant_id: tenantId,
        supplier_id: supplierId,
        acc_party_id: p1,
      })
      expect(denied.error).not.toBeNull()
    },
    TEST_TIMEOUT,
  )

  it(
    'al unir, Compras toma lo que tenía Administración; la segunda razón social toma lo de Compras',
    async () => {
      const first = await owner.client.from('pur_supplier_parties').insert({
        tenant_id: tenantId,
        supplier_id: supplierId,
        acc_party_id: p1,
      })
      expect(first.error).toBeNull()
      expect(await supplier()).toEqual({
        delivery_weekdays: [1, 2, 3, 4, 5],
        lead_days: 2,
        whatsapp: '5493515551234',
      })

      const second = await owner.client.from('pur_supplier_parties').insert({
        tenant_id: tenantId,
        supplier_id: supplierId,
        acc_party_id: p2,
      })
      expect(second.error).toBeNull()
      expect(await party(p2)).toEqual({
        delivery_days: [1, 2, 3, 4, 5],
        order_lead_days: 2,
        phone: '3515551234',
      })

      // Una razón social va con un solo proveedor.
      const other = await owner.client
        .from('pur_suppliers')
        .insert({ tenant_id: tenantId, name: 'Otro' })
        .select('id')
        .single()
      const dup = await owner.client.from('pur_supplier_parties').insert({
        tenant_id: tenantId,
        supplier_id: (other.data as { id: string }).id,
        acc_party_id: p1,
      })
      expect(dup.error?.code).toBe('23505')
    },
    TEST_TIMEOUT,
  )

  it(
    'cambiar los días en Compras los cambia en las dos razones sociales, y al revés',
    async () => {
      const upd = await owner.client
        .from('pur_suppliers')
        .update({ delivery_weekdays: [2, 4], lead_days: 1 })
        .eq('id', supplierId)
      expect(upd.error).toBeNull()
      for (const id of [p1, p2]) {
        const p = await party(id)
        expect(p.delivery_days).toEqual([2, 4])
        expect(p.order_lead_days).toBe(1)
      }

      // Desde Administración (como acc_party_save): el domingo es 7 allá y 0 en Compras.
      const fromAcc = await service
        .from('acc_parties')
        .update({ delivery_days: [7], order_lead_days: 3 })
        .eq('id', p1)
      expect(fromAcc.error).toBeNull()
      expect(await supplier()).toMatchObject({ delivery_weekdays: [0], lead_days: 3 })
      expect(await party(p2)).toMatchObject({ delivery_days: [7], order_lead_days: 3 })
    },
    TEST_TIMEOUT,
  )

  it(
    'el WhatsApp sigue al teléfono mientras sean el mismo número; el de la otra razón social, no',
    async () => {
      await service.from('acc_parties').update({ phone: '0351 15 444-5555' }).eq('id', p1)
      expect((await supplier()).whatsapp).toBe('5493514445555')
      expect((await party(p2)).phone).toBe('3515551234')

      // Con otro número (como Waggon: el de Compras no es el de esta razón social), cambiar el teléfono en
      // Administración no pisa el WhatsApp.
      await service.from('acc_parties').update({ phone: '351 222-3333' }).eq('id', p2)
      expect((await supplier()).whatsapp).toBe('5493514445555')

      // Y si era el mismo, cambiar el WhatsApp en Compras cambia el teléfono de esa razón social (no el de la otra).
      await service.from('pur_suppliers').update({ whatsapp: '5493517777777' }).eq('id', supplierId)
      expect((await party(p1)).phone).toBe('3517777777')
      expect((await party(p2)).phone).toBe('351 222-3333')
    },
    TEST_TIMEOUT,
  )

  it(
    'la cuenta del teléfono es la de la app (canonicalPhone)',
    async () => {
      // Se vacía el WhatsApp para que siga al teléfono desde el primero.
      await service.from('pur_suppliers').update({ whatsapp: null }).eq('id', supplierId)
      await service.from('acc_parties').update({ phone: null }).eq('id', p1)
      const samples = [
        '351 555-1234',
        '0351 15 555-1234',
        '+54 9 351 555 1234',
        '+54 351 555 1234',
        '5493515551234',
        '543515551234',
        '93515551234',
        '(0351) 155-551234',
        '11 5555-1234',
        '+1 415 555 0100',
        '351 555 1234 int 2',
        '351 666-7777',
      ]
      for (const phone of samples) {
        const res = await service.from('acc_parties').update({ phone }).eq('id', p1)
        expect(res.error).toBeNull()
        const expected = canonicalPhone(phone)?.replace(/\D/g, '') ?? null
        expect({ phone, whatsapp: (await supplier()).whatsapp }).toEqual({
          phone,
          whatsapp: expected,
        })
      }
    },
    TEST_TIMEOUT,
  )

  it(
    'soltar una razón social deja sus datos como estaban',
    async () => {
      const off = await owner.client
        .from('pur_supplier_parties')
        .delete()
        .eq('supplier_id', supplierId)
        .eq('acc_party_id', p2)
      expect(off.error).toBeNull()
      const before = await party(p2)
      await owner.client
        .from('pur_suppliers')
        .update({ delivery_weekdays: [5] })
        .eq('id', supplierId)
      expect(await party(p2)).toEqual(before)
      expect((await party(p1)).delivery_days).toEqual([5])
    },
    TEST_TIMEOUT,
  )
})
