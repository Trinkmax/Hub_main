import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  importClientRef,
  SHA256_HEX_RE,
  sha256Hex,
  sha256HexSync,
  uuidV8FromSha256,
} from '@/lib/imports/hash'

const nodeSha = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')

describe('sha256', () => {
  const texts = [
    '',
    'abc',
    'Mis Comprobantes Recibidos - CUIT 30712345671',
    'ÑANDÚ café',
    '🧾 factura',
  ]

  it('la versión pura da lo mismo que node:crypto', () => {
    for (const t of texts) expect(sha256HexSync(t)).toBe(nodeSha(t))
    const big = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 31) % 251)
    expect(sha256HexSync(big)).toBe(nodeSha(big))
  })

  it('la asíncrona usa Web Crypto y da lo mismo', async () => {
    for (const t of texts) expect(await sha256Hex(t)).toBe(nodeSha(t))
    const bytes = new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)
    expect(await sha256Hex(bytes)).toBe(nodeSha(Buffer.from([2, 3, 4])))
    expect(SHA256_HEX_RE.test(await sha256Hex('x'))).toBe(true)
  })

  describe('sin crypto.subtle (panel abierto por la IP de la red local)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })
    it('cae en la versión pura', async () => {
      vi.stubGlobal('crypto', {})
      expect(await sha256Hex('abc')).toBe(nodeSha('abc'))
    })
  })
})

describe('uuidV8FromSha256', () => {
  it('UUID versión 8 y variante RFC 9562 con los primeros 16 bytes del SHA-256', () => {
    const id = uuidV8FromSha256('acc-import:t:mc:R:30712345671:1:3:110266:1')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const hex = nodeSha('acc-import:t:mc:R:30712345671:1:3:110266:1')
    const raw = id.replace(/-/g, '')
    // Todo igual salvo el nibble de versión y los dos bits de variante.
    expect(raw.slice(0, 12)).toBe(hex.slice(0, 12))
    expect(raw.slice(13, 16)).toBe(hex.slice(13, 16))
    expect(raw.slice(17, 32)).toBe(hex.slice(17, 32))
  })

  it('determinístico y distinto para otro texto', () => {
    expect(uuidV8FromSha256('a')).toBe(uuidV8FromSha256('a'))
    expect(uuidV8FromSha256('a')).not.toBe(uuidV8FromSha256('b'))
  })

  it('zod 4 lo acepta como UUID (el client_ref de acc_post_bundle)', () => {
    for (let i = 0; i < 50; i++) {
      expect(z.uuid().safeParse(uuidV8FromSha256(`texto ${i}`)).success).toBe(true)
    }
  })

  it('importClientRef: «acc-import:» + bar + clave + intento', () => {
    const tenant = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5'
    const ref = importClientRef(tenant, 'mc:R:30712345671:1:3:110266', 1)
    expect(ref).toBe(uuidV8FromSha256(`acc-import:${tenant}:mc:R:30712345671:1:3:110266:1`))
    expect(importClientRef(tenant, 'mc:R:30712345671:1:3:110266', 2)).not.toBe(ref)
  })
})
