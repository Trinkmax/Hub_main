import { beforeEach, describe, expect, it } from 'vitest'
import { _resetRateLimit, RateLimitedError, rateLimit } from '@/lib/rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    _resetRateLimit()
  })

  it('permite hasta el límite y rechaza el siguiente', () => {
    const now = 1000
    const clock = () => now
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: 'a', limit: 3, windowMs: 1000, now: clock })
    }
    expect(() => rateLimit({ key: 'a', limit: 3, windowMs: 1000, now: clock })).toThrow(
      RateLimitedError,
    )
  })

  it('resetea cuando pasa la ventana', () => {
    let now = 1000
    const clock = () => now
    for (let i = 0; i < 3; i++) rateLimit({ key: 'b', limit: 3, windowMs: 1000, now: clock })
    expect(() => rateLimit({ key: 'b', limit: 3, windowMs: 1000, now: clock })).toThrow(
      RateLimitedError,
    )
    now += 1500
    // ventana expirada → permite de nuevo
    expect(() => rateLimit({ key: 'b', limit: 3, windowMs: 1000, now: clock })).not.toThrow()
  })

  it('keys distintas son independientes', () => {
    const clock = () => 1000
    for (let i = 0; i < 3; i++) rateLimit({ key: 'x', limit: 3, windowMs: 1000, now: clock })
    expect(() => rateLimit({ key: 'y', limit: 3, windowMs: 1000, now: clock })).not.toThrow()
  })

  it('RateLimitedError lleva retryAfterMs', () => {
    const now = 1000
    const clock = () => now
    rateLimit({ key: 'z', limit: 1, windowMs: 5000, now: clock })
    try {
      rateLimit({ key: 'z', limit: 1, windowMs: 5000, now: clock })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError)
      expect((e as RateLimitedError).retryAfterMs).toBeGreaterThan(0)
    }
  })
})
