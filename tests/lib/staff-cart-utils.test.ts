import { describe, expect, it } from 'vitest'
import {
  buildCartLines,
  cartItemCount,
  cartTotalCents,
  indexMenuItems,
  type StaffCartEntry,
} from '@/lib/sessions-waiter/staff-cart-utils'
import type { StaffMenuCategory } from '@/lib/sessions-waiter/staff-menu-queries'

const sampleMenu: StaffMenuCategory[] = [
  {
    id: 'cat-1',
    name: 'Cafetería',
    position: 0,
    parent_id: null,
    path: 'Cafetería',
    items: [
      {
        id: 'item-cafe',
        name: 'Café',
        description: null,
        price_cents: 80000,
        image_url: null,
        position: 0,
      },
      {
        id: 'item-medialuna',
        name: 'Medialuna',
        description: null,
        price_cents: 50000,
        image_url: null,
        position: 1,
      },
    ],
  },
  {
    id: 'cat-2',
    name: 'Bebidas',
    position: 1,
    parent_id: null,
    path: 'Bebidas',
    items: [
      {
        id: 'item-agua',
        name: 'Agua',
        description: 'Botella 500ml',
        price_cents: 60000,
        image_url: null,
        position: 0,
      },
    ],
  },
]

describe('indexMenuItems', () => {
  it('aplana categorías en un Map id→item', () => {
    const map = indexMenuItems(sampleMenu)
    expect(map.size).toBe(3)
    expect(map.get('item-cafe')?.name).toBe('Café')
    expect(map.get('item-agua')?.price_cents).toBe(60000)
  })

  it('menú vacío devuelve Map vacío', () => {
    expect(indexMenuItems([]).size).toBe(0)
  })
})

describe('buildCartLines', () => {
  const itemsById = indexMenuItems(sampleMenu)

  it('enriquece cada entry con name, unitPriceCents y lineTotalCents', () => {
    const cart: StaffCartEntry[] = [
      { menuItemId: 'item-cafe', quantity: 2, notes: null },
      { menuItemId: 'item-medialuna', quantity: 3, notes: 'sin azúcar' },
    ]
    const lines = buildCartLines(cart, itemsById)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      menuItemId: 'item-cafe',
      name: 'Café',
      quantity: 2,
      unitPriceCents: 80000,
      lineTotalCents: 160000,
    })
    expect(lines[1]?.notes).toBe('sin azúcar')
    expect(lines[1]?.lineTotalCents).toBe(150000)
  })

  it('descarta entries cuyo menuItemId no está en el menú actual', () => {
    const cart: StaffCartEntry[] = [
      { menuItemId: 'item-cafe', quantity: 1, notes: null },
      { menuItemId: 'item-fantasma', quantity: 99, notes: null },
    ]
    const lines = buildCartLines(cart, itemsById)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.menuItemId).toBe('item-cafe')
  })

  it('cart vacío devuelve []', () => {
    expect(buildCartLines([], itemsById)).toEqual([])
  })
})

describe('cartTotalCents', () => {
  it('suma todos los lineTotalCents', () => {
    const lines = buildCartLines(
      [
        { menuItemId: 'item-cafe', quantity: 2, notes: null }, // 160000
        { menuItemId: 'item-agua', quantity: 1, notes: null }, // 60000
      ],
      indexMenuItems(sampleMenu),
    )
    expect(cartTotalCents(lines)).toBe(220000)
  })

  it('vacío = 0', () => {
    expect(cartTotalCents([])).toBe(0)
  })
})

describe('cartItemCount', () => {
  it('suma las quantities', () => {
    const cart: StaffCartEntry[] = [
      { menuItemId: 'a', quantity: 3, notes: null },
      { menuItemId: 'b', quantity: 5, notes: null },
    ]
    expect(cartItemCount(cart)).toBe(8)
  })

  it('vacío = 0', () => {
    expect(cartItemCount([])).toBe(0)
  })
})
