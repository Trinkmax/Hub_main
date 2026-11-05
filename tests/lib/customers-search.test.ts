import { describe, expect, it } from 'vitest'
import { nameFilter, parseCustomerQuery } from '@/lib/customers/search-query'

describe('buscar un cliente como lo escribe la gente', () => {
  it('nombre y apellido juntos son dos palabras', () => {
    expect(parseCustomerQuery('Juan Pérez')).toEqual({ names: ['juan', 'perez'], phone: null })
    expect(parseCustomerQuery('Pérez, Juan')).toEqual({ names: ['perez', 'juan'], phone: null })
  })

  it('sin acentos: «Perez» encuentra a «Pérez»', () => {
    expect(nameFilter('perez')).toBe(
      'first_name.imatch."p[eéèêë]r[eéèêë]z",last_name.imatch."p[eéèêë]r[eéèêë]z"',
    )
  })

  it('un teléfono, escrito de cualquier forma', () => {
    expect(parseCustomerQuery('351 555-1234').phone).toBe('5551234')
    expect(parseCustomerQuery('0351 15 555 1234').phone).toBe('5551234')
    expect(parseCustomerQuery('+54 9 351 555-1234').phone).toBe('5551234')
    expect(parseCustomerQuery('1234').phone).toBe('1234')
  })

  it('lo que PostgREST interpretaría como sintaxis no pasa', () => {
    for (const raw of ['Juan (Pérez)', 'a,b.c', '"Ana"', 'x%y', 'a\\b']) {
      for (const name of parseCustomerQuery(raw).names) {
        expect(name).toMatch(/^[\p{L}\d'’-]+$/u)
      }
    }
  })
})
