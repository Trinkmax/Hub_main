import { describe, expect, it } from 'vitest'
import { createAndAssignTagSchema } from '@/lib/customers/schemas'

const customer_id = 'a1b2c3d4-e5f6-4a7b-8c9d-1e2f3a4b5c6d'

describe('createAndAssignTagSchema', () => {
  it('acepta un nombre válido y aplica el color por defecto', () => {
    const result = createAndAssignTagSchema.safeParse({ customer_id, name: 'VIP' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.color).toBe('#94a3b8')
  })

  it('recorta espacios del nombre', () => {
    const result = createAndAssignTagSchema.safeParse({ customer_id, name: '  Frecuente  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Frecuente')
  })

  it('acepta un color hex válido', () => {
    const result = createAndAssignTagSchema.safeParse({ customer_id, name: 'X', color: '#ff8800' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.color).toBe('#ff8800')
  })

  it('rechaza un nombre vacío', () => {
    expect(createAndAssignTagSchema.safeParse({ customer_id, name: '   ' }).success).toBe(false)
  })

  it('rechaza un nombre demasiado largo', () => {
    const long = 'a'.repeat(41)
    expect(createAndAssignTagSchema.safeParse({ customer_id, name: long }).success).toBe(false)
  })

  it('rechaza un color inválido', () => {
    expect(
      createAndAssignTagSchema.safeParse({ customer_id, name: 'X', color: 'red' }).success,
    ).toBe(false)
  })

  it('rechaza un customer_id que no es UUID', () => {
    expect(createAndAssignTagSchema.safeParse({ customer_id: 'nope', name: 'X' }).success).toBe(
      false,
    )
  })
})
