import { describe, expect, it } from 'vitest'
import { contactCustomerInputSchema } from '@/lib/meta/contact-schemas'

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('contactCustomerInputSchema', () => {
  describe('destinatario', () => {
    it('rechaza si no hay customer_id ni phone', () => {
      const result = contactCustomerInputSchema.safeParse({
        body: 'hola',
      })
      expect(result.success).toBe(false)
    })

    it('acepta con solo customer_id', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: 'hola',
      })
      expect(result.success).toBe(true)
    })

    it('acepta con solo phone', () => {
      const result = contactCustomerInputSchema.safeParse({
        phone: '+5493515551234',
        body: 'hola',
      })
      expect(result.success).toBe(true)
    })

    it('acepta con ambos customer_id y phone', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        phone: '+5493515551234',
        body: 'hola',
      })
      expect(result.success).toBe(true)
    })
  })

  describe('contenido', () => {
    it('rechaza si no hay body ni template', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
      })
      expect(result.success).toBe(false)
    })

    it('rechaza si hay ambos body y template', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: 'hola',
        template: { name: 'bienvenida', language: 'es_AR', variables: [] },
      })
      expect(result.success).toBe(false)
    })

    it('acepta con solo body', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: 'hola mundo',
      })
      expect(result.success).toBe(true)
    })

    it('acepta con solo template', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        template: { name: 'bienvenida', language: 'es_AR', variables: ['Juan'] },
      })
      expect(result.success).toBe(true)
    })

    it('rechaza body vacío (< 1 char)', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: '   ',
      })
      expect(result.success).toBe(false)
    })

    it('rechaza body demasiado largo (> 4096)', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: 'a'.repeat(4097),
      })
      expect(result.success).toBe(false)
    })
  })

  describe('casos válidos combinados', () => {
    it('customer_id + body — caso típico desde conversación', () => {
      const result = contactCustomerInputSchema.safeParse({
        customer_id: VALID_UUID,
        body: '¡Hola! ¿Todo bien?',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.customer_id).toBe(VALID_UUID)
        expect(result.data.body).toBe('¡Hola! ¿Todo bien?')
      }
    })

    it('phone + template — caso cold contact con plantilla', () => {
      const result = contactCustomerInputSchema.safeParse({
        phone: '+5493515551234',
        template: { name: 'oferta_especial', language: 'es_AR', variables: ['30%'] },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.phone).toBe('+5493515551234')
        expect(result.data.template?.name).toBe('oferta_especial')
        expect(result.data.template?.variables).toEqual(['30%'])
      }
    })
  })
})
