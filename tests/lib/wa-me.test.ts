import { describe, expect, it } from 'vitest'
import { buildWaMeUrl } from '@/lib/phone'

describe('buildWaMeUrl', () => {
  it('strips + and spaces from AR mobile', () => {
    const url = buildWaMeUrl('+54 9 351 555-1234')
    expect(url).toBe('https://wa.me/5493515551234')
  })

  it('appends encoded text when provided', () => {
    const url = buildWaMeUrl('+54 9 351 555-1234', 'Hola, te contactamos de HUB')
    expect(url).toBe('https://wa.me/5493515551234?text=Hola%2C%20te%20contactamos%20de%20HUB')
  })

  it('strips hyphens and parentheses', () => {
    expect(buildWaMeUrl('(0351) 555-1234')).toBe('https://wa.me/03515551234')
  })

  it('returns null for empty string', () => {
    expect(buildWaMeUrl('')).toBeNull()
  })

  it('returns null for string with only non-digits', () => {
    expect(buildWaMeUrl('---')).toBeNull()
  })

  it('handles international non-AR number', () => {
    expect(buildWaMeUrl('+1 555 123 4567')).toBe('https://wa.me/15551234567')
  })

  it('handles already-clean digit string', () => {
    expect(buildWaMeUrl('5493515551234')).toBe('https://wa.me/5493515551234')
  })

  it('no text param when text is undefined', () => {
    const url = buildWaMeUrl('+5493515551234', undefined)
    expect(url).toBe('https://wa.me/5493515551234')
    expect(url).not.toContain('text=')
  })
})
