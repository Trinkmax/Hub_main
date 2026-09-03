import { describe, expect, it } from 'vitest'
import {
  marketingTaskCreateSchema,
  marketingTaskUpdateSchema,
  routineCheckSchema,
  routineUpsertSchema,
} from '@/lib/marketing/schemas'

// uuid v4 real: `z.uuid()` de zod 4 valida versión y variante, no sólo la forma.
const UUID = '11111111-2222-4333-8444-555555555555'

/** Lo mínimo válido, tal como llega del FormData del diálogo. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Grabar el reel del sushi',
    category: 'eventos',
    kind: 'shoot',
    status: 'todo',
    specifications: '',
    notes: '',
    file_url: '',
    responsible_user_id: '',
    involved_user_id: '',
    ideal_date: '',
    defined_date: '',
    ...overrides,
  }
}

describe('marketingTaskCreateSchema', () => {
  it('normaliza a null todo lo opcional que llega vacío del form', () => {
    const parsed = marketingTaskCreateSchema.parse(form())
    expect(parsed.specifications).toBeNull()
    expect(parsed.notes).toBeNull()
    expect(parsed.file_url).toBeNull()
    expect(parsed.responsible_user_id).toBeNull()
    expect(parsed.involved_user_id).toBeNull()
    expect(parsed.ideal_date).toBeNull()
    expect(parsed.defined_date).toBeNull()
  })

  it('también acepta que el campo directamente no venga (null/undefined)', () => {
    const parsed = marketingTaskCreateSchema.parse(
      form({ specifications: null, notes: undefined, ideal_date: null }),
    )
    expect(parsed.specifications).toBeNull()
    expect(parsed.notes).toBeNull()
    expect(parsed.ideal_date).toBeNull()
  })

  it('recorta los espacios en vez de guardar " " como si fuera texto', () => {
    const parsed = marketingTaskCreateSchema.parse(
      form({ title: '  Diseñar el flyer  ', specifications: '   ' }),
    )
    expect(parsed.title).toBe('Diseñar el flyer')
    expect(parsed.specifications).toBeNull()
  })

  it('exige un título', () => {
    expect(marketingTaskCreateSchema.safeParse(form({ title: '   ' })).success).toBe(false)
  })

  it('rechaza títulos larguísimos', () => {
    expect(marketingTaskCreateSchema.safeParse(form({ title: 'x'.repeat(161) })).success).toBe(
      false,
    )
  })

  it('valida la sección, el tipo y el estado contra los enums de la DB', () => {
    expect(marketingTaskCreateSchema.safeParse(form({ category: 'organico' })).success).toBe(false)
    expect(marketingTaskCreateSchema.safeParse(form({ kind: 'inventado' })).success).toBe(false)
    expect(marketingTaskCreateSchema.safeParse(form({ status: 'Terminado' })).success).toBe(false)
  })

  it('el link del archivo sólo puede ser http/https (nada de javascript:)', () => {
    expect(
      marketingTaskCreateSchema.safeParse(form({ file_url: 'javascript:alert(1)' })).success,
    ).toBe(false)
    expect(
      marketingTaskCreateSchema.safeParse(form({ file_url: 'drive.google.com' })).success,
    ).toBe(false)
    const ok = marketingTaskCreateSchema.parse(form({ file_url: 'https://drive.google.com/x' }))
    expect(ok.file_url).toBe('https://drive.google.com/x')
  })

  it('las personas son uuid o nada', () => {
    expect(
      marketingTaskCreateSchema.safeParse(form({ responsible_user_id: 'nacho' })).success,
    ).toBe(false)
    const ok = marketingTaskCreateSchema.parse(form({ responsible_user_id: UUID }))
    expect(ok.responsible_user_id).toBe(UUID)
  })

  it('las fechas viajan como yyyy-MM-dd', () => {
    expect(marketingTaskCreateSchema.safeParse(form({ defined_date: '03/09/2026' })).success).toBe(
      false,
    )
    const ok = marketingTaskCreateSchema.parse(form({ defined_date: '2026-09-03' }))
    expect(ok.defined_date).toBe('2026-09-03')
  })

  it('el update pide el id', () => {
    expect(marketingTaskUpdateSchema.safeParse(form()).success).toBe(false)
    expect(marketingTaskUpdateSchema.safeParse({ ...form(), id: UUID }).success).toBe(true)
  })
})

describe('routineUpsertSchema', () => {
  it('el cupo semanal es un entero de 1 a 14', () => {
    expect(routineUpsertSchema.parse({ title: 'Reels', description: '', slots: '3' }).slots).toBe(3)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '0' }).success,
    ).toBe(false)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '15' }).success,
    ).toBe(false)
    expect(
      routineUpsertSchema.safeParse({ title: 'Reels', description: '', slots: '2.5' }).success,
    ).toBe(false)
  })

  it('sin id es alta, con id es edición', () => {
    // El form manda siempre todas las claves; `id` sólo existe al editar y
    // `formData.get('id')` devuelve null cuando el hidden no está.
    const alta = routineUpsertSchema.parse({ id: null, title: 'Reels', description: '', slots: 1 })
    expect(alta.id).toBeNull()
    const edicion = routineUpsertSchema.parse({
      id: UUID,
      title: 'Reels',
      description: '',
      slots: 1,
    })
    expect(edicion.id).toBe(UUID)
  })
})

describe('routineCheckSchema', () => {
  it('el slot es 0-based y no puede salirse del máximo de la tabla', () => {
    expect(
      routineCheckSchema.parse({
        routine_id: UUID,
        week_start: '2026-08-31',
        slot: '0',
        done: true,
      }).slot,
    ).toBe(0)
    expect(
      routineCheckSchema.safeParse({
        routine_id: UUID,
        week_start: '2026-08-31',
        slot: 14,
        done: true,
      }).success,
    ).toBe(false)
  })

  it('la semana tiene que ser una fecha ISO', () => {
    expect(
      routineCheckSchema.safeParse({
        routine_id: UUID,
        week_start: 'esta',
        slot: 0,
        done: true,
      }).success,
    ).toBe(false)
  })
})
