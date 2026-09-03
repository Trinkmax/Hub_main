import { describe, expect, it } from 'vitest'
import {
  normalizeUrl,
  publicLinkCreateSchema,
  publicLinkPageSchema,
  publicLinkUpdateSchema,
} from '@/lib/public-links/schemas'

// uuid v4 real: `z.uuid()` de zod 4 valida versión y variante, no sólo la forma.
const UUID = '11111111-2222-4333-8444-555555555555'

function form(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Menús Hub',
    description: '',
    url: 'https://hubbar.com.ar/carta',
    icon: '',
    highlight: false,
    ...overrides,
  }
}

describe('normalizeUrl', () => {
  it('completa el https:// que nadie escribe', () => {
    expect(normalizeUrl('hubbar.com.ar')).toBe('https://hubbar.com.ar')
    expect(normalizeUrl('www.pedix.app/hub')).toBe('https://www.pedix.app/hub')
    expect(normalizeUrl('wa.me/5493511234567')).toBe('https://wa.me/5493511234567')
  })

  it('no toca lo que ya trae protocolo', () => {
    expect(normalizeUrl('https://instagram.com/hub')).toBe('https://instagram.com/hub')
    expect(normalizeUrl('http://viejo.com')).toBe('http://viejo.com')
  })

  it('el vacío queda vacío (lo rechaza el schema, no esta función)', () => {
    expect(normalizeUrl('   ')).toBe('')
  })
})

describe('publicLinkCreateSchema', () => {
  it('guarda la URL ya normalizada', () => {
    expect(publicLinkCreateSchema.parse(form({ url: 'wa.me/549351' })).url).toBe(
      'https://wa.me/549351',
    )
  })

  it('bloquea los esquemas peligrosos: esto termina en un <a href> público', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      expect(publicLinkCreateSchema.safeParse(form({ url })).success).toBe(false)
    }
  })

  it('exige texto del botón y link', () => {
    expect(publicLinkCreateSchema.safeParse(form({ label: '  ' })).success).toBe(false)
    expect(publicLinkCreateSchema.safeParse(form({ url: '' })).success).toBe(false)
  })

  it('lo opcional vacío se guarda como null, no como cadena vacía', () => {
    const parsed = publicLinkCreateSchema.parse(form())
    expect(parsed.description).toBeNull()
    expect(parsed.icon).toBeNull()
  })

  it('respeta los topes de largo del CHECK de la tabla', () => {
    expect(publicLinkCreateSchema.safeParse(form({ label: 'x'.repeat(81) })).success).toBe(false)
    expect(publicLinkCreateSchema.safeParse(form({ description: 'x'.repeat(121) })).success).toBe(
      false,
    )
  })

  it('el update pide el id', () => {
    expect(publicLinkUpdateSchema.safeParse(form()).success).toBe(false)
    expect(publicLinkUpdateSchema.safeParse({ ...form(), id: UUID }).success).toBe(true)
  })
})

describe('publicLinkPageSchema', () => {
  it('título y bajada vacíos son null (la página cae al nombre del bar)', () => {
    const parsed = publicLinkPageSchema.parse({ headline: '', bio: '   ', active: true })
    expect(parsed.headline).toBeNull()
    expect(parsed.bio).toBeNull()
    expect(parsed.active).toBe(true)
  })

  it('corta títulos y bajadas que no entran en la tabla', () => {
    expect(
      publicLinkPageSchema.safeParse({ headline: 'x'.repeat(81), bio: '', active: true }).success,
    ).toBe(false)
    expect(
      publicLinkPageSchema.safeParse({ headline: '', bio: 'x'.repeat(281), active: true }).success,
    ).toBe(false)
  })
})
