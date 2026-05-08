import { describe, expect, it } from 'vitest'
import { computeSignature, verifyMetaSignature } from '@/lib/meta/signature'

const SECRET = 'test_secret_value'
const BODY = JSON.stringify({ hello: 'world', n: 42 })

describe('verifyMetaSignature', () => {
  it('acepta una firma correcta', () => {
    const sig = computeSignature(BODY, SECRET)
    expect(verifyMetaSignature(BODY, sig, SECRET)).toBe(true)
  })

  it('rechaza una firma con secret distinto', () => {
    const sig = computeSignature(BODY, 'otro_secret')
    expect(verifyMetaSignature(BODY, sig, SECRET)).toBe(false)
  })

  it('rechaza si falta el header', () => {
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false)
  })

  it('rechaza si el body fue alterado', () => {
    const sig = computeSignature(BODY, SECRET)
    const tampered = `${BODY} `
    expect(verifyMetaSignature(tampered, sig, SECRET)).toBe(false)
  })

  it('rechaza una firma de longitud distinta sin tirar', () => {
    expect(verifyMetaSignature(BODY, 'sha256=abc', SECRET)).toBe(false)
  })

  it('rechaza una firma con prefijo distinto pero misma longitud', () => {
    const sig = computeSignature(BODY, SECRET)
    const broken = sig.replace('sha256=', 'sha512=')
    expect(verifyMetaSignature(BODY, broken, SECRET)).toBe(false)
  })
})
