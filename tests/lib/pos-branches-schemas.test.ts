// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  createBranchSchema,
  deleteBranchSchema,
  firstIssue,
  reorderBranchesSchema,
  setDefaultBranchSchema,
  updateBranchSchema,
} from '@/lib/pos/branches/schemas'

const ID = '6380c468-cf88-495c-a0f3-85e42279a355'
const OTHER = '6011ae59-1a30-4119-a45b-4152b1ba10ed'

describe('createBranchSchema', () => {
  it('alcanza con el nombre, que queda prolijo', () => {
    const parsed = createBranchSchema.parse({ name: '  Cerro   de las Rosas ' })
    expect(parsed).toEqual({ name: 'Cerro de las Rosas' })
  })

  it('un nombre vacío o de puros espacios dice qué hacer', () => {
    const parsed = createBranchSchema.safeParse({ name: '   ' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(firstIssue(parsed.error)).toBe('Ponele un nombre a la sucursal.')
  })

  it('el nombre entra en 60 letras', () => {
    expect(createBranchSchema.safeParse({ name: 'x'.repeat(60) }).success).toBe(true)
    const parsed = createBranchSchema.safeParse({ name: 'x'.repeat(61) })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(firstIssue(parsed.error)).toBe('El nombre entra en 60 letras.')
  })

  it('acepta un color que se lee con letra clara y lo deja en minúsculas', () => {
    expect(createBranchSchema.parse({ name: 'Cerro', color: '#A8452D' }).color).toBe('#a8452d')
  })

  it('rechaza un color que no se lee, y dice por qué', () => {
    const parsed = createBranchSchema.safeParse({ name: 'Cerro', color: '#f2c94c' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(firstIssue(parsed.error)).toContain('no se lee')
  })

  it('rechaza lo que no es un color', () => {
    expect(createBranchSchema.safeParse({ name: 'Cerro', color: 'rojo' }).success).toBe(false)
  })
})

describe('updateBranchSchema', () => {
  it('acepta cada dato con su forma', () => {
    const parsed = updateBranchSchema.parse({
      branchId: ID,
      changes: [
        { field: 'name', value: ' Cerro ', expected: 'Cero' },
        { field: 'shortName', value: '  ', expected: 'C.' },
        { field: 'color', value: '#2C4A7C', expected: '#a8452d' },
        { field: 'address', value: ' Av. Rafael Núñez  4000 ', expected: null },
        { field: 'active', value: false, expected: true },
      ],
    })
    expect(parsed.changes).toEqual([
      { field: 'name', value: 'Cerro', expected: 'Cero' },
      // Vacío se guarda como «sin dato».
      { field: 'shortName', value: null, expected: 'C.' },
      { field: 'color', value: '#2c4a7c', expected: '#a8452d' },
      { field: 'address', value: 'Av. Rafael Núñez 4000', expected: null },
      { field: 'active', value: false, expected: true },
    ])
  })

  it('el nombre corto entra en 14 letras', () => {
    const ok = updateBranchSchema.safeParse({
      branchId: ID,
      changes: [{ field: 'shortName', value: 'x'.repeat(14), expected: null }],
    })
    expect(ok.success).toBe(true)
    const long = updateBranchSchema.safeParse({
      branchId: ID,
      changes: [{ field: 'shortName', value: 'x'.repeat(15), expected: null }],
    })
    expect(long.success).toBe(false)
    if (!long.success) expect(firstIssue(long.error)).toBe('El nombre corto entra en 14 letras.')
  })

  it('lo que la persona veía no se valida: puede ser un valor viejo que hoy no pasaría', () => {
    const parsed = updateBranchSchema.safeParse({
      branchId: ID,
      changes: [{ field: 'color', value: '#2c4a7c', expected: '#ffee00' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('no acepta el mismo dato dos veces, ni un dato que no existe, ni ninguno', () => {
    const twice = updateBranchSchema.safeParse({
      branchId: ID,
      changes: [
        { field: 'name', value: 'A', expected: 'B' },
        { field: 'name', value: 'C', expected: 'B' },
      ],
    })
    expect(twice.success).toBe(false)
    expect(
      updateBranchSchema.safeParse({
        branchId: ID,
        changes: [{ field: 'slug', value: 'x', expected: 'y' }],
      }).success,
    ).toBe(false)
    expect(
      updateBranchSchema.safeParse({
        branchId: ID,
        changes: [{ field: 'is_default', value: true, expected: false }],
      }).success,
    ).toBe(false)
    expect(updateBranchSchema.safeParse({ branchId: ID, changes: [] }).success).toBe(false)
  })

  it('un pedido mal armado no tiene motivo para mostrar', () => {
    const parsed = updateBranchSchema.safeParse({ branchId: 'no-es-un-id', changes: [] })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(firstIssue(parsed.error)).toBeNull()
  })
})

describe('lo demás', () => {
  it('elegir la principal pide las dos sucursales', () => {
    expect(
      setDefaultBranchSchema.safeParse({ branchId: ID, expectedDefaultId: OTHER }).success,
    ).toBe(true)
    expect(setDefaultBranchSchema.safeParse({ branchId: ID }).success).toBe(false)
  })

  it('el orden no acepta repetidos ni una lista vacía', () => {
    expect(reorderBranchesSchema.safeParse({ order: [ID, OTHER] }).success).toBe(true)
    expect(reorderBranchesSchema.safeParse({ order: [ID, ID] }).success).toBe(false)
    expect(reorderBranchesSchema.safeParse({ order: [] }).success).toBe(false)
    expect(reorderBranchesSchema.safeParse({ order: ['x'] }).success).toBe(false)
  })

  it('borrar pide un id de verdad', () => {
    expect(deleteBranchSchema.safeParse({ branchId: ID }).success).toBe(true)
    expect(deleteBranchSchema.safeParse({ branchId: '1; drop table' }).success).toBe(false)
  })
})
