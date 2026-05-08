import { describe, expect, it } from 'vitest'
import {
  formatPhoneForDisplay,
  InvalidPhoneError,
  normalizePhone,
  tryNormalizePhone,
} from '@/lib/phone'

describe('normalizePhone — argentino con código país', () => {
  it('+54 9 351 555-1234 → +5493515551234', () => {
    expect(normalizePhone('+54 9 351 555-1234')).toBe('+5493515551234')
  })

  it('agrega el 9 móvil cuando viene con +54 sin él', () => {
    expect(normalizePhone('+54 351 555 1234')).toBe('+5493515551234')
  })

  it('respeta paréntesis en el código de área', () => {
    expect(normalizePhone('(011) 4555-1234')).toBe('+5491145551234')
  })
})

describe('normalizePhone — argentino doméstico', () => {
  it('drop del 0 inicial (formato fijo viejo)', () => {
    expect(normalizePhone('0351 555 1234')).toBe('+5493515551234')
  })

  it('drop de 0 + 15 (móvil viejo)', () => {
    expect(normalizePhone('0351-15-555-1234')).toBe('+5493515551234')
  })

  it('10 dígitos sin contexto → asume AR móvil', () => {
    expect(normalizePhone('3515551234')).toBe('+5493515551234')
  })

  it('11 dígitos arrancando con 9', () => {
    expect(normalizePhone('93515551234')).toBe('+5493515551234')
  })
})

describe('normalizePhone — sin +54 explícito', () => {
  it('formato 54 ... sin + se completa', () => {
    expect(normalizePhone('54 351 555 1234')).toBe('+5493515551234')
  })
})

describe('normalizePhone — extranjero', () => {
  it('respeta país no AR cuando vino con +', () => {
    expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567')
  })
})

describe('normalizePhone — rechazos', () => {
  it('rechaza string vacío', () => {
    expect(() => normalizePhone('')).toThrow(InvalidPhoneError)
  })

  it('rechaza letras', () => {
    expect(() => normalizePhone('hola')).toThrow(InvalidPhoneError)
  })

  it('rechaza ambiguo (15 + 8 dígitos sin área)', () => {
    expect(() => normalizePhone('15 555 1234')).toThrow(InvalidPhoneError)
  })

  it('rechaza demasiado corto', () => {
    expect(() => normalizePhone('1234')).toThrow(InvalidPhoneError)
  })
})

describe('tryNormalizePhone', () => {
  it('devuelve null sin lanzar para inputs malos', () => {
    expect(tryNormalizePhone('xxx')).toBeNull()
  })

  it('devuelve string normalizado para inputs buenos', () => {
    expect(tryNormalizePhone('3515551234')).toBe('+5493515551234')
  })
})

describe('formatPhoneForDisplay', () => {
  it('formatea AR móvil legible', () => {
    expect(formatPhoneForDisplay('+5493515551234')).toBe('+54 9 351 555-1234')
  })

  it('deja otros países como están', () => {
    expect(formatPhoneForDisplay('+15551234567')).toBe('+15551234567')
  })
})
