import { describe, expect, it } from 'vitest'
import { parseQrInput } from '@/lib/sessions-waiter/qr-parse'

describe('parseQrInput', () => {
  it('acepta un token crudo de 16 chars alfanuméricos', () => {
    expect(parseQrInput('aBcDeFgHiJkLmNoP')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('extrae el token de una URL https con /m/<token>', () => {
    expect(parseQrInput('https://hub.app/m/aBcDeFgHiJkLmNoP')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('extrae el token con trailing slash', () => {
    expect(parseQrInput('https://hub.app/m/aBcDeFgHiJkLmNoP/')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('extrae el token de una URL http localhost', () => {
    expect(parseQrInput('http://localhost:3000/m/aBcDeFgHiJkLmNoP')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('extrae el token de un path sin scheme', () => {
    expect(parseQrInput('/m/aBcDeFgHiJkLmNoP')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('rechaza un token de longitud incorrecta', () => {
    expect(parseQrInput('shortToken')).toBeNull()
    expect(parseQrInput('aBcDeFgHiJkLmNoPq')).toBeNull() // 17 chars
  })

  it('rechaza un token con chars inválidos', () => {
    expect(parseQrInput('aBcDeFgH-jKlMnOp')).toBeNull() // guion
    expect(parseQrInput('aBcDeFgH iJkLmNoP')).toBeNull() // espacio
  })

  it('rechaza URLs sin /m/<token>', () => {
    expect(parseQrInput('https://hub.app/login')).toBeNull()
    expect(parseQrInput('https://hub.app/m/')).toBeNull()
  })

  it('rechaza inputs vacíos o null', () => {
    expect(parseQrInput('')).toBeNull()
    expect(parseQrInput('   ')).toBeNull()
    expect(parseQrInput(null)).toBeNull()
    expect(parseQrInput(undefined)).toBeNull()
  })

  it('trim del whitespace alrededor', () => {
    expect(parseQrInput('  aBcDeFgHiJkLmNoP  ')).toBe('aBcDeFgHiJkLmNoP')
  })

  it('rechaza texto basura no-QR', () => {
    expect(parseQrInput('hello world')).toBeNull()
    expect(parseQrInput('not a url at all')).toBeNull()
  })
})
