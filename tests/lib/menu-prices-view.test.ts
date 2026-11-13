// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { categoryTree, NO_CATEGORY_ID } from '@/lib/menu/prices/tree'
import {
  type BranchOverride,
  type PriceCategory,
  type PriceItem,
  pointKey,
} from '@/lib/menu/prices/types'
import {
  buildGroups,
  buildPriceBook,
  draftDropToken,
  draftSettleAvailability,
  draftSettlePrices,
  draftStartAvailability,
  draftStartPrices,
  draftSync,
  EMPTY_DRAFT,
  liveItems,
  priceRange,
  rowPrice,
} from '@/lib/menu/prices/view'

/**
 * Lo que se ve en «Precios»: qué se cobra en cada lugar (la carta o el precio propio de una
 * sucursal) y el borrador de lo que se acaba de cambiar, encima de lo último leído de la base.
 */

const item = (
  id: string,
  categoryId: string | null,
  priceCents: number,
  position = 1,
): PriceItem => ({
  id,
  name: id,
  categoryId,
  priceCents,
  position,
  active: true,
})

const ITEMS = [item('bacon', 'hamburguesas', 1_250_000), item('cafe', 'cafeteria', 380_000)]
const OVERRIDES: BranchOverride[] = [
  { branchId: 'cerro', itemId: 'bacon', priceCents: 1_400_000, available: true },
  { branchId: 'cerro', itemId: 'cafe', priceCents: null, available: false },
]
const SNAPSHOT = { items: ITEMS, overrides: OVERRIDES }
const bacon = ITEMS[0] as PriceItem
const cafe = ITEMS[1] as PriceItem

describe('el precio según dónde se mire', () => {
  const book = buildPriceBook(SNAPSHOT, EMPTY_DRAFT)

  it('en «toda la carta» vale el precio de la carta y todo se vende', () => {
    expect(rowPrice(book, bacon, null)).toEqual({
      effectiveCents: 1_250_000,
      menuCents: 1_250_000,
      ownCents: null,
      available: true,
    })
  })

  it('en una sucursal manda su precio propio, si lo tiene', () => {
    expect(rowPrice(book, bacon, 'cerro')).toEqual({
      effectiveCents: 1_400_000,
      menuCents: 1_250_000,
      ownCents: 1_400_000,
      available: true,
    })
  })

  it('sin precio propio sigue la carta, y dice si ahí se vende', () => {
    expect(rowPrice(book, cafe, 'cerro')).toEqual({
      effectiveCents: 380_000,
      menuCents: 380_000,
      ownCents: null,
      available: false,
    })
  })

  it('una sucursal sin nada cargado para ese producto vale la carta', () => {
    expect(rowPrice(book, bacon, 'centro')).toEqual({
      effectiveCents: 1_250_000,
      menuCents: 1_250_000,
      ownCents: null,
      available: true,
    })
  })
})

describe('el borrador de precios', () => {
  it('lo que se acaba de cambiar se ve ya, marcado como guardándose', () => {
    const draft = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    const book = buildPriceBook(SNAPSHOT, draft)
    expect(rowPrice(book, bacon, null).effectiveCents).toBe(1_390_000)
    expect(book.saving.has(pointKey(null, 'bacon'))).toBe(true)
    // En la sucursal que tiene precio propio no cambia nada.
    expect(rowPrice(book, bacon, 'cerro').effectiveCents).toBe(1_400_000)
    // Y los productos «al día» llevan el precio nuevo.
    expect(liveItems(ITEMS, book).find((entry) => entry.id === 'bacon')?.priceCents).toBe(1_390_000)
  })

  it('un precio propio nuevo aparece aunque no hubiera fila, y respeta «se vende acá»', () => {
    const draft = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'cafe', branchId: 'cerro', fromCents: null, toCents: 450_000 },
      { itemId: 'bacon', branchId: 'centro', fromCents: null, toCents: 1_300_000 },
    ])
    const book = buildPriceBook(SNAPSHOT, draft)
    expect(rowPrice(book, cafe, 'cerro')).toMatchObject({ ownCents: 450_000, available: false })
    expect(rowPrice(book, bacon, 'centro')).toMatchObject({ ownCents: 1_300_000, available: true })
  })

  it('volver al precio de la carta borra el precio propio en la pantalla', () => {
    const draft = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: 'cerro', fromCents: 1_400_000, toCents: null },
    ])
    expect(rowPrice(buildPriceBook(SNAPSHOT, draft), bacon, 'cerro')).toMatchObject({
      effectiveCents: 1_250_000,
      ownCents: null,
    })
  })

  it('cuando el servidor contesta que guardó, deja de estar guardándose y sigue encima', () => {
    const started = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    const settled = draftSettlePrices(started, 1, { savedAt: 200, loadedAt: 100, failed: [] })
    const book = buildPriceBook(SNAPSHOT, settled)
    expect(book.saving.size).toBe(0)
    expect(rowPrice(book, bacon, null).effectiveCents).toBe(1_390_000)
  })

  it('si la lectura que hay en pantalla ya es posterior al guardado, el borrador sobra', () => {
    const started = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    expect(draftSettlePrices(started, 1, { savedAt: 200, loadedAt: 250, failed: [] })).toEqual(
      EMPTY_DRAFT,
    )
  })

  it('un guardado que falla vuelve a mostrar lo que hay en la base', () => {
    const started = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
      { itemId: 'cafe', branchId: null, fromCents: 380_000, toCents: 420_000 },
    ])
    const settled = draftSettlePrices(started, 1, {
      savedAt: 200,
      loadedAt: 100,
      failed: [{ itemId: 'bacon', branchId: null, reason: 'error' }],
    })
    const book = buildPriceBook(SNAPSHOT, settled)
    expect(rowPrice(book, bacon, null).effectiveCents).toBe(1_250_000)
    expect(rowPrice(book, cafe, null).effectiveCents).toBe(420_000)
  })

  it('si alguien lo cambió antes, se muestra lo que vale ahora (no lo que se quiso poner)', () => {
    const started = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    const settled = draftSettlePrices(started, 1, {
      savedAt: 200,
      loadedAt: 100,
      failed: [{ itemId: 'bacon', branchId: null, reason: 'changed', currentCents: 1_300_000 }],
    })
    expect(rowPrice(buildPriceBook(SNAPSHOT, settled), bacon, null).effectiveCents).toBe(1_300_000)
  })

  it('si el pedido entero falla, todo lo de ese pedido vuelve a lo leído', () => {
    const first = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    const both = draftStartPrices(first, 2, [
      { itemId: 'cafe', branchId: null, fromCents: 380_000, toCents: 420_000 },
    ])
    const dropped = draftDropToken(both, 2)
    const book = buildPriceBook(SNAPSHOT, dropped)
    expect(rowPrice(book, bacon, null).effectiveCents).toBe(1_390_000)
    expect(rowPrice(book, cafe, null).effectiveCents).toBe(380_000)
  })

  it('un cambio posterior sobre el mismo precio no lo pisa la respuesta del anterior', () => {
    const first = draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ])
    const second = draftStartPrices(first, 2, [
      { itemId: 'bacon', branchId: null, fromCents: 1_390_000, toCents: 1_450_000 },
    ])
    const settled = draftSettlePrices(second, 1, { savedAt: 200, loadedAt: 100, failed: [] })
    const book = buildPriceBook(SNAPSHOT, settled)
    expect(rowPrice(book, bacon, null).effectiveCents).toBe(1_450_000)
    expect(book.saving.has(pointKey(null, 'bacon'))).toBe(true)
  })
})

describe('cuando llega una lectura nueva de la base', () => {
  const saved = draftSettlePrices(
    draftStartPrices(EMPTY_DRAFT, 1, [
      { itemId: 'bacon', branchId: null, fromCents: 1_250_000, toCents: 1_390_000 },
    ]),
    1,
    { savedAt: 200, loadedAt: 100, failed: [] },
  )

  it('lo guardado antes de esa lectura se descarta: la base manda', () => {
    expect(draftSync(saved, 200)).toEqual(EMPTY_DRAFT)
    expect(draftSync(saved, 999)).toEqual(EMPTY_DRAFT)
  })

  it('una lectura anterior al guardado no lo borra', () => {
    expect(draftSync(saved, 150)).toBe(saved)
  })

  it('lo que todavía se está guardando se queda encima', () => {
    const saving = draftStartPrices(EMPTY_DRAFT, 7, [
      { itemId: 'cafe', branchId: null, fromCents: 380_000, toCents: 420_000 },
    ])
    expect(draftSync(saving, 999_999)).toBe(saving)
  })
})

describe('el borrador de «se vende acá»', () => {
  it('se ve al instante y conserva el precio propio', () => {
    const draft = draftStartAvailability(EMPTY_DRAFT, 1, {
      branchId: 'cerro',
      itemIds: ['bacon'],
      available: false,
    })
    const book = buildPriceBook(SNAPSHOT, draft)
    expect(rowPrice(book, bacon, 'cerro')).toMatchObject({ available: false, ownCents: 1_400_000 })
    expect(book.saving.has(pointKey('cerro', 'bacon'))).toBe(true)
  })

  it('al guardarse deja de estar pendiente; si falla, vuelve a lo leído', () => {
    const draft = draftStartAvailability(EMPTY_DRAFT, 1, {
      branchId: 'cerro',
      itemIds: ['bacon', 'cafe'],
      available: false,
    })
    const settled = draftSettleAvailability(draft, 1, { savedAt: 200, loadedAt: 100 })
    expect(buildPriceBook(SNAPSHOT, settled).saving.size).toBe(0)
    expect(draftSettleAvailability(draft, 1, { savedAt: 200, loadedAt: 300 })).toEqual(EMPTY_DRAFT)
    expect(draftDropToken(draft, 1)).toEqual(EMPTY_DRAFT)
  })
})

describe('los grupos de la lista', () => {
  const cat = (
    id: string,
    parentId: string | null,
    position: number,
    active = true,
  ): PriceCategory => ({
    id,
    name: id,
    parentId,
    position,
    active,
  })
  const tree = categoryTree([
    cat('bebidas', null, 2),
    cat('comida', null, 1),
    cat('pizza', 'comida', 2),
    cat('hamburguesas', 'comida', 1),
    cat('vinos', 'bebidas', 1, false),
  ])
  const items = [
    item('malbec', 'vinos', 1_600_000, 1),
    item('napo', 'pizza', 1_300_000, 2),
    item('muzza', 'pizza', 1_200_000, 1),
    item('bacon', 'hamburguesas', 1_750_000, 1),
    item('agua', 'bebidas', 300_000, 1),
    item('suelto', null, 150_000, 1),
    item('huerfano', 'categoria-borrada', 100_000, 2),
  ]
  const groups = buildGroups(tree, items)

  it('van en el orden de la carta y solo las categorías con productos propios', () => {
    expect(groups.map((group) => group.id)).toEqual([
      'hamburguesas',
      'pizza',
      'bebidas',
      'vinos',
      NO_CATEGORY_ID,
    ])
  })

  it('cada grupo trae su camino y sus productos ordenados', () => {
    const pizza = groups.find((group) => group.id === 'pizza')
    expect(pizza).toMatchObject({
      name: 'pizza',
      ancestors: ['comida'],
      pathLabel: 'comida › pizza',
    })
    expect(pizza?.items.map((entry) => entry.id)).toEqual(['muzza', 'napo'])
  })

  it('marca la categoría pausada', () => {
    expect(groups.find((group) => group.id === 'vinos')?.active).toBe(false)
    expect(groups.find((group) => group.id === 'pizza')?.active).toBe(true)
  })

  it('lo que quedó sin categoría va al final, en su grupo', () => {
    const loose = groups[groups.length - 1]
    expect(loose).toMatchObject({ id: NO_CATEGORY_ID, name: 'Sin categoría' })
    expect(loose?.items.map((entry) => entry.id)).toEqual(['suelto', 'huerfano'])
  })

  it('dice de cuánto a cuánto van los precios', () => {
    expect(priceRange([1_200_000, 1_300_000, 900_000])).toEqual({ min: 900_000, max: 1_300_000 })
    expect(priceRange([])).toBeNull()
  })
})
