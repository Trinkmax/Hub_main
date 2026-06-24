import { describe, expect, it } from 'vitest'
import { deriveCaptureLinkSlug } from '@/lib/capture/slug'

// CHECK de customer_capture_links.slug
const LINK_SLUG_RE = /^[a-zA-Z0-9_-]{4,32}$/
const TENANT_ID = '11111111-2222-3333-4444-555555555555'

describe('deriveCaptureLinkSlug', () => {
  it('un slug normal de tenant produce un slug legible y válido', () => {
    expect(deriveCaptureLinkSlug(TENANT_ID, 'milangaucho')).toBe('club-milangaucho')
  })

  it('slugs cortos de tenant (2-3 chars) siguen siendo válidos (min 4)', () => {
    // "hub" tiene 3 chars y violaría el CHECK directo; con prefijo queda válido.
    expect(deriveCaptureLinkSlug(TENANT_ID, 'hub')).toBe('club-hub')
    expect(deriveCaptureLinkSlug(TENANT_ID, 'ba')).toBe('club-ba')
    expect(LINK_SLUG_RE.test(deriveCaptureLinkSlug(TENANT_ID, 'hub'))).toBe(true)
  })

  it('slugs largos de tenant (33-40 chars) se recortan a <=32 con sufijo único', () => {
    const long = 'a'.repeat(40)
    const out = deriveCaptureLinkSlug(TENANT_ID, long)
    expect(out.length).toBeLessThanOrEqual(32)
    expect(LINK_SLUG_RE.test(out)).toBe(true)
    expect(out.endsWith('-111111')).toBe(true)
  })

  it('siempre cumple el CHECK del DB para todo el rango de slugs de tenant (2-40)', () => {
    for (let len = 2; len <= 40; len++) {
      const slug = 'x'.repeat(len)
      const out = deriveCaptureLinkSlug(TENANT_ID, slug)
      expect(LINK_SLUG_RE.test(out)).toBe(true)
    }
  })

  it('es determinístico', () => {
    expect(deriveCaptureLinkSlug(TENANT_ID, 'hub')).toBe(deriveCaptureLinkSlug(TENANT_ID, 'hub'))
  })

  it('distintos tenants largos no colisionan (sufijo del tenant id)', () => {
    const long = 'z'.repeat(40)
    const a = deriveCaptureLinkSlug('aaaaaaaa-0000-0000-0000-000000000000', long)
    const b = deriveCaptureLinkSlug('bbbbbbbb-0000-0000-0000-000000000000', long)
    expect(a).not.toBe(b)
  })
})
