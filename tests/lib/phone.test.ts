import { describe, expect, it } from 'vitest'
import {
  canonicalPhone,
  formatPhoneForDisplay,
  InvalidPhoneError,
  normalizePhone,
  phoneVariants,
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

// La misma persona tenía dos fichas: la reserva guardaba lo que entregaba el
// campo de teléfono (+543…, sin el 9) y el club y las entradas guardaban +5493….
describe('canonicalPhone', () => {
  it('le pone el 9 a lo que el campo de teléfono entrega sin él', () => {
    expect(canonicalPhone('+543511234567')).toBe('+5493511234567')
    expect(canonicalPhone('+541112345678')).toBe('+5491112345678')
  })

  it('deja igual lo que ya está con el 9 y normaliza lo tipeado a mano', () => {
    expect(canonicalPhone('+5493511234567')).toBe('+5493511234567')
    expect(canonicalPhone(' 351 123-4567 ')).toBe('+5493511234567')
    expect(canonicalPhone('0351 15 123-4567')).toBe('+5493511234567')
  })

  it('respeta otros países y rechaza lo que no es un teléfono', () => {
    expect(canonicalPhone('+15551234567')).toBe('+15551234567')
    expect(canonicalPhone('')).toBeNull()
    expect(canonicalPhone('hola')).toBeNull()
  })
})

describe('phoneVariants', () => {
  it('busca un celular argentino con y sin el 9, la canónica primero', () => {
    expect(phoneVariants('+5493511234567')).toEqual(['+5493511234567', '+543511234567'])
    expect(phoneVariants('+543511234567')).toEqual(['+5493511234567', '+543511234567'])
  })

  it('no inventa variantes para otros países', () => {
    expect(phoneVariants('+15551234567')).toEqual(['+15551234567'])
  })
})
