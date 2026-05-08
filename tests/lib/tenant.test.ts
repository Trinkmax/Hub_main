import { describe, expect, it } from 'vitest'
import { requireRole } from '@/lib/tenant/access'
import { RoleRequiredError } from '@/lib/tenant/errors'
import { isValidSlug, slugify } from '@/lib/tenant/slugify'

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Bar HUB Demo')).toBe('bar-hub-demo')
  })

  it('strips accents', () => {
    expect(slugify('Café Mañana')).toBe('cafe-manana')
  })

  it('collapses repeats and trims edges', () => {
    expect(slugify('  --bar---hub--  ')).toBe('bar-hub')
  })

  it('caps length at 40', () => {
    expect(slugify('a'.repeat(60))).toHaveLength(40)
  })
})

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('bar-hub')).toBe(true)
    expect(isValidSlug('a1')).toBe(true)
  })

  it('rejects too short', () => {
    expect(isValidSlug('a')).toBe(false)
  })

  it('rejects uppercase or spaces', () => {
    expect(isValidSlug('Bar Hub')).toBe(false)
    expect(isValidSlug('BAR')).toBe(false)
  })

  it('rejects reserved slugs', () => {
    expect(isValidSlug('login')).toBe(false)
    expect(isValidSlug('api')).toBe(false)
    expect(isValidSlug('onboarding')).toBe(false)
    expect(isValidSlug('accept-invite')).toBe(false)
  })
})

describe('requireRole', () => {
  it('passes when role is allowed', () => {
    expect(() => requireRole('owner', ['owner'])).not.toThrow()
    expect(() => requireRole('cashier', ['owner', 'cashier'])).not.toThrow()
  })

  it('throws RoleRequiredError when not allowed', () => {
    expect(() => requireRole('cashier', ['owner'])).toThrow(RoleRequiredError)
    expect(() => requireRole('waiter', ['owner', 'cashier'])).toThrow(RoleRequiredError)
  })
})
