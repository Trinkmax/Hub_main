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

describeIfRls('RLS — scheduled_event_templates staff insert', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }

  function tpl(extra: Record<string, unknown> = {}) {
    return {
      tenant_id: tenantA.id,
      name: 'Cashier Libre',
      slug: uniqueSlug('cashier-libre'),
      consume_special_reservations: false,
      default_capacity: 30,
      default_meal_type: 'dinner',
      color_hex: '#7c3aed',
      active: true,
      ...extra,
    }
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('tpl-ownerA') })
    cashierA = await createUserClient({ email: uniqueEmail('tpl-cashier') })
    ownerB = await createUserClient({ email: uniqueEmail('tpl-ownerB') })
    tenantA = await createTenant({
      name: 'Bar TPL A',
      slug: uniqueSlug('tpl-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Bar TPL B',
      slug: uniqueSlug('tpl-b'),
      ownerId: ownerB.userId,
    })
    const service = getServiceClient()
    await service
      .from('memberships')
      .insert([{ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' }])
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (cashierA) await deleteUser(cashierA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('cashier de A inserta un formato → ok', async () => {
    const { data, error } = await cashierA.client
      .from('scheduled_event_templates')
      .insert(tpl())
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('cashier de A NO puede editar un formato existente (sigue owner-only)', async () => {
    const service = getServiceClient()
    const { data: created } = await service
      .from('scheduled_event_templates')
      .insert(tpl({ slug: uniqueSlug('owned') }))
      .select('id')
      .single()
    const id = (created as { id: string }).id

    await cashierA.client
      .from('scheduled_event_templates')
      .update({ name: 'Hackeado' })
      .eq('id', id)

    const { data: after } = await service
      .from('scheduled_event_templates')
      .select('name')
      .eq('id', id)
      .single()
    expect((after as { name: string }).name).not.toBe('Hackeado')
  })

  it('cashier de A NO puede insertar en el tenant B', async () => {
    const { error } = await cashierA.client
      .from('scheduled_event_templates')
      .insert(tpl({ tenant_id: tenantB.id, slug: uniqueSlug('cross') }))
      .select('id')
      .single()
    expect(error).not.toBeNull()
  })
})
