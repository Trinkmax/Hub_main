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

describeIfRls('RLS — anidamiento de categorías (move / cascade / aislamiento)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let cashierA: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let customerA: { id: string }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('nestA') })
    ownerB = await createUserClient({ email: uniqueEmail('nestB') })
    cashierA = await createUserClient({ email: uniqueEmail('nestCashier') })

    tenantA = await createTenant({
      name: 'Nest A',
      slug: uniqueSlug('nest-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Nest B',
      slug: uniqueSlug('nest-b'),
      ownerId: ownerB.userId,
    })

    const service = getServiceClient()
    await service
      .from('memberships')
      .insert([{ tenant_id: tenantA.id, user_id: cashierA.userId, role: 'cashier' }])

    const { data: cust } = await service
      .from('customers')
      .insert({
        tenant_id: tenantA.id,
        phone: `+5491177${Date.now().toString().slice(-7)}`,
        first_name: 'Nido',
        last_name: 'Test',
      })
      .select('id')
      .single()
    customerA = cust as { id: string }
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
    if (cashierA) await deleteUser(cashierA.userId)
  })

  // Crea una categoría vía service (bypassa RLS) y devuelve su id.
  async function mkCat(
    tenantId: string,
    name: string,
    parentId: string | null = null,
  ): Promise<string> {
    const service = getServiceClient()
    const { data, error } = await service
      .from('menu_categories')
      .insert({ tenant_id: tenantId, name, parent_id: parentId })
      .select('id')
      .single()
    if (error || !data) throw new Error(`mkCat failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function mkItem(tenantId: string, categoryId: string, name: string): Promise<string> {
    const service = getServiceClient()
    const { data, error } = await service
      .from('menu_items')
      .insert({ tenant_id: tenantId, category_id: categoryId, name, price_cents: 50000 })
      .select('id')
      .single()
    if (error || !data) throw new Error(`mkItem failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  it('move_category: owner mueve subcategoría a la raíz', async () => {
    const bebidas = await mkCat(tenantA.id, 'Bebidas')
    const vinos = await mkCat(tenantA.id, 'Vinos', bebidas)

    const { error } = await ownerA.client.rpc('move_category', {
      p_category_id: vinos,
      p_new_parent_id: null,
    })
    expect(error).toBeNull()

    const service = getServiceClient()
    const { data } = await service
      .from('menu_categories')
      .select('parent_id')
      .eq('id', vinos)
      .single()
    expect((data as { parent_id: string | null } | null)?.parent_id).toBeNull()
  })

  it('move_category: rechaza ciclo (mover el padre dentro de su descendiente)', async () => {
    const bebidas = await mkCat(tenantA.id, 'Bebidas2')
    const vinos = await mkCat(tenantA.id, 'Vinos2', bebidas)

    const { error } = await ownerA.client.rpc('move_category', {
      p_category_id: bebidas,
      p_new_parent_id: vinos,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('cycle')
  })

  it('move_category: cashier no puede (owner-only)', async () => {
    const c = await mkCat(tenantA.id, 'SoloOwner')
    const { error } = await cashierA.client.rpc('move_category', {
      p_category_id: c,
      p_new_parent_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('move_category: no permite padre de otro tenant', async () => {
    const catA = await mkCat(tenantA.id, 'CatA')
    const catB = await mkCat(tenantB.id, 'CatB')
    const { error } = await ownerA.client.rpc('move_category', {
      p_category_id: catA,
      p_new_parent_id: catB,
    })
    expect(error).not.toBeNull()
  })

  it('delete_category_cascade: archiva ítem con historial y borra el resto', async () => {
    const service = getServiceClient()
    const bebidas = await mkCat(tenantA.id, 'BebidasDel')
    const vinos = await mkCat(tenantA.id, 'VinosDel', bebidas)
    const malbec = await mkItem(tenantA.id, vinos, 'MalbecDel') // quedará referenciado en una visita
    const agua = await mkItem(tenantA.id, bebidas, 'AguaDel') // libre

    // close_table crea visit_items que referencian malbec → no se podrá borrar físico.
    const { error: ctErr } = await cashierA.client.rpc('close_table', {
      p_customer_id: customerA.id,
      p_items: [{ item_id: malbec, quantity: 1 }],
      p_notes: 'nido',
    })
    expect(ctErr).toBeNull()

    const { data: summary, error } = await ownerA.client.rpc('delete_category_cascade', {
      p_category_id: bebidas,
    })
    expect(error).toBeNull()
    const s = (Array.isArray(summary) ? summary[0] : summary) as {
      archived_items: number
      deleted_items: number
      deleted_categories: number
    } | null
    expect(s?.archived_items).toBeGreaterThanOrEqual(1)

    // Malbec sobrevive ARCHIVADO (category_id null, active false); su visit_item intacto.
    const { data: malbecRow } = await service
      .from('menu_items')
      .select('id, category_id, active')
      .eq('id', malbec)
      .maybeSingle()
    const mr = malbecRow as { id: string; category_id: string | null; active: boolean } | null
    expect(mr?.id).toBe(malbec)
    expect(mr?.category_id).toBeNull()
    expect(mr?.active).toBe(false)

    const { data: vi } = await service.from('visit_items').select('id').eq('menu_item_id', malbec)
    expect((vi ?? []).length).toBeGreaterThanOrEqual(1)

    // Agua (libre) borrado físico; categorías del subárbol borradas.
    const { data: aguaRow } = await service
      .from('menu_items')
      .select('id')
      .eq('id', agua)
      .maybeSingle()
    expect(aguaRow).toBeNull()

    const { data: cats } = await service
      .from('menu_categories')
      .select('id')
      .in('id', [bebidas, vinos])
    expect((cats ?? []).length).toBe(0)
  })

  it('delete_category_cascade: cashier no puede (owner-only)', async () => {
    const c = await mkCat(tenantA.id, 'NoBorrable')
    const { error } = await cashierA.client.rpc('delete_category_cascade', { p_category_id: c })
    expect(error).not.toBeNull()
  })

  it('aislamiento: ownerB no ve categorías de tenantA', async () => {
    const c = await mkCat(tenantA.id, 'PrivadaA')
    const { data } = await ownerB.client.from('menu_categories').select('id').eq('id', c)
    expect(data ?? []).toEqual([])
  })
})
