import { describe, expect, it } from 'vitest'
import { buildListHref } from '@/lib/bandeja/utils'

describe('buildListHref', () => {
  it('includes n param', () => {
    const href = buildListHref('hub', { n: 60 })
    expect(href).toBe('/hub/mensajeria/inbox?n=60')
  })

  it('preserves ?c when active', () => {
    const href = buildListHref('hub', { n: 60, c: 'abc-123' })
    expect(href).toContain('c=abc-123')
    expect(href).toContain('n=60')
  })

  it('preserves ?tag when filtering', () => {
    const href = buildListHref('hub', { n: 60, tag: 'tag-uuid' })
    expect(href).toContain('tag=tag-uuid')
    expect(href).toContain('n=60')
    expect(href).not.toContain('c=')
  })

  it('preserves both ?c and ?tag simultaneously', () => {
    const href = buildListHref('hub', { n: 90, c: 'conv-id', tag: 'tag-id' })
    expect(href).toContain('c=conv-id')
    expect(href).toContain('tag=tag-id')
    expect(href).toContain('n=90')
  })

  it('does not include c or tag when null', () => {
    const href = buildListHref('hub', { n: 30, c: null, tag: null })
    expect(href).toBe('/hub/mensajeria/inbox?n=30')
  })
})
