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

type Applied = {
  item_id: string
  branch_id: string | null
  from_cents: number | null
  to_cents: number | null
}
type Failed = {
  item_id: string
  branch_id: string | null
  reason: string
  current_cents: number | null
}
type Outcome = { batch_id: string | null; applied: Applied[]; failed: Failed[] }

const change = (
  itemId: string,
  branchId: string | null,
  expectedCents: number | null,
  priceCents: number | null,
) => ({
  item_id: itemId,
  branch_id: branchId,
  expected_cents: expectedCents,
  price_cents: priceCents,
})

/**
 * `menu_apply_price_changes`: los precios se cambian en una sola operación, entera o nada.
 *
 * Corre con los permisos de quien la llama, así que acá se prueba con sesiones de verdad: que el dueño
 * pueda, que un mozo no, que nadie alcance los precios de otro bar, que lo que otro cambió en el medio no
 * se pise, que un pedido con algo inválido no deje nada escrito y que un aumento quede marcado como una
 * tanda en el historial.
 */
describeIfRls('Precios — menu_apply_price_changes (entero o nada, por rol y por bar)', () => {
  let ownerA: Awaited<ReturnType<typeof createUserClient>>
  let waiterA: Awaited<ReturnType<typeof createUserClient>>
  let editorA: Awaited<ReturnType<typeof createUserClient>>
  let ownerB: Awaited<ReturnType<typeof createUserClient>>
  let tenantA: { id: string; slug: string }
  let tenantB: { id: string; slug: string }
  let branchA: string
  let branchB: string
  /** Una categoría por bar: todo producto cuelga de una. */
  const categoryOf = new Map<string, string>()

  const service = () => getServiceClient()

  async function mkCategory(tenantId: string): Promise<void> {
    const { data, error } = await service()
      .from('menu_categories')
      .insert({ tenant_id: tenantId, name: 'Todo' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`mkCategory failed: ${error?.message}`)
    categoryOf.set(tenantId, (data as { id: string }).id)
  }

  async function mkItem(tenantId: string, name: string, priceCents: number): Promise<string> {
    const { data, error } = await service()
      .from('menu_items')
      .insert({
        tenant_id: tenantId,
        category_id: categoryOf.get(tenantId),
        name,
        price_cents: priceCents,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`mkItem failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  async function priceOf(itemId: string): Promise<number> {
    const { data } = await service()
      .from('menu_items')
      .select('price_cents')
      .eq('id', itemId)
      .single()
    return Number((data as { price_cents: number | string }).price_cents)
  }

  async function ownPriceOf(branchId: string, itemId: string): Promise<number | null | undefined> {
    const { data } = await service()
      .from('menu_item_branches')
      .select('price_cents')
      .eq('branch_id', branchId)
      .eq('menu_item_id', itemId)
      .maybeSingle()
    if (!data) return undefined
    const cents = (data as { price_cents: number | string | null }).price_cents
    return cents === null ? null : Number(cents)
  }

  async function historyOf(itemId: string) {
    const { data } = await service()
      .from('menu_price_changes')
      .select('branch_id, old_price_cents, new_price_cents, batch_id, changed_by')
      .eq('menu_item_id', itemId)
      .order('created_at', { ascending: true })
    return (data ?? []) as Array<{
      branch_id: string | null
      old_price_cents: number | null
      new_price_cents: number | null
      batch_id: string | null
      changed_by: string | null
    }>
  }

  async function defaultBranch(tenantId: string): Promise<string> {
    const { data, error } = await service()
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .single()
    if (error || !data) throw new Error(`default branch failed: ${error?.message}`)
    return (data as { id: string }).id
  }

  beforeAll(async () => {
    ownerA = await createUserClient({ email: uniqueEmail('priceOwnerA') })
    waiterA = await createUserClient({ email: uniqueEmail('priceWaiterA') })
    editorA = await createUserClient({ email: uniqueEmail('priceEditorA') })
    ownerB = await createUserClient({ email: uniqueEmail('priceOwnerB') })
    tenantA = await createTenant({
      name: 'Precios A',
      slug: uniqueSlug('precios-a'),
      ownerId: ownerA.userId,
    })
    tenantB = await createTenant({
      name: 'Precios B',
      slug: uniqueSlug('precios-b'),
      ownerId: ownerB.userId,
    })
    await service()
      .from('memberships')
      .insert([
        { tenant_id: tenantA.id, user_id: waiterA.userId, role: 'waiter' },
        { tenant_id: tenantA.id, user_id: editorA.userId, role: 'editor' },
      ])
    branchA = await defaultBranch(tenantA.id)
    branchB = await defaultBranch(tenantB.id)
    await mkCategory(tenantA.id)
    await mkCategory(tenantB.id)
  })

  afterAll(async () => {
    if (ownerA) await deleteUser(ownerA.userId)
    if (waiterA) await deleteUser(waiterA.userId)
    if (editorA) await deleteUser(editorA.userId)
    if (ownerB) await deleteUser(ownerB.userId)
  })

  it('un aumento: la carta y un precio propio cambian juntos y quedan como una tanda', async () => {
    const lomo = await mkItem(tenantA.id, 'Lomo', 3_000_000)
    const birra = await mkItem(tenantA.id, 'Cerveza', 500_000)

    const { data, error } = await ownerA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [
        change(lomo, null, 3_000_000, 3_300_000),
        change(birra, null, 500_000, 550_000),
        change(lomo, branchA, null, 3_500_000),
      ],
      p_batch: true,
    })
    expect(error).toBeNull()
    const outcome = data as Outcome
    expect(outcome.applied).toHaveLength(3)
    expect(outcome.failed).toEqual([])
    expect(outcome.batch_id).toEqual(expect.any(String))

    expect(await priceOf(lomo)).toBe(3_300_000)
    expect(await priceOf(birra)).toBe(550_000)
    expect(await ownPriceOf(branchA, lomo)).toBe(3_500_000)

    const history = [...(await historyOf(lomo)), ...(await historyOf(birra))]
    expect(history).toHaveLength(3)
    for (const row of history) {
      expect(row.batch_id).toBe(outcome.batch_id)
      expect(row.changed_by).toBe(ownerA.userId)
    }
  })

  it('un cambio suelto no es una tanda', async () => {
    const flan = await mkItem(tenantA.id, 'Flan', 700_000)
    const { data, error } = await ownerA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(flan, null, 700_000, 770_000)],
    })
    expect(error).toBeNull()
    expect((data as Outcome).batch_id).toBeNull()
    expect(await priceOf(flan)).toBe(770_000)
    const history = await historyOf(flan)
    expect(history).toHaveLength(1)
    expect(history[0]?.batch_id).toBeNull()
  })

  it('lo que otro cambió en el medio no se pisa, y dice cuánto vale ahora', async () => {
    const cafe = await mkItem(tenantA.id, 'Café', 380_000)
    const tostado = await mkItem(tenantA.id, 'Tostado', 900_000)
    // Otro socio lo sube mientras esta pantalla todavía muestra 3.800.
    await service().from('menu_items').update({ price_cents: 400_000 }).eq('id', cafe)

    const { data, error } = await ownerA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(cafe, null, 380_000, 420_000), change(tostado, null, 900_000, 990_000)],
      p_batch: true,
    })
    expect(error).toBeNull()
    const outcome = data as Outcome
    expect(outcome.applied.map((row) => row.item_id)).toEqual([tostado])
    expect(outcome.failed).toEqual([
      { item_id: cafe, branch_id: null, reason: 'changed', current_cents: 400_000 },
    ])
    expect(await priceOf(cafe)).toBe(400_000)
    expect(await priceOf(tostado)).toBe(990_000)
  })

  it('la editora también puede; el mozo no', async () => {
    const agua = await mkItem(tenantA.id, 'Agua', 200_000)

    const asEditor = await editorA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(agua, null, 200_000, 220_000)],
    })
    expect(asEditor.error).toBeNull()
    expect(await priceOf(agua)).toBe(220_000)

    const asWaiter = await waiterA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(agua, null, 220_000, 1)],
    })
    expect(asWaiter.error?.message).toContain('forbidden')
    expect(await priceOf(agua)).toBe(220_000)
  })

  it('sin sesión no se la puede ni llamar', async () => {
    const soda = await mkItem(tenantA.id, 'Soda', 150_000)
    const { error } = await getAnonClient().rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(soda, null, 150_000, 1)],
    })
    expect(error).not.toBeNull()
    expect(await priceOf(soda)).toBe(150_000)
  })

  it('el dueño de otro bar no alcanza estos precios: ni diciendo este bar ni el suyo', async () => {
    const vino = await mkItem(tenantA.id, 'Vino', 1_200_000)
    const suyo = await mkItem(tenantB.id, 'Suyo', 100_000)

    // Diciendo que es de este bar: no tiene rol acá.
    const asThisBar = await ownerB.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(vino, null, 1_200_000, 1)],
    })
    expect(asThisBar.error?.message).toContain('forbidden')

    // Desde su bar: el producto de acá le figura como que no está, y el suyo sí cambia.
    const asHisBar = await ownerB.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantB.id,
      p_changes: [change(vino, null, 1_200_000, 1), change(suyo, null, 100_000, 110_000)],
    })
    expect(asHisBar.error).toBeNull()
    const outcome = asHisBar.data as Outcome
    expect(outcome.failed).toEqual([
      { item_id: vino, branch_id: null, reason: 'missing', current_cents: null },
    ])
    expect(outcome.applied.map((row) => row.item_id)).toEqual([suyo])
    expect(await priceOf(vino)).toBe(1_200_000)
    expect(await priceOf(suyo)).toBe(110_000)
  })

  it('entero o nada: una sucursal de otro bar frena todo el pedido', async () => {
    const pizza = await mkItem(tenantA.id, 'Pizza', 2_000_000)
    const { data, error } = await ownerA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(pizza, null, 2_000_000, 2_200_000), change(pizza, branchB, null, 5)],
      p_batch: true,
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('branch_not_found')
    // El precio de la carta venía bien en el mismo pedido, y tampoco se escribió.
    expect(await priceOf(pizza)).toBe(2_000_000)
    expect(await ownPriceOf(branchB, pizza)).toBeUndefined()
    expect(await historyOf(pizza)).toEqual([])
  })

  it('entero o nada: un precio imposible frena todo el pedido', async () => {
    const empanada = await mkItem(tenantA.id, 'Empanada', 150_000)
    const tarta = await mkItem(tenantA.id, 'Tarta', 600_000)
    const { error } = await ownerA.client.rpc('menu_apply_price_changes', {
      p_tenant_id: tenantA.id,
      p_changes: [change(empanada, null, 150_000, 165_000), change(tarta, null, 600_000, -1)],
    })
    expect(error?.message).toContain('invalid_changes')
    expect(await priceOf(empanada)).toBe(150_000)
    expect(await priceOf(tarta)).toBe(600_000)
  })

  it('el precio propio de una sucursal: se crea, se cambia y vuelve al de la carta', async () => {
    const trago = await mkItem(tenantA.id, 'Trago', 800_000)
    const call = (expected: number | null, price: number | null) =>
      ownerA.client.rpc('menu_apply_price_changes', {
        p_tenant_id: tenantA.id,
        p_changes: [change(trago, branchA, expected, price)],
      })

    expect((await call(null, 900_000)).error).toBeNull()
    expect(await ownPriceOf(branchA, trago)).toBe(900_000)

    // Con lo que se veía viejo no se pisa.
    const stale = await call(null, 1)
    expect((stale.data as Outcome).failed).toEqual([
      { item_id: trago, branch_id: branchA, reason: 'changed', current_cents: 900_000 },
    ])
    expect(await ownPriceOf(branchA, trago)).toBe(900_000)

    expect((await call(900_000, 950_000)).error).toBeNull()
    expect(await ownPriceOf(branchA, trago)).toBe(950_000)

    // Volver al precio de la carta: queda vacío, no se borra la fila.
    expect((await call(950_000, null)).error).toBeNull()
    expect(await ownPriceOf(branchA, trago)).toBeNull()

    const history = await historyOf(trago)
    expect(history.map((row) => [row.old_price_cents, row.new_price_cents])).toEqual([
      [null, 900_000],
      [900_000, 950_000],
      [950_000, null],
    ])
  })
})
