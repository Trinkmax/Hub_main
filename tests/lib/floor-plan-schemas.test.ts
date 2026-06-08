import { describe, expect, it } from 'vitest'
import {
  addDecorSchema,
  areaCanvasSchema,
  areaCreateSchema,
  areaRenameSchema,
  areaReorderSchema,
  createTableInPlanSchema,
  elementGeometrySchema,
  geometryBatchSchema,
  mergeTablesSchema,
  placeTableSchema,
  setTableActiveSchema,
  splitTableSchema,
  updateDecorSchema,
} from '@/lib/floor-plan/schemas'

const UUID = '00000000-0000-0000-0000-000000000000'

describe('createTableInPlanSchema', () => {
  it('acepta capacity null', () => {
    const r = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: 'Mesa 1',
      capacity: null,
      shape: 'rect',
      x: 0,
      y: 0,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.capacity).toBeNull()
  })

  it('aplica default shape=rect cuando falta', () => {
    const r = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: 'Mesa 1',
      capacity: 4,
      x: 0,
      y: 0,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.shape).toBe('rect')
  })

  it('rechaza capacity 0 y 51', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 0,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 51,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })

  it('acepta capacity 1 y 50 (bordes)', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 1,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(true)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'M',
        capacity: 50,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(true)
  })

  it('trimea el label y rechaza label vacío o >40', () => {
    const ok = createTableInPlanSchema.safeParse({
      area_id: UUID,
      label: '  Mesa 7  ',
      capacity: null,
      shape: 'rect',
      x: 0,
      y: 0,
    })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.label).toBe('Mesa 7')

    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: '   ',
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
    expect(
      createTableInPlanSchema.safeParse({
        area_id: UUID,
        label: 'a'.repeat(41),
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })

  it('rechaza area_id no-uuid', () => {
    expect(
      createTableInPlanSchema.safeParse({
        area_id: 'nope',
        label: 'M',
        capacity: null,
        shape: 'rect',
        x: 0,
        y: 0,
      }).success,
    ).toBe(false)
  })
})

describe('areaCreateSchema', () => {
  it('aplica default number_start=1', () => {
    const r = areaCreateSchema.safeParse({ name: 'Salón' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.number_start).toBe(1)
  })

  it('rechaza name vacío y >40', () => {
    expect(areaCreateSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(areaCreateSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false)
  })
})

describe('areaRenameSchema', () => {
  it('exige id uuid + name', () => {
    expect(areaRenameSchema.safeParse({ id: UUID, name: 'PB' }).success).toBe(true)
    expect(areaRenameSchema.safeParse({ id: 'x', name: 'PB' }).success).toBe(false)
  })
})

describe('areaCanvasSchema', () => {
  it('acepta width/height/number_start dentro de límites', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: 1 }).success,
    ).toBe(true)
  })

  it('acepta los bordes 200 y 6000', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 200, height: 6000, number_start: 0 }).success,
    ).toBe(true)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 6000, height: 200, number_start: 100000 })
        .success,
    ).toBe(true)
  })

  it('rechaza width < 200 o > 6000', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 199, height: 800, number_start: 1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 6001, height: 800, number_start: 1 }).success,
    ).toBe(false)
  })

  it('rechaza height fuera de [200,6000]', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 199, number_start: 1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 6001, number_start: 1 }).success,
    ).toBe(false)
  })

  it('rechaza number_start fuera de [0,100000]', () => {
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: -1 }).success,
    ).toBe(false)
    expect(
      areaCanvasSchema.safeParse({ id: UUID, width: 1200, height: 800, number_start: 100001 })
        .success,
    ).toBe(false)
  })
})

describe('areaReorderSchema', () => {
  it('exige al menos un uuid', () => {
    expect(areaReorderSchema.safeParse({ ids: [UUID] }).success).toBe(true)
    expect(areaReorderSchema.safeParse({ ids: [] }).success).toBe(false)
    expect(areaReorderSchema.safeParse({ ids: ['nope'] }).success).toBe(false)
  })
})

describe('elementGeometrySchema', () => {
  // Base válida con los campos v2 (rotation + corner_radius requeridos).
  const base = {
    id: UUID,
    x: 100,
    y: 200,
    width: 80,
    height: 80,
    rotation: 0,
    corner_radius: 0,
    z_index: 10,
  }

  it('acepta una geometría válida', () => {
    expect(elementGeometrySchema.safeParse(base).success).toBe(true)
  })

  it('acepta x/y en los bordes ±10000', () => {
    expect(elementGeometrySchema.safeParse({ ...base, x: -10000, y: 10000 }).success).toBe(true)
  })

  it('rechaza x/y fuera de ±10000', () => {
    expect(elementGeometrySchema.safeParse({ ...base, x: -10001 }).success).toBe(false)
    expect(elementGeometrySchema.safeParse({ ...base, y: 10001 }).success).toBe(false)
  })

  it('rechaza width/height fuera de [8,6000]', () => {
    expect(elementGeometrySchema.safeParse({ ...base, width: 7 }).success).toBe(false)
    expect(elementGeometrySchema.safeParse({ ...base, height: 6001 }).success).toBe(false)
  })

  it('rechaza x no-entero', () => {
    expect(elementGeometrySchema.safeParse({ ...base, x: 1.5 }).success).toBe(false)
  })

  it('acepta rotation 0..359 y rechaza fuera de rango', () => {
    expect(elementGeometrySchema.safeParse({ ...base, rotation: 359 }).success).toBe(true)
    expect(elementGeometrySchema.safeParse({ ...base, rotation: 360 }).success).toBe(false)
    expect(elementGeometrySchema.safeParse({ ...base, rotation: -1 }).success).toBe(false)
  })

  it('acepta corner_radius 0..200 y rechaza fuera de rango', () => {
    expect(elementGeometrySchema.safeParse({ ...base, corner_radius: 200 }).success).toBe(true)
    expect(elementGeometrySchema.safeParse({ ...base, corner_radius: 201 }).success).toBe(false)
  })

  it('rechaza si falta rotation o corner_radius', () => {
    const { rotation, ...noRotation } = base
    const { corner_radius, ...noCorner } = base
    expect(elementGeometrySchema.safeParse(noRotation).success).toBe(false)
    expect(elementGeometrySchema.safeParse(noCorner).success).toBe(false)
  })
})

describe('geometryBatchSchema', () => {
  const geom = {
    id: UUID,
    x: 0,
    y: 0,
    width: 80,
    height: 80,
    rotation: 0,
    corner_radius: 0,
    z_index: 0,
  }

  it('acepta entre 1 y 500 items', () => {
    expect(geometryBatchSchema.safeParse({ items: [geom] }).success).toBe(true)
    expect(
      geometryBatchSchema.safeParse({ items: Array.from({ length: 500 }, () => geom) }).success,
    ).toBe(true)
  })

  it('rechaza lista vacía', () => {
    expect(geometryBatchSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('rechaza más de 500 items', () => {
    expect(
      geometryBatchSchema.safeParse({ items: Array.from({ length: 501 }, () => geom) }).success,
    ).toBe(false)
  })
})

describe('addDecorSchema', () => {
  const base = {
    area_id: UUID,
    kind: 'wall' as const,
    shape: 'rect' as const,
    x: 0,
    y: 0,
    width: 200,
    height: 16,
  }

  it('acepta decor válida sin label/color', () => {
    expect(addDecorSchema.safeParse(base).success).toBe(true)
  })

  it('rechaza kind=table (decor enum no lo incluye)', () => {
    expect(addDecorSchema.safeParse({ ...base, kind: 'table' }).success).toBe(false)
  })

  it('rechaza color con regex inválida (#abc)', () => {
    expect(addDecorSchema.safeParse({ ...base, color: '#abc' }).success).toBe(false)
  })

  it('acepta color de 6 dígitos (#aabbcc)', () => {
    const r = addDecorSchema.safeParse({ ...base, color: '#aabbcc' })
    expect(r.success).toBe(true)
  })

  it('acepta color null', () => {
    expect(addDecorSchema.safeParse({ ...base, color: null }).success).toBe(true)
  })

  it('rechaza width/height fuera de [8,6000]', () => {
    expect(addDecorSchema.safeParse({ ...base, width: 7 }).success).toBe(false)
    expect(addDecorSchema.safeParse({ ...base, height: 6001 }).success).toBe(false)
  })
})

describe('updateDecorSchema', () => {
  it('acepta solo id (label/color opcionales)', () => {
    expect(updateDecorSchema.safeParse({ id: UUID }).success).toBe(true)
  })

  it('rechaza color inválido', () => {
    expect(updateDecorSchema.safeParse({ id: UUID, color: '#abc' }).success).toBe(false)
  })
})

describe('placeTableSchema / splitTableSchema / mergeTablesSchema / setTableActiveSchema', () => {
  it('placeTableSchema valida ids enteros', () => {
    expect(
      placeTableSchema.safeParse({ table_id: UUID, area_id: UUID, x: 10, y: 20 }).success,
    ).toBe(true)
    expect(
      placeTableSchema.safeParse({ table_id: UUID, area_id: UUID, x: 1.2, y: 0 }).success,
    ).toBe(false)
  })

  it('splitTableSchema exige source_element_id uuid', () => {
    expect(splitTableSchema.safeParse({ source_element_id: UUID }).success).toBe(true)
    expect(splitTableSchema.safeParse({ source_element_id: 'x' }).success).toBe(false)
  })

  it('mergeTablesSchema exige ambos ids', () => {
    expect(
      mergeTablesSchema.safeParse({ survivor_table_id: UUID, absorbed_table_id: UUID }).success,
    ).toBe(true)
    expect(mergeTablesSchema.safeParse({ survivor_table_id: UUID }).success).toBe(false)
  })

  it('setTableActiveSchema exige boolean', () => {
    expect(setTableActiveSchema.safeParse({ table_id: UUID, active: true }).success).toBe(true)
    expect(setTableActiveSchema.safeParse({ table_id: UUID, active: 'x' }).success).toBe(false)
  })
})
