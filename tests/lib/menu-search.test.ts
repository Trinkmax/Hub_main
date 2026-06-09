import { describe, expect, it } from 'vitest'
import type { ActiveSessionStateData } from '@/lib/m-session/actions'
import { searchMenuItems } from '@/lib/m-session/menu-search'

type Category = ActiveSessionStateData['menu'][number]
type Item = Category['items'][number]

function item(partial: Partial<Item> & { id: string; name: string }): Item {
  return {
    description: null,
    price_cents: 1000,
    image_url: null,
    position: 0,
    featured: false,
    points_override: null,
    tags: [],
    ...partial,
  }
}

function cat(id: string, items: Item[], parentId: string | null = null): Category {
  return { id, name: id, position: 0, parent_id: parentId, image_url: null, items }
}

const MENU: Category[] = [
  cat('cafe', [item({ id: '1', name: 'Flat White' }), item({ id: '2', name: 'Cortado' })]),
  cat('comer', [
    item({ id: '3', name: 'Hamburguesa', description: 'con cheddar' }),
    item({ id: '4', name: 'Milanesa' }),
  ]),
]

describe('searchMenuItems', () => {
  it('devuelve [] con query vacía', () => {
    expect(searchMenuItems(MENU, '')).toEqual([])
    expect(searchMenuItems(MENU, '   ')).toEqual([])
  })

  it('matchea por nombre, case-insensitive, a través de categorías', () => {
    const r = searchMenuItems(MENU, 'mila')
    expect(r.map((i) => i.id)).toEqual(['4'])
  })

  it('matchea por descripción', () => {
    const r = searchMenuItems(MENU, 'cheddar')
    expect(r.map((i) => i.id)).toEqual(['3'])
  })

  it('devuelve varios resultados aplanados', () => {
    const r = searchMenuItems(MENU, 'a')
    expect(r.length).toBeGreaterThan(1)
  })

  it('sin matches devuelve []', () => {
    expect(searchMenuItems(MENU, 'zzz')).toEqual([])
  })

  it('encuentra ítems en subcategorías (estructura anidada plana)', () => {
    const nested: Category[] = [
      cat('bebidas', []),
      cat('vinos', [item({ id: 'malbec', name: 'Malbec' })], 'bebidas'),
    ]
    const r = searchMenuItems(nested, 'malbec')
    expect(r.map((i) => i.id)).toEqual(['malbec'])
  })
})
