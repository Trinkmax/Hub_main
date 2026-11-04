import { describe, expect, it } from 'vitest'
import {
  entryCodeFromOrderId,
  orderIdFromEntryCode,
  shortCodeFromOrderId,
} from '@/lib/ticketing/entry-code'

const ID = 'ab7f3e12-9c4d-4a1b-8e2f-0d1c2b3a4f5e'

describe('el código del QR de una entrada', () => {
  it('ida y vuelta: del id del pedido al código y de nuevo al id', () => {
    const code = entryCodeFromOrderId(ID)
    expect(code).toHaveLength(22)
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(orderIdFromEntryCode(code)).toBe(ID)
  })

  it('un id que no es uuid no genera código', () => {
    expect(() => entryCodeFromOrderId('no-es-un-id')).toThrow()
  })

  it('basura, largo equivocado o caracteres raros → null', () => {
    expect(orderIdFromEntryCode('')).toBeNull()
    expect(orderIdFromEntryCode('corto')).toBeNull()
    expect(orderIdFromEntryCode(`${entryCodeFromOrderId(ID)}x`)).toBeNull()
    expect(orderIdFromEntryCode('!'.repeat(22))).toBeNull()
  })

  it('una sola escritura vale: otro último caracter para los mismos bytes se rechaza', () => {
    const code = entryCodeFromOrderId(ID)
    const last = code.slice(-1)
    const other = last === 'B' ? 'C' : 'B'
    expect(orderIdFromEntryCode(`${code.slice(0, -1)}${other}`)).toBeNull()
  })

  it('el número impreso son los primeros 8 del id, en mayúsculas', () => {
    expect(shortCodeFromOrderId(ID)).toBe('AB7F3E12')
  })
})
