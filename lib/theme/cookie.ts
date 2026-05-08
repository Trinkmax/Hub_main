import 'server-only'
import { cookies } from 'next/headers'
import { parseThemePreference } from './parse'
import { THEME_COOKIE, type ThemePreference } from './types'

export async function readThemePreference(): Promise<ThemePreference> {
  const store = await cookies()
  return parseThemePreference(store.get(THEME_COOKIE)?.value)
}
