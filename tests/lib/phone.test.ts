import { describe, expect, it } from 'vitest'
import {
  argentineNationalNumber,
  canonicalPhone,
  formatPhoneForDisplay,
  formatPhoneInternational,
  InvalidPhoneError,
  normalizePhone,
  phoneProblem,
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

// 17/11/2026: Ambar no pudo comprar El Grinch. El campo de teléfono trae el +54
// adentro; lo borró y escribió «0351…», y llegó «+03515551234», que la base
// rechaza. Otros que lo borraron quedaron guardados como números de Portugal
// (+351…), Kosovo (+383…) o Afganistán (+9 351…). Estos son esos casos reales.
describe('normalizePhone — argentino al que le borraron el +54', () => {
  it('«+0351…»: ningún país empieza con 0', () => {
    expect(normalizePhone('+03515551234')).toBe('+5493515551234')
    expect(normalizePhone('+0351 15 555 1234')).toBe('+5493515551234')
  })

  it('Córdoba, Catamarca y el interior que el campo tomaba por otros países', () => {
    expect(normalizePhone('+3515551234')).toBe('+5493515551234') // «Portugal»
    expect(normalizePhone('+3834405374')).toBe('+5493834405374') // «Kosovo»
    expect(normalizePhone('+3562123456')).toBe('+5493562123456') // «Malta»
    expect(normalizePhone('+93515551234')).toBe('+5493515551234') // «Afganistán»
  })

  it('si coincide con un número de otro país, gana el argentino', () => {
    // 3548 es La Falda; +354 8… también sería un celular de Islandia.
    expect(normalizePhone('+3548123456')).toBe('+5493548123456')
  })
})

describe('normalizePhone — el 0, el 15 y el 9 en cualquier combinación', () => {
  it('con el +54 adelante', () => {
    expect(normalizePhone('+54 0351 15 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('+54 351 15 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('+54 9 11 15 5555 5555')).toBe('+5491155555555')
    expect(normalizePhone('+54 011 15 5555-5555')).toBe('+5491155555555')
  })

  it('con el 54 repetido (el campo ya lo traía y lo volvieron a escribir)', () => {
    expect(normalizePhone('+54 54 9 351 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('+54 54 351 555 1234')).toBe('+5493515551234')
  })

  it('sin código de país', () => {
    expect(normalizePhone('011 15 5555-5555')).toBe('+5491155555555')
    expect(normalizePhone('351 15 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('54 9 351 555 1234')).toBe('+5493515551234')
  })

  it('«00» es el prefijo para llamar al exterior', () => {
    expect(normalizePhone('0054 9 351 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('0034 612 345 678')).toBe('+34612345678')
  })

  it('las marcas invisibles de un número copiado de WhatsApp y las barras', () => {
    expect(normalizePhone('\u202A+54 9 351 555-1234\u202C')).toBe('+5493515551234')
    expect(normalizePhone('\u200E351 555 1234')).toBe('+5493515551234')
    expect(normalizePhone('351/5551234')).toBe('+5493515551234')
  })
})

describe('normalizePhone — otros países', () => {
  it('respeta los números que existen en su país', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678')
    expect(normalizePhone('+55 48 99123 4567')).toBe('+5548991234567')
    expect(normalizePhone('+598 94 123 456')).toBe('+59894123456')
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678')
    expect(normalizePhone('+351 912 345 678')).toBe('+351912345678')
  })

  it('los celulares de México con el 1, como los escribe WhatsApp', () => {
    expect(normalizePhone('+52 1 55 1234 5678')).toBe('+5215512345678')
  })

  it('rechaza lo que no tiene el largo de su país ni es argentino', () => {
    expect(() => normalizePhone('+1626123456')).toThrow(InvalidPhoneError)
    expect(() => normalizePhone('+15 5551234')).toThrow(InvalidPhoneError)
    expect(() => normalizePhone('+0')).toThrow(InvalidPhoneError)
  })
})

describe('normalizePhone — números argentinos que no existen', () => {
  it('le falta un número o la característica', () => {
    expect(() => normalizePhone('9351555123')).toThrow(InvalidPhoneError)
    expect(() => normalizePhone('555 1234')).toThrow(InvalidPhoneError)
    expect(() => normalizePhone('+54 351 555 123')).toThrow(InvalidPhoneError)
  })

  it('una característica que no existe (ninguna empieza con 12 a 19, 20, 21, 30 a 32, 39 ni del 4 al 9)', () => {
    expect(() => normalizePhone('1234567890')).toThrow(InvalidPhoneError)
    expect(() => normalizePhone('+54 4555 123456')).toThrow(InvalidPhoneError)
  })
})

describe('argentineNationalNumber', () => {
  it('saca el 0, el 15, el 9 y el 54', () => {
    expect(argentineNationalNumber('03511555512 34'.replace(' ', ''))).toBe('3515551234')
    expect(argentineNationalNumber('5493515551234')).toBe('3515551234')
    expect(argentineNationalNumber('111555555555')).toBe('1155555555')
  })

  it('null si no es un número argentino', () => {
    expect(argentineNationalNumber('34612345678')).toBeNull()
    expect(argentineNationalNumber('59894123456')).toBeNull()
  })
})

describe('canonicalPhone — lo que sale siempre lo acepta la base', () => {
  const DB = /^\+[1-9]\d{7,14}$/
  const inputs = [
    '+03515551234',
    '+3515551234',
    '+54 0351 15 555 1234',
    '+34 612 345 678',
    '+52 1 55 1234 5678',
    '+54 (351) 555-1234',
    '\u202A+54 9 351 555-1234\u202C',
  ]
  for (const input of inputs) {
    it(JSON.stringify(input), () => {
      const out = canonicalPhone(input)
      expect(out).not.toBeNull()
      expect(out).toMatch(DB)
    })
  }

  it('nunca devuelve lo que vino con espacios o letras', () => {
    expect(canonicalPhone('+54 9 351 555 1234 int. 2')).toBe('+5493515551234')
  })
})

describe('phoneProblem', () => {
  it('argentino incompleto, con el +54 del campo o sin código', () => {
    expect(phoneProblem('+54351555')).toBe('argentina')
    expect(phoneProblem('351 555 12')).toBe('argentina')
  })

  it('de otro país que allá no existe', () => {
    expect(phoneProblem('+1626123456')).toBe('other')
  })

  it('nada si está bien o vacío', () => {
    expect(phoneProblem('+5493515551234')).toBeNull()
    expect(phoneProblem('+03515551234')).toBeNull()
    expect(phoneProblem('')).toBeNull()
    expect(phoneProblem(undefined)).toBeNull()
  })
})

describe('formatPhoneInternational', () => {
  it('corta cada característica donde va', () => {
    expect(formatPhoneInternational('+5493515551234')).toBe('+54 9 351 555 1234')
    expect(formatPhoneInternational('+5491155551234')).toBe('+54 9 11 5555 1234')
    expect(formatPhoneInternational('+34612345678')).toBe('+34 612 34 56 78')
  })

  it('lo que no entiende vuelve como vino', () => {
    expect(formatPhoneInternational('hola')).toBe('hola')
  })
})
