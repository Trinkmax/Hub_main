import { describe, expect, it } from 'vitest'
import { createTemplateSchema } from '@/lib/meta/template-schemas'

const base = { name: 'bienvenida_hub', language: 'es_AR', category: 'MARKETING' as const }

describe('createTemplateSchema', () => {
  it('acepta un cuerpo sin variables', () => {
    expect(createTemplateSchema.safeParse({ ...base, bodyText: 'Gracias por venir' }).success).toBe(
      true,
    )
  })

  it('rechaza variables en el cuerpo sin ejemplos (el trap que rompía la creación)', () => {
    expect(createTemplateSchema.safeParse({ ...base, bodyText: 'Hola {{1}}' }).success).toBe(false)
  })

  it('acepta variables con la cantidad exacta de ejemplos', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Hola {{1}}, código {{2}}',
      bodyExamples: ['Ana', 'X5'],
    })
    expect(result.success).toBe(true)
  })

  it('rechaza variables con huecos ({{1}} y {{3}})', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Hola {{1}} y {{3}}',
      bodyExamples: ['a', 'b'],
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un header con variable sin ejemplo', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Cuerpo',
      headerText: '¡Hola {{1}}!',
    })
    expect(result.success).toBe(false)
  })

  it('acepta un header con variable y ejemplo', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Cuerpo',
      headerText: '¡Hola {{1}}!',
      headerExample: 'Ana',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un footer con variables', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Cuerpo',
      footerText: 'Chau {{1}}',
    })
    expect(result.success).toBe(false)
  })

  it('aplica el texto de opt-out por defecto', () => {
    const result = createTemplateSchema.safeParse({ ...base, bodyText: 'Cuerpo', optOut: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.optOutLabel).toBe('No recibir promociones')
  })

  it('rechaza un botón URL con texto pero sin url', () => {
    const result = createTemplateSchema.safeParse({
      ...base,
      bodyText: 'Cuerpo',
      urlButtonText: 'Ver más',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un nombre con mayúsculas o espacios', () => {
    expect(
      createTemplateSchema.safeParse({ ...base, name: 'Bienvenida Hub', bodyText: 'Cuerpo' })
        .success,
    ).toBe(false)
  })
})
