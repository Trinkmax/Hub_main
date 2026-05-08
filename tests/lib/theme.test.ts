import { describe, expect, it } from 'vitest'
import { isValidThemePreference, parseThemePreference } from '@/lib/theme/parse'

describe('parseThemePreference', () => {
  it('acepta los tres valores válidos', () => {
    expect(parseThemePreference('auto')).toBe('auto')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
  })

  it('default a "auto" cuando el valor no es string', () => {
    expect(parseThemePreference(undefined)).toBe('auto')
    expect(parseThemePreference(null)).toBe('auto')
    expect(parseThemePreference(42)).toBe('auto')
  })

  it('default a "auto" cuando el string no es válido', () => {
    expect(parseThemePreference('rainbow')).toBe('auto')
    expect(parseThemePreference('')).toBe('auto')
    expect(parseThemePreference('LIGHT')).toBe('auto') // case-sensitive
  })
})

describe('isValidThemePreference', () => {
  it('narrowing correcto sobre valores válidos', () => {
    expect(isValidThemePreference('auto')).toBe(true)
    expect(isValidThemePreference('light')).toBe(true)
    expect(isValidThemePreference('dark')).toBe(true)
  })

  it('rechaza valores inválidos', () => {
    expect(isValidThemePreference('foo')).toBe(false)
    expect(isValidThemePreference(null)).toBe(false)
    expect(isValidThemePreference(undefined)).toBe(false)
    expect(isValidThemePreference(123)).toBe(false)
  })
})
