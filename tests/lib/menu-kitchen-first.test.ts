// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  branchesWithMarks,
  categoryFirst,
  categoryFirstChange,
  categoryFirstNote,
  FIRST_DEPTH,
  firstHeadline,
  firstSay,
  firstStats,
  inheritedFirst,
  itemFirst,
  itemFirstChange,
  itemFirstNote,
} from '@/lib/menu/kitchen/first'
import { type CurrentFirst, planFirstWrites, type RequestedFirst } from '@/lib/menu/kitchen/plan'
import { cartaTree } from '@/lib/menu/kitchen/routing'
import { setKitchenFirstSchema } from '@/lib/menu/kitchen/schemas'
import type { CartaCategory, CartaItem } from '@/lib/menu/kitchen/types'
import {
  AGUA,
  BEBIDAS,
  CATEGORIES,
  CESAR,
  CLASICA,
  COMIDA,
  category,
  ENSALADAS,
  HAMBURGUESAS,
  ITEMS,
  id,
  MUZZA,
  PIZZA,
  POSTRES,
  WRAP,
} from './menu-kitchen-fixtures'

/**
 * «Sale primero»: la misma regla que la base (`private.pos_item_first`). Vale lo que diga el
 * producto; si no dice nada, que su categoría o alguna de las de arriba esté marcada.
 */

const mark = (
  categories: ReadonlyArray<CartaCategory>,
  marked: ReadonlyArray<string>,
): CartaCategory[] =>
  categories.map((each) => (marked.includes(each.id) ? { ...each, kitchenFirst: true } : each))
const say = (
  items: ReadonlyArray<CartaItem>,
  said: Readonly<Record<string, boolean>>,
): CartaItem[] =>
  items.map((each) => (each.id in said ? { ...each, kitchenFirst: said[each.id] ?? null } : each))
const itemById = (items: ReadonlyArray<CartaItem>, itemId: string): CartaItem => {
  const found = items.find((each) => each.id === itemId)
  if (!found) throw new Error(`falta ${itemId}`)
  return found
}

describe('la regla', () => {
  it('sin marcas, nada sale primero', () => {
    const tree = cartaTree(CATEGORIES, ITEMS)
    expect(categoryFirst(tree, COMIDA)).toEqual({ first: false, source: 'none', fromId: null })
    expect(itemFirst(tree, itemById(ITEMS, CLASICA)).first).toBe(false)
    expect(firstStats(tree).first).toBe(0)
  })

  it('una categoría marcada se lleva a sus productos y a sus subcategorías', () => {
    const tree = cartaTree(mark(CATEGORIES, [COMIDA]), ITEMS)
    expect(categoryFirst(tree, COMIDA)).toEqual({ first: true, source: 'own', fromId: null })
    expect(categoryFirst(tree, HAMBURGUESAS)).toEqual({
      first: true,
      source: 'inherited',
      fromId: COMIDA,
    })
    expect(itemFirst(tree, itemById(ITEMS, CLASICA))).toEqual({
      first: true,
      source: 'inherited',
      fromId: COMIDA,
    })
    // Lo de otra rama no.
    expect(categoryFirst(tree, BEBIDAS).first).toBe(false)
  })

  it('hereda de la marcada más cercana', () => {
    const tree = cartaTree(mark(CATEGORIES, [COMIDA, HAMBURGUESAS]), ITEMS)
    expect(inheritedFirst(tree, itemById(ITEMS, CLASICA))).toEqual({
      first: true,
      fromId: HAMBURGUESAS,
    })
    expect(categoryFirst(tree, HAMBURGUESAS).source).toBe('own')
  })

  it('lo que dice el producto pisa a su categoría, para un lado y para el otro', () => {
    const items = say(ITEMS, { [CLASICA]: false, [MUZZA]: true })
    const tree = cartaTree(mark(CATEGORIES, [HAMBURGUESAS]), items)
    expect(itemFirst(tree, itemById(items, CLASICA))).toEqual({
      first: false,
      source: 'own',
      fromId: null,
    })
    expect(itemFirst(tree, itemById(items, WRAP)).first).toBe(true)
    expect(itemFirst(tree, itemById(items, MUZZA))).toEqual({
      first: true,
      source: 'own',
      fromId: null,
    })
  })

  it('una categoría que no existe o un producto suelto no heredan nada', () => {
    const tree = cartaTree(mark(CATEGORIES, [COMIDA]), ITEMS)
    expect(categoryFirst(tree, id('c', 99)).first).toBe(false)
    expect(itemFirst(tree, { kitchenFirst: null, categoryId: null }).first).toBe(false)
    expect(itemFirst(tree, { kitchenFirst: null, categoryId: id('c', 99) }).first).toBe(false)
  })

  it('sube lo mismo que la base: la categoría del producto y doce más', () => {
    // Una escalera de 15: la de arriba de todo está marcada.
    const ladder = Array.from({ length: 15 }, (_, index) =>
      category({
        id: id('c', 100 + index),
        name: `Nivel ${index}`,
        parentId: index === 0 ? null : id('c', 100 + index - 1),
        kitchenFirst: index === 0,
      }),
    )
    const tree = cartaTree(ladder, [])
    const at = (level: number) => ({ kitchenFirst: null, categoryId: id('c', 100 + level) })
    // Producto en el nivel 12: su categoría + doce de arriba llegan al nivel 0.
    expect(FIRST_DEPTH).toBe(13)
    expect(itemFirst(tree, at(12)).first).toBe(true)
    expect(itemFirst(tree, at(13)).first).toBe(false)
    // La categoría del nivel 12 se ve como la ve un producto suyo.
    expect(categoryFirst(tree, id('c', 112)).first).toBe(true)
    expect(categoryFirst(tree, id('c', 113)).first).toBe(false)
  })

  it('un círculo de categorías no cuelga nada', () => {
    const loop = [
      category({ id: id('c', 201), name: 'A', parentId: id('c', 202) }),
      category({ id: id('c', 202), name: 'B', parentId: id('c', 201) }),
    ]
    const tree = cartaTree(loop, [])
    expect(categoryFirst(tree, id('c', 201)).first).toBe(false)
  })
})

describe('qué se guarda al tocar el interruptor', () => {
  it('un producto que con seguir a su categoría ya queda así, pierde su marca propia', () => {
    const tree = cartaTree(mark(CATEGORIES, [HAMBURGUESAS]), ITEMS)
    const clasica = itemById(ITEMS, CLASICA)
    // Ya sale primero por su categoría: prenderlo no cambia nada.
    expect(itemFirstChange(tree, clasica, true)).toBeNull()
    // Apagarlo necesita decirlo en el producto.
    expect(itemFirstChange(tree, clasica, false)).toEqual({ node: 'item', id: CLASICA, to: false })
    // Volver a prenderlo le saca la marca: vuelve a seguir a su categoría.
    expect(itemFirstChange(tree, { ...clasica, kitchenFirst: false }, true)).toEqual({
      node: 'item',
      id: CLASICA,
      to: null,
    })
  })

  it('un producto de una categoría sin marcar se marca él', () => {
    const tree = cartaTree(CATEGORIES, ITEMS)
    const muzza = itemById(ITEMS, MUZZA)
    expect(itemFirstChange(tree, muzza, true)).toEqual({ node: 'item', id: MUZZA, to: true })
    expect(itemFirstChange(tree, muzza, false)).toBeNull()
    expect(itemFirstChange(tree, { ...muzza, kitchenFirst: true }, false)).toEqual({
      node: 'item',
      id: MUZZA,
      to: null,
    })
  })

  it('una categoría: sí o no, y nada si ya está así', () => {
    const tree = cartaTree(mark(CATEGORIES, [PIZZA]), ITEMS)
    expect(categoryFirstChange(tree, PIZZA, true)).toBeNull()
    expect(categoryFirstChange(tree, PIZZA, false)).toEqual({
      node: 'category',
      id: PIZZA,
      to: false,
    })
    expect(categoryFirstChange(tree, HAMBURGUESAS, true)).toEqual({
      node: 'category',
      id: HAMBURGUESAS,
      to: true,
    })
    expect(categoryFirstChange(tree, id('c', 99), true)).toBeNull()
  })
})

describe('los números y las palabras', () => {
  it('cuenta por rama y en total; los productos sueltos no entran', () => {
    const items = say(ITEMS, { [CLASICA]: false, [AGUA]: true })
    const tree = cartaTree(mark(CATEGORIES, [HAMBURGUESAS, ENSALADAS]), items)
    const stats = firstStats(tree)
    // Hamburguesas: Clásica (dice que no) y Wrap (sí). Ensaladas: César (sí).
    expect(stats.byBranch.get(HAMBURGUESAS)).toEqual({ products: 2, first: 1 })
    expect(stats.byBranch.get(ENSALADAS)).toEqual({ products: 1, first: 1 })
    expect(stats.byBranch.get(COMIDA)).toEqual({ products: 4, first: 2 })
    expect(stats.first).toBe(2)
    // «Agua» no tiene categoría: el mozo no la puede pedir, la cocina no la ve.
    expect(stats.items.has(AGUA)).toBe(false)
    expect(stats.products).toBe(ITEMS.length - 1)
    expect(stats.items.get(CESAR)?.first).toBe(true)
  })

  it('el titular', () => {
    expect(firstHeadline({ first: 0 })).toEqual({ figure: 'Nada', lead: 'sale primero todavía' })
    expect(firstHeadline({ first: 1 })).toEqual({ figure: '1', lead: 'producto sale primero' })
    expect(firstHeadline({ first: 7 })).toEqual({ figure: '7', lead: 'productos salen primero' })
  })

  it('lo que se lee debajo de una categoría', () => {
    const items = say(ITEMS, { [CLASICA]: false })
    const tree = cartaTree(mark(CATEGORIES, [COMIDA]), items)
    const stats = firstStats(tree)
    expect(categoryFirstNote(tree, stats, COMIDA)).toBe('3 de sus 4 productos encabezan la comanda')
    expect(categoryFirstNote(tree, stats, HAMBURGUESAS)).toBe('Sale primero por Comida')
    expect(categoryFirstNote(tree, stats, BEBIDAS)).toBeNull()

    const all = cartaTree(mark(CATEGORIES, [PIZZA]), ITEMS)
    expect(categoryFirstNote(all, firstStats(all), PIZZA)).toBe('Su producto encabeza la comanda')
    // Una de arriba sin marcar, con algo marcado adentro.
    expect(categoryFirstNote(all, firstStats(all), COMIDA)).toBe('1 de 4 sale primero')
  })

  it('lo que se lee debajo de un producto', () => {
    const tree = cartaTree(mark(CATEGORIES, [HAMBURGUESAS]), ITEMS)
    const clasica = itemById(ITEMS, CLASICA)
    const muzza = itemById(ITEMS, MUZZA)
    expect(itemFirstNote(tree, clasica)).toBe('Sale primero por su categoría')
    expect(itemFirstNote(tree, { ...clasica, kitchenFirst: false })).toBe(
      'Este no, aunque su categoría sí',
    )
    expect(itemFirstNote(tree, { ...clasica, kitchenFirst: true })).toBe('Sale primero')
    expect(itemFirstNote(tree, { ...muzza, kitchenFirst: true })).toBe(
      'Sale primero: solo este producto',
    )
    expect(itemFirstNote(tree, muzza)).toBeNull()
    expect(itemFirstNote(tree, { ...muzza, kitchenFirst: false })).toBeNull()
  })

  it('el aviso de guardado', () => {
    expect(firstSay('Rabas', true)).toBe('Rabas sale primero')
    expect(firstSay('Rabas', false)).toBe('Rabas ya no sale primero')
  })

  it('al entrar se abren las ramas con algo marcado adentro, no las marcadas enteras', () => {
    const items = say(ITEMS, { [MUZZA]: true })
    const tree = cartaTree(mark(CATEGORIES, [POSTRES]), items)
    const open = branchesWithMarks(tree, firstStats(tree))
    expect(open).toEqual([COMIDA, PIZZA])
  })
})

describe('qué se escribe', () => {
  const current: CurrentFirst = {
    categories: new Map([
      [COMIDA, false],
      [PIZZA, true],
    ]),
    items: new Map<string, boolean | null>([
      [CLASICA, null],
      [MUZZA, false],
      [WRAP, true],
    ]),
  }
  const ask = (over: Partial<RequestedFirst> & { id: string }): RequestedFirst => ({
    node: 'item',
    to: true,
    expected: null,
    ...over,
  })

  it('agrupa por «de qué a qué»', () => {
    const plan = planFirstWrites(
      [
        ask({ node: 'category', id: COMIDA, to: true, expected: false }),
        ask({ id: CLASICA }),
        ask({ id: MUZZA, to: null, expected: false }),
      ],
      current,
    )
    expect(plan).toEqual({
      kind: 'write',
      writes: [
        { node: 'category', expected: false, to: true, ids: [COMIDA] },
        { node: 'item', expected: null, to: true, ids: [CLASICA] },
        { node: 'item', expected: false, to: null, ids: [MUZZA] },
      ],
    })
  })

  it('lo que ya está así no se escribe', () => {
    expect(planFirstWrites([ask({ id: WRAP, to: true, expected: false })], current)).toEqual({
      kind: 'noop',
    })
  })

  it('si alguien lo cambió recién, no se pisa: no se escribe ninguna', () => {
    const plan = planFirstWrites(
      [ask({ id: CLASICA }), ask({ id: MUZZA, to: true, expected: null })],
      current,
    )
    expect(plan).toEqual({ kind: 'changed', ids: [MUZZA] })
  })

  it('lo que ya no está en la carta frena todo', () => {
    expect(planFirstWrites([ask({ id: CLASICA }), ask({ id: id('e', 99) })], current)).toEqual({
      kind: 'missing',
      ids: [id('e', 99)],
    })
  })

  it('una categoría nunca se escribe vacía', () => {
    const plan = planFirstWrites(
      [{ node: 'category', id: PIZZA, to: null, expected: true }],
      current,
    )
    expect(plan).toEqual({
      kind: 'write',
      writes: [{ node: 'category', expected: true, to: false, ids: [PIZZA] }],
    })
  })
})

describe('el borde', () => {
  const change = { node: 'item', id: CLASICA, to: true, expected: null }
  it('acepta marcas de productos y de categorías', () => {
    expect(
      setKitchenFirstSchema.safeParse({
        changes: [change, { node: 'category', id: PIZZA, to: true, expected: false }],
      }).success,
    ).toBe(true)
  })

  it('rechaza una lista vacía, una marca repetida y una categoría sin decir', () => {
    expect(setKitchenFirstSchema.safeParse({ changes: [] }).success).toBe(false)
    expect(setKitchenFirstSchema.safeParse({ changes: [change, change] }).success).toBe(false)
    expect(
      setKitchenFirstSchema.safeParse({
        changes: [{ node: 'category', id: PIZZA, to: null, expected: true }],
      }).success,
    ).toBe(false)
    expect(
      setKitchenFirstSchema.safeParse({
        changes: [{ node: 'category', id: PIZZA, to: true, expected: null }],
      }).success,
    ).toBe(false)
    expect(
      setKitchenFirstSchema.safeParse({ changes: [{ ...change, id: 'no-es-un-id' }] }).success,
    ).toBe(false)
  })
})
