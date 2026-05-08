import type { ThemePreference } from './types'

const VALID: readonly ThemePreference[] = ['auto', 'light', 'dark']

export function parseThemePreference(raw: unknown): ThemePreference {
  if (typeof raw !== 'string') return 'auto'
  return (VALID as readonly string[]).includes(raw) ? (raw as ThemePreference) : 'auto'
}

export function isValidThemePreference(raw: unknown): raw is ThemePreference {
  return typeof raw === 'string' && (VALID as readonly string[]).includes(raw)
}
