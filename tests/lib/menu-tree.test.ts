import { describe, expect, it } from 'vitest'
import type { MenuCategory, MenuItem } from '@/lib/menu/queries'
import {
  buildCategoryTree,
  categoryPath,
  categoryPathLabel,
  flattenForPicker,
} from '@/lib/menu/tree'

function cat(id: string, parent_id: string | null, position: number, name = id): MenuCategory {
  return { id, name, position, active: true, image_url: null, parent_id }
}
function item(id: string, category_id: string, position: number): MenuItem {
  return {
    id,
    category_id,
    name: id,
    description: null,
    price_cents: 100,
    points_override: null,
    position,
    active: true,
    image_url: null,
    video_url: null,
    featured: false,
    tags: [],
  }
}

describe('buildCategoryTree', () => {
  it('anida por parent_id y adjunta ítems directos, ordenado por position', () => {
    const cats = [cat('vinos', 'bebidas', 1), cat('bebidas', null, 2), cat('comidas', null, 1)]
    const items = [item('malbec', 'vinos', 1), item('agua', 'bebidas', 1)]
    const tree = buildCategoryTree(cats, items)

    expect(tree.map((n) => n.id)).toEqual(['comidas', 'bebidas'])
    const bebidas = tree.find((n) => n.id === 'bebidas')
    expect(bebidas?.items.map((i) => i.id)).toEqual(['agua'])
    expect(bebidas?.children.map((c) => c.id)).toEqual(['vinos'])
    expect(bebidas?.children[0]?.items.map((i) => i.id)).toEqual(['malbec'])
  })

  it('ignora ítems con category_id nulo o sin categoría existente', () => {
    const cats = [cat('a', null, 1)]
    const items = [
      item('x', 'a', 1),
      { ...item('y', 'a', 2), category_id: null as unknown as string },
    ]
    const tree = buildCategoryTree(cats, items)
    expect(tree[0]?.items.map((i) => i.id)).toEqual(['x'])
  })
})

describe('categoryPath / categoryPathLabel', () => {
  it('devuelve ancestros desde la raíz hasta la categoría', () => {
    const cats = [cat('vinos', 'bebidas', 1, 'Vinos'), cat('bebidas', null, 1, 'Bebidas')]
    expect(categoryPath(cats, 'vinos').map((c) => c.id)).toEqual(['bebidas', 'vinos'])
    expect(categoryPathLabel(cats, 'vinos')).toBe('Bebidas › Vinos')
  })
})

describe('flattenForPicker', () => {
  it('aplana con depth y excluye un subárbol (para mover sin ciclo)', () => {
    const cats = [
      cat('bebidas', null, 1, 'Bebidas'),
      cat('vinos', 'bebidas', 1, 'Vinos'),
      cat('comidas', null, 2, 'Comidas'),
    ]
    const all = flattenForPicker(cats)
    expect(all.map((c) => `${c.depth}:${c.id}`)).toEqual(['0:bebidas', '1:vinos', '0:comidas'])

    const exclBebidas = flattenForPicker(cats, 'bebidas')
    expect(exclBebidas.map((c) => c.id)).toEqual(['comidas'])
  })
})
