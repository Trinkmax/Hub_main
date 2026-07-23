import { describe, expect, it } from 'vitest'
import { bulkItemTagsSchema } from '@/lib/item-tags/schemas'
import { moveItemsSchema } from '@/lib/menu/schemas'

// UUIDs válidos (versión 4, variante 8) — zod v4 valida versión y variante.
const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'

describe('moveItemsSchema', () => {
  it('acepta una lista de ítems + categoría destino', () => {
    const r = moveItemsSchema.safeParse({
      item_ids: [UUID_A, UUID_B],
      target_category_id: UUID_C,
    })
    expect(r.success).toBe(true)
  })

  it('rechaza lista vacía de ítems', () => {
    const r = moveItemsSchema.safeParse({ item_ids: [], target_category_id: UUID_C })
    expect(r.success).toBe(false)
  })

  it('rechaza un item_id no-uuid', () => {
    const r = moveItemsSchema.safeParse({ item_ids: ['no-uuid'], target_category_id: UUID_C })
    expect(r.success).toBe(false)
  })

  it('rechaza categoría destino no-uuid', () => {
    const r = moveItemsSchema.safeParse({ item_ids: [UUID_A], target_category_id: 'x' })
    expect(r.success).toBe(false)
  })

  it('rechaza más de 1000 ítems', () => {
    const many = Array.from({ length: 1001 }, () => UUID_A)
    const r = moveItemsSchema.safeParse({ item_ids: many, target_category_id: UUID_C })
    expect(r.success).toBe(false)
  })
})

describe('bulkItemTagsSchema', () => {
  it('acepta ítems + tags', () => {
    const r = bulkItemTagsSchema.safeParse({ item_ids: [UUID_A], tag_ids: [UUID_B] })
    expect(r.success).toBe(true)
  })

  it('rechaza sin ítems', () => {
    const r = bulkItemTagsSchema.safeParse({ item_ids: [], tag_ids: [UUID_B] })
    expect(r.success).toBe(false)
  })

  it('rechaza sin tags (al menos una etiqueta requerida)', () => {
    const r = bulkItemTagsSchema.safeParse({ item_ids: [UUID_A], tag_ids: [] })
    expect(r.success).toBe(false)
  })

  it('rechaza más de 50 tags', () => {
    const many = Array.from({ length: 51 }, () => UUID_B)
    const r = bulkItemTagsSchema.safeParse({ item_ids: [UUID_A], tag_ids: many })
    expect(r.success).toBe(false)
  })
})
