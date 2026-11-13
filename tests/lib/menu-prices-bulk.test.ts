// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  adjustPrice,
  type BulkPoint,
  type BulkScope,
  bulkButtonLabel,
  bulkChanges,
  bulkDoneSentence,
  bulkPoints,
  computeBulk,
  parsePercentInput,
  percentText,
  SCOPE_ALL,
  scopeCategoryIds,
  scopeCounts,
  scopeMark,
  summarizeBulk,
  toggleScope,
} from '@/lib/menu/prices/bulk'
import {
  ancestorsOf,
  categoryPath,
  categoryTree,
  descendantsOf,
  itemCategoryId,
  NO_CATEGORY_ID,
} from '@/lib/menu/prices/tree'
import type { BranchOverride, PriceCategory, PriceItem } from '@/lib/menu/prices/types'
import { NBSP } from '@/lib/money'

/**
 * «Aumentar precios»: a qué productos, cuánto y con qué redondeo. Lo que muestra la vista
 * previa es exactamente lo que después se escribe.
 */

const pesos = (n: number) => n * 100

const cat = (
  id: string,
  parentId: string | null,
  position: number,
  active = true,
): PriceCategory => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  parentId,
  position,
  active,
})

const CATEGORIES: PriceCategory[] = [
  cat('postres', null, 3),
  cat('bebidas', null, 2),
  cat('comida', null, 1),
  cat('pizza', 'comida', 2),
  cat('hamburguesas', 'comida', 1),
  cat('especiales', 'pizza', 1),
  cat('vinos', 'bebidas', 2),
  cat('tragos', 'bebidas', 1),
]
const TREE = categoryTree(CATEGORIES)

const item = (id: string, categoryId: string | null, price: number, position = 1): PriceItem => ({
  id,
  name: id,
  categoryId,
  priceCents: pesos(price),
  position,
  active: true,
})

const ITEMS: PriceItem[] = [
  item('cheese', 'hamburguesas', 15_500, 1),
  item('bacon', 'hamburguesas', 17_500, 2),
  item('muzza', 'pizza', 12_000, 1),
  item('especial', 'especiales', 30_000, 1),
  item('fernet', 'tragos', 7_000, 1),
  item('malbec', 'vinos', 16_000, 1),
  item('flan', 'postres', 7_000, 1),
  item('suelto', null, 1_500, 1),
]

describe('el árbol de categorías', () => {
  it('recorre a la madre y enseguida a todo lo que cuelga, en el orden de la carta', () => {
    expect(TREE.order).toEqual([
      'comida',
      'hamburguesas',
      'pizza',
      'especiales',
      'bebidas',
      'tragos',
      'vinos',
      'postres',
    ])
  })

  it('sabe qué cuelga de quién y de quién cuelga cada una', () => {
    expect(descendantsOf(TREE, 'comida')).toEqual(['comida', 'hamburguesas', 'pizza', 'especiales'])
    expect(descendantsOf(TREE, 'postres')).toEqual(['postres'])
    expect(ancestorsOf(TREE, 'especiales')).toEqual(['comida', 'pizza'])
    expect(ancestorsOf(TREE, 'comida')).toEqual([])
  })

  it('arma el camino y avisa si alguna de arriba está pausada', () => {
    expect(categoryPath(TREE, 'especiales')).toEqual({
      ancestors: ['Comida', 'Pizza'],
      name: 'Especiales',
      label: 'Comida › Pizza › Especiales',
      active: true,
    })
    const paused = categoryTree([cat('comida', null, 1, false), cat('pizza', 'comida', 1)])
    expect(categoryPath(paused, 'pizza').active).toBe(false)
  })

  it('una categoría con la madre borrada pasa a ser de arriba de todo', () => {
    const tree = categoryTree([cat('huerfana', 'no-existe', 1)])
    expect(tree.order).toEqual(['huerfana'])
    expect(ancestorsOf(tree, 'huerfana')).toEqual([])
  })

  it('un ciclo no cuelga nada ni pierde categorías', () => {
    const tree = categoryTree([cat('a', 'b', 1), cat('b', 'a', 2)])
    expect([...tree.order].sort()).toEqual(['a', 'b'])
    expect(descendantsOf(tree, 'a').sort()).toEqual(['a', 'b'])
    expect(ancestorsOf(tree, 'a')).toEqual(['b'])
  })

  it('un producto sin categoría (o con una que ya no existe) va a «sin categoría»', () => {
    expect(itemCategoryId(TREE, { categoryId: null })).toBe(NO_CATEGORY_ID)
    expect(itemCategoryId(TREE, { categoryId: 'borrada' })).toBe(NO_CATEGORY_ID)
    expect(itemCategoryId(TREE, { categoryId: 'pizza' })).toBe('pizza')
  })
})

describe('a qué productos', () => {
  const counts = (scope: BulkScope) => scopeCounts(TREE, scope, ITEMS)
  const toggle = (scope: BulkScope, id: string) => toggleScope(TREE, scope, id, counts(scope))

  it('«toda la carta» no filtra por categoría', () => {
    expect(scopeCategoryIds(SCOPE_ALL)).toBeNull()
    expect(counts(SCOPE_ALL).get('comida')).toEqual({ total: 4, picked: 4 })
  })

  it('desde «toda la carta», tocar una categoría elige solo esa', () => {
    expect(toggle(SCOPE_ALL, 'postres')).toEqual({ kind: 'categories', ids: ['postres'] })
  })

  it('elegir una madre incluye a sus hijas y a las hijas de sus hijas', () => {
    const scope = toggle(SCOPE_ALL, 'comida')
    expect(scope).toEqual({
      kind: 'categories',
      ids: ['comida', 'hamburguesas', 'pizza', 'especiales'],
    })
    expect(scopeMark(counts(scope).get('comida'))).toBe('on')
    expect(scopeMark(counts(scope).get('pizza'))).toBe('on')
    expect(scopeMark(counts(scope).get('bebidas'))).toBe('off')
  })

  it('sacar una hija deja a la madre «en parte», sin perder lo que la madre tiene directo', () => {
    const scope = toggle(toggle(SCOPE_ALL, 'comida'), 'especiales')
    expect(scope).toEqual({ kind: 'categories', ids: ['comida', 'hamburguesas', 'pizza'] })
    expect(counts(scope).get('comida')).toEqual({ total: 4, picked: 3 })
    expect(scopeMark(counts(scope).get('comida'))).toBe('partial')
    // «Pizza» tiene una pizza propia (muzza) y una hija afuera: también en parte.
    expect(scopeMark(counts(scope).get('pizza'))).toBe('partial')
    expect(scopeMark(counts(scope).get('hamburguesas'))).toBe('on')
  })

  it('tocar una que está «en parte» la completa; tocarla entera la saca con todo', () => {
    const partial = toggle(toggle(SCOPE_ALL, 'comida'), 'especiales')
    const full = toggle(partial, 'comida')
    expect(scopeMark(counts(full).get('comida'))).toBe('on')
    expect(toggle(full, 'comida')).toEqual({ kind: 'categories', ids: [] })
  })

  it('elegir todas las hijas de una madre sin productos propios la deja entera', () => {
    const scope = toggle(toggle(SCOPE_ALL, 'tragos'), 'vinos')
    expect(scopeMark(counts(scope).get('bebidas'))).toBe('on')
    // Y como se ve entera, tocarla la saca (no la «vuelve a elegir»).
    expect(toggle(scope, 'bebidas')).toEqual({ kind: 'categories', ids: [] })
  })

  it('«sin categoría» se elige como una más', () => {
    const scope = toggle(SCOPE_ALL, NO_CATEGORY_ID)
    expect(scope).toEqual({ kind: 'categories', ids: [NO_CATEGORY_ID] })
    expect(counts(scope).get(NO_CATEGORY_ID)).toEqual({ total: 1, picked: 1 })
  })
})

describe('parsePercentInput y percentText', () => {
  it('lee el porcentaje con coma, con punto, con signo y con %', () => {
    expect(parsePercentInput('10')).toBe(1_000)
    expect(parsePercentInput('7,5')).toBe(750)
    expect(parsePercentInput('7.25')).toBe(725)
    expect(parsePercentInput(' 12 % ')).toBe(1_200)
    expect(parsePercentInput('-5')).toBe(-500)
    expect(parsePercentInput('−5')).toBe(-500)
    expect(parsePercentInput('+3')).toBe(300)
  })

  it('no acepta cero, letras, más de dos decimales ni lo que se va de rango', () => {
    expect(parsePercentInput('0')).toBeNull()
    expect(parsePercentInput('')).toBeNull()
    expect(parsePercentInput('diez')).toBeNull()
    expect(parsePercentInput('1,234')).toBeNull()
    expect(parsePercentInput('501')).toBeNull()
    expect(parsePercentInput('-91')).toBeNull()
    expect(parsePercentInput('500')).toBe(50_000)
    expect(parsePercentInput('-90')).toBe(-9_000)
  })

  it('lo escribe sin signo y con coma', () => {
    expect(percentText(1_000)).toBe(`10${NBSP}%`)
    expect(percentText(750)).toBe(`7,5${NBSP}%`)
    expect(percentText(725)).toBe(`7,25${NBSP}%`)
    expect(percentText(705)).toBe(`7,05${NBSP}%`)
    expect(percentText(-500)).toBe(`5${NBSP}%`)
  })
})

describe('adjustPrice', () => {
  it('aplica el porcentaje y redondea al múltiplo más cercano', () => {
    expect(adjustPrice(pesos(12_500), 1_000, 10_000)).toBe(pesos(13_800)) // 13.750 → 13.800
    expect(adjustPrice(pesos(12_500), 1_000, 50_000)).toBe(pesos(14_000)) // 13.750 → 14.000
    expect(adjustPrice(pesos(12_500), 1_000, 100_000)).toBe(pesos(14_000))
    expect(adjustPrice(pesos(12_500), 1_000, 5_000)).toBe(pesos(13_750))
    expect(adjustPrice(pesos(12_400), 1_000, 10_000)).toBe(pesos(13_600)) // 13.640 → 13.600
  })

  it('sin redondear queda al peso, nunca con centavos', () => {
    expect(adjustPrice(pesos(12_550), 1_000, 0)).toBe(pesos(13_805))
    expect(adjustPrice(pesos(1_555), 750, 0)).toBe(pesos(1_672)) // 1.671,625 → 1.672
    expect(adjustPrice(123_450, 1_000, 0)).toBe(135_800) // $ 1.234,50 + 10 % = 1.357,95 → $ 1.358
  })

  it('la mitad redondea para arriba', () => {
    expect(adjustPrice(pesos(1_500), 1_000, 10_000)).toBe(pesos(1_700)) // 1.650 → 1.700
    expect(adjustPrice(pesos(1_000), 500, 10_000)).toBe(pesos(1_100)) // 1.050 → 1.100
  })

  it('también baja', () => {
    expect(adjustPrice(pesos(12_500), -1_000, 10_000)).toBe(pesos(11_300)) // 11.250 → 11.300
    expect(adjustPrice(pesos(10_000), -5_000, 0)).toBe(pesos(5_000))
  })

  it('nunca deja un precio en $ 0', () => {
    // $ 400 − 90 % = $ 40 → al múltiplo de $ 50 más cercano ($ 50), no a $ 0… pero ojo:
    expect(adjustPrice(pesos(400), -9_000, 5_000)).toBe(pesos(50))
    // $ 20 − 50 % = $ 10 → redondeado a $ 50 daría más que hoy: una baja no sube, queda igual.
    expect(adjustPrice(pesos(20), -5_000, 5_000)).toBe(pesos(20))
    // $ 1 − 90 % = 10 centavos → queda en $ 1.
    expect(adjustPrice(pesos(1), -9_000, 0)).toBe(pesos(1))
  })

  it('un aumento nunca baja un precio que no era múltiplo del redondeo', () => {
    // $ 12.740 + 1 % = 12.867 → a $ 500 daría 13.000 (sube: bien).
    expect(adjustPrice(pesos(12_740), 100, 50_000)).toBe(pesos(13_000))
    // $ 12.240 + 1 % = 12.362 → a $ 500 daría 12.500 (sube: bien).
    expect(adjustPrice(pesos(12_240), 100, 50_000)).toBe(pesos(12_500))
    // $ 12.200 + 1 % = 12.322 → a $ 1.000 daría 12.000 (baja): queda como estaba.
    expect(adjustPrice(pesos(12_200), 100, 100_000)).toBe(pesos(12_200))
    // Y al revés: una baja que por el redondeo subiría, queda como estaba.
    expect(adjustPrice(pesos(12_800), -100, 100_000)).toBe(pesos(12_800))
  })

  it('lo que cuesta $ 0 sigue en $ 0 y un porcentaje de cero no cambia nada', () => {
    expect(adjustPrice(0, 1_000, 10_000)).toBe(0)
    expect(adjustPrice(pesos(12_500), 0, 10_000)).toBe(pesos(12_500))
  })

  it('no pierde exactitud con precios enormes', () => {
    expect(adjustPrice(1_000_000_000_000, 1_000, 0)).toBe(1_100_000_000_000)
    expect(adjustPrice(999_999_999_900, 50_000, 0)).toBe(5_999_999_999_400)
  })
})

describe('bulkPoints y computeBulk', () => {
  const overrides: BranchOverride[] = [
    { branchId: 'cerro', itemId: 'bacon', priceCents: pesos(19_000), available: true },
    { branchId: 'cerro', itemId: 'flan', priceCents: null, available: false },
    { branchId: 'cerro', itemId: 'malbec', priceCents: null, available: true },
    { branchId: 'centro', itemId: 'cheese', priceCents: pesos(16_000), available: true },
  ]
  const points = (over: Partial<Parameters<typeof bulkPoints>[0]> = {}) =>
    bulkPoints({
      tree: TREE,
      items: ITEMS,
      overrides,
      scope: SCOPE_ALL,
      view: null,
      includeOwnPrices: false,
      ...over,
    })

  it('en «toda la carta» toma el precio de la carta de cada producto', () => {
    const list = points()
    expect(list).toHaveLength(ITEMS.length)
    expect(list.every((point) => point.branchId === null)).toBe(true)
    expect(list.find((point) => point.itemId === 'bacon')).toMatchObject({
      currentCents: pesos(17_500),
      baseCents: pesos(17_500),
    })
  })

  it('con «también los precios propios» suma los de cada sucursal', () => {
    const list = points({ includeOwnPrices: true })
    const own = list.filter((point) => point.branchId !== null)
    expect(own.map((point) => `${point.branchId}:${point.itemId}`).sort()).toEqual([
      'centro:cheese',
      'cerro:bacon',
    ])
    expect(own.find((point) => point.itemId === 'bacon')).toMatchObject({
      currentCents: pesos(19_000),
      baseCents: pesos(19_000),
    })
  })

  it('por categorías solo entran los productos de las elegidas', () => {
    const scope: BulkScope = { kind: 'categories', ids: ['hamburguesas', 'postres'] }
    expect(points({ scope }).map((point) => point.itemId)).toEqual(['cheese', 'bacon', 'flan'])
    // Y de los precios propios, solo los de esos productos.
    const own = points({ scope: { kind: 'categories', ids: ['postres'] }, includeOwnPrices: true })
    expect(own.map((point) => point.itemId)).toEqual(['flan'])
  })

  it('en una sucursal parte de lo que se cobra ahí y saltea lo que ahí no se vende', () => {
    const list = points({ view: 'cerro' })
    expect(list.find((point) => point.itemId === 'flan')).toBeUndefined()
    expect(list.find((point) => point.itemId === 'bacon')).toEqual({
      itemId: 'bacon',
      name: 'bacon',
      branchId: 'cerro',
      currentCents: pesos(19_000),
      baseCents: pesos(19_000),
    })
    // Sin precio propio: parte del de la carta y hoy no tiene nada escrito.
    expect(list.find((point) => point.itemId === 'cheese')).toMatchObject({
      branchId: 'cerro',
      currentCents: null,
      baseCents: pesos(15_500),
    })
  })

  it('separa lo que cambia de lo que queda igual', () => {
    const list: BulkPoint[] = [
      {
        itemId: 'a',
        name: 'a',
        branchId: null,
        currentCents: pesos(12_500),
        baseCents: pesos(12_500),
      },
      { itemId: 'b', name: 'b', branchId: null, currentCents: pesos(200), baseCents: pesos(200) },
      { itemId: 'c', name: 'c', branchId: null, currentCents: 0, baseCents: 0 },
    ]
    // + 10 % a $ 500: $ 200 → 220 → al múltiplo más cercano es $ 0… que nunca: $ 500.
    const result = computeBulk(list, 1_000, 50_000)
    expect(result.changed.map((line) => [line.itemId, line.toCents])).toEqual([
      ['a', pesos(14_000)],
      ['b', pesos(500)],
    ])
    expect(result.unchanged.map((line) => line.itemId)).toEqual(['c'])
  })

  it('lo que se manda a guardar va de lo escrito hoy a lo nuevo', () => {
    const result = computeBulk(points({ view: 'cerro' }), 1_000, 10_000)
    const changes = bulkChanges(result.changed)
    expect(changes.find((change) => change.itemId === 'cheese')).toEqual({
      itemId: 'cheese',
      branchId: 'cerro',
      fromCents: null, // no tenía precio propio
      toCents: pesos(17_100), // 15.500 + 10 % = 17.050 → 17.100
    })
    expect(changes.find((change) => change.itemId === 'bacon')).toEqual({
      itemId: 'bacon',
      branchId: 'cerro',
      fromCents: pesos(19_000),
      toCents: pesos(20_900),
    })
  })

  it('en una sucursal, lo que queda igual que la carta no pasa a tener precio propio', () => {
    const list: BulkPoint[] = [
      { itemId: 'a', name: 'a', branchId: 'cerro', currentCents: null, baseCents: pesos(100) },
    ]
    // $ 100 + 10 % = 110 → a $ 100 queda en 100: no cambia, no se escribe nada.
    const result = computeBulk(list, 1_000, 10_000)
    expect(result.changed).toEqual([])
    expect(result.unchanged).toHaveLength(1)
  })
})

describe('summarizeBulk', () => {
  const many: BulkPoint[] = Array.from({ length: 20 }, (_, index) => ({
    itemId: `p${index}`,
    name: `Producto ${index}`,
    branchId: null,
    currentCents: pesos((index + 1) * 1_000),
    baseCents: pesos((index + 1) * 1_000),
  }))

  it('cuenta productos, y da el que menos y el que más cambia', () => {
    const summary = summarizeBulk(computeBulk(many, 1_000, 0))
    expect(summary.productCount).toBe(20)
    expect(summary.unchangedCount).toBe(0)
    expect(summary.ownPriceCount).toBe(0)
    expect(summary.smallest).toMatchObject({ itemId: 'p0', toCents: pesos(1_100) })
    expect(summary.largest).toMatchObject({ itemId: 'p19', toCents: pesos(22_000) })
  })

  it('da cuatro ejemplos repartidos entre lo barato y lo caro, sin repetir los extremos', () => {
    const summary = summarizeBulk(computeBulk(many, 1_000, 0))
    expect(summary.examples).toHaveLength(4)
    const ids = summary.examples.map((line) => line.itemId)
    expect(ids).not.toContain('p0')
    expect(ids).not.toContain('p19')
    const prices = summary.examples.map((line) => line.baseCents)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(4)
  })

  it('con pocos productos los muestra todos', () => {
    const summary = summarizeBulk(computeBulk(many.slice(0, 3), 1_000, 0))
    expect(summary.examples.map((line) => line.itemId)).toEqual(['p0', 'p1', 'p2'])
  })

  it('cuenta lo que queda igual y no lo mezcla con lo que cambia', () => {
    const list: BulkPoint[] = [
      {
        itemId: 'a',
        name: 'a',
        branchId: null,
        currentCents: pesos(12_500),
        baseCents: pesos(12_500),
      },
      { itemId: 'gratis', name: 'gratis', branchId: null, currentCents: 0, baseCents: 0 },
    ]
    const summary = summarizeBulk(computeBulk(list, 1_000, 10_000))
    expect(summary.productCount).toBe(1)
    expect(summary.unchangedCount).toBe(1)
  })

  it('los precios propios se cuentan aparte y los ejemplos salen de la carta', () => {
    const list: BulkPoint[] = [
      {
        itemId: 'a',
        name: 'a',
        branchId: null,
        currentCents: pesos(10_000),
        baseCents: pesos(10_000),
      },
      {
        itemId: 'a',
        name: 'a',
        branchId: 'cerro',
        currentCents: pesos(12_000),
        baseCents: pesos(12_000),
      },
      {
        itemId: 'b',
        name: 'b',
        branchId: null,
        currentCents: pesos(20_000),
        baseCents: pesos(20_000),
      },
    ]
    const summary = summarizeBulk(computeBulk(list, 1_000, 0))
    expect(summary.productCount).toBe(2)
    expect(summary.ownPriceCount).toBe(1)
    expect(summary.examples.every((line) => line.branchId === null)).toBe(true)
  })

  it('sin nada que cambiar no inventa ejemplos', () => {
    const summary = summarizeBulk(computeBulk([], 1_000, 0))
    expect(summary).toEqual({
      productCount: 0,
      ownPriceCount: 0,
      unchangedCount: 0,
      examples: [],
      smallest: null,
      largest: null,
    })
  })
})

describe('cómo se dice', () => {
  it('el botón dice exactamente lo que va a pasar', () => {
    expect(bulkButtonLabel({ count: 46, percentBp: 1_000 })).toBe(
      `Aumentar 46 productos un 10${NBSP}%`,
    )
    expect(bulkButtonLabel({ count: 1, percentBp: 750 })).toBe(`Aumentar 1 producto un 7,5${NBSP}%`)
    expect(bulkButtonLabel({ count: 12, percentBp: -500 })).toBe(`Bajar 12 productos un 5${NBSP}%`)
    expect(bulkButtonLabel({ count: 46, percentBp: 1_000, branchName: 'Cerro' })).toBe(
      `Aumentar 46 productos un 10${NBSP}% en Cerro`,
    )
  })

  it('después dice lo que pasó, y si no salieron todos, cuántos', () => {
    expect(bulkDoneSentence({ applied: 46, requested: 46, percentBp: 1_000 })).toBe(
      `Aumentaste 46 productos un 10${NBSP}%`,
    )
    expect(bulkDoneSentence({ applied: 44, requested: 46, percentBp: 1_000 })).toBe(
      `Aumentaste 44 de 46 productos un 10${NBSP}%`,
    )
    expect(
      bulkDoneSentence({ applied: 1, requested: 1, percentBp: -2_000, branchName: 'Cerro' }),
    ).toBe(`Bajaste 1 producto un 20${NBSP}% en Cerro`)
  })
})
