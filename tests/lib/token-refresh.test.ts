import { describe, expect, it } from 'vitest'
import { isTokenExpiringSoon } from '@/lib/meta/token-refresh'

const NOW = new Date('2026-06-15T12:00:00Z')

describe('isTokenExpiringSoon', () => {
  it('returns false when expiresAt is null', () => {
    expect(isTokenExpiringSoon(null, NOW)).toBe(false)
  })

  it('returns false when expiresAt is far in the future (> 7 days)', () => {
    const future = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(future, NOW)).toBe(false)
  })

  it('returns true when expiresAt is exactly 7 days from now', () => {
    const cutoff = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(cutoff, NOW)).toBe(true)
  })

  it('returns true when expiresAt is within 7 days (3 days from now)', () => {
    const soon = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(soon, NOW)).toBe(true)
  })

  it('returns true when token has already expired (past date)', () => {
    const past = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(past, NOW)).toBe(true)
  })

  it('returns false when expiresAt is 8 days from now with default withinDays=7', () => {
    const eightDays = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(eightDays, NOW)).toBe(false)
  })

  it('respects custom withinDays parameter', () => {
    const tenDays = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString()
    expect(isTokenExpiringSoon(tenDays, NOW, 14)).toBe(true)
    expect(isTokenExpiringSoon(tenDays, NOW, 7)).toBe(false)
  })
})
