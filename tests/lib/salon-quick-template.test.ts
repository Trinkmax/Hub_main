import { describe, expect, it } from 'vitest'
import { quickTemplateSchema } from '@/lib/salon/schemas'

describe('quickTemplateSchema', () => {
  it('camino feliz con todos los campos', () => {
    const r = quickTemplateSchema.safeParse({
      name: 'Pizza Libre',
      default_capacity: 40,
      default_meal_type: 'dinner',
      color_hex: '#0ea5e9',
    })
    expect(r.success).toBe(true)
  })

  it('default_meal_type y color por defecto', () => {
    const r = quickTemplateSchema.safeParse({ name: 'Ramen' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.default_meal_type).toBe('dinner')
      expect(r.data.color_hex).toBe('#7c3aed')
      expect(r.data.default_capacity).toBeNull()
    }
  })

  it('capacity vacío → null', () => {
    const r = quickTemplateSchema.safeParse({ name: 'Ramen', default_capacity: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.default_capacity).toBeNull()
  })

  it('nombre vacío → error', () => {
    const r = quickTemplateSchema.safeParse({ name: '   ' })
    expect(r.success).toBe(false)
  })

  it('color inválido → error', () => {
    const r = quickTemplateSchema.safeParse({ name: 'X', color_hex: 'rojo' })
    expect(r.success).toBe(false)
  })
})
