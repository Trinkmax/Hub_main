import { describe, expect, it } from 'vitest'
import { createCategorySchema, updateCategorySchema } from '@/lib/menu/schemas'

describe('createCategorySchema con image_url', () => {
  it('acepta sin image_url (=> null)', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).toBeNull()
  })

  it('normaliza string vacío a null', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres', image_url: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).toBeNull()
  })

  it('acepta una URL válida', () => {
    const r = createCategorySchema.safeParse({
      name: 'Postres',
      image_url: 'https://x.supabase.co/storage/v1/object/public/menu-images/t/abc.webp',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.image_url).not.toBeNull()
  })

  it('rechaza una URL no-URL', () => {
    const r = createCategorySchema.safeParse({ name: 'Postres', image_url: 'no-es-url' })
    expect(r.success).toBe(false)
  })
})

describe('updateCategorySchema con image_url', () => {
  it('acepta payload completo', () => {
    const r = updateCategorySchema.safeParse({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Postres',
      active: true,
      image_url: null,
    })
    expect(r.success).toBe(true)
  })
})
