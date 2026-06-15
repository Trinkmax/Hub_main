import { describe, expect, it } from 'vitest'
import { createTemplateSchema, deleteTemplateSchema } from '@/lib/meta/template-schemas'

describe('createTemplateSchema', () => {
  const valid = {
    name: 'bienvenida_nuevo_cliente',
    language: 'es',
    category: 'MARKETING' as const,
    bodyText: 'Hola {{1}}, bienvenido a HUB!',
  }

  it('accepts a valid minimal input', () => {
    const result = createTemplateSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('accepts optional header and footer', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headerText: 'Encabezado de prueba',
      footerText: 'Responder STOP para darse de baja',
    })
    expect(result.success).toBe(true)
  })

  it('rejects name with uppercase letters', () => {
    const result = createTemplateSchema.safeParse({ ...valid, name: 'Bienvenida' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/minúsculas/)
    }
  })

  it('rejects name with spaces', () => {
    const result = createTemplateSchema.safeParse({ ...valid, name: 'bienvenida cliente' })
    expect(result.success).toBe(false)
  })

  it('rejects name with hyphens (only underscores allowed)', () => {
    const result = createTemplateSchema.safeParse({ ...valid, name: 'bienvenida-cliente' })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createTemplateSchema.safeParse({ ...valid, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects empty bodyText', () => {
    const result = createTemplateSchema.safeParse({ ...valid, bodyText: '' })
    expect(result.success).toBe(false)
  })

  it('rejects bodyText exceeding 1024 characters', () => {
    const result = createTemplateSchema.safeParse({ ...valid, bodyText: 'a'.repeat(1025) })
    expect(result.success).toBe(false)
  })

  it('accepts bodyText of exactly 1024 characters', () => {
    const result = createTemplateSchema.safeParse({ ...valid, bodyText: 'a'.repeat(1024) })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid category', () => {
    const result = createTemplateSchema.safeParse({ ...valid, category: 'SPAM' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Categoría inválida/)
    }
  })

  it('accepts all valid categories', () => {
    for (const category of ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const) {
      const result = createTemplateSchema.safeParse({ ...valid, category })
      expect(result.success).toBe(true)
    }
  })

  it('rejects headerText exceeding 60 characters', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headerText: 'a'.repeat(61),
    })
    expect(result.success).toBe(false)
  })

  it('rejects footerText exceeding 60 characters', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      footerText: 'a'.repeat(61),
    })
    expect(result.success).toBe(false)
  })
})

describe('deleteTemplateSchema', () => {
  const validDelete = {
    name: 'bienvenida_nuevo_cliente',
    channel_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  }

  it('accepts a valid delete input', () => {
    const result = deleteTemplateSchema.safeParse(validDelete)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = deleteTemplateSchema.safeParse({ ...validDelete, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid channel_id (not a UUID)', () => {
    const result = deleteTemplateSchema.safeParse({ ...validDelete, channel_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/UUID/)
    }
  })
})
