import { describe, expect, it } from 'vitest'
import { quickMessageCreateSchema } from '@/lib/quick-messages/schemas'

describe('quickMessageCreateSchema', () => {
  describe('valid input', () => {
    it('accepts a valid message', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Bienvenida',
        shortcut: 'bienvenida',
        body: 'Hola! Gracias por escribirnos.',
      })
      expect(result.success).toBe(true)
    })

    it('accepts shortcuts with numbers, hyphens, and underscores', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Consulta horarios',
        shortcut: 'horario-2024_v2',
        body: 'Estamos abiertos de lunes a sábado.',
      })
      expect(result.success).toBe(true)
    })

    it('accepts a body of exactly 1024 characters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'test',
        body: 'a'.repeat(1024),
      })
      expect(result.success).toBe(true)
    })

    it('accepts a title of exactly 80 characters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'a'.repeat(80),
        shortcut: 'test',
        body: 'Body del mensaje.',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('shortcut validation', () => {
    it('rejects shortcuts with spaces', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'hola mundo',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/atajo/)
      }
    })

    it('rejects shortcuts with uppercase letters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'HolaMundo',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
    })

    it('rejects shortcuts with special characters like @', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'hola@mundo',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
    })

    it('rejects an empty shortcut', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: '',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
    })

    it('rejects a shortcut longer than 40 characters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'a'.repeat(41),
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('body validation', () => {
    it('rejects an empty body', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'test',
        body: '',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/requerido/)
      }
    })

    it('rejects a body longer than 1024 characters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'Test',
        shortcut: 'test',
        body: 'a'.repeat(1025),
      })
      expect(result.success).toBe(false)
    })
  })

  describe('title validation', () => {
    it('rejects an empty title', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: '',
        shortcut: 'test',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/requerido/)
      }
    })

    it('rejects a title longer than 80 characters', () => {
      const result = quickMessageCreateSchema.safeParse({
        title: 'a'.repeat(81),
        shortcut: 'test',
        body: 'Texto.',
      })
      expect(result.success).toBe(false)
    })
  })
})
