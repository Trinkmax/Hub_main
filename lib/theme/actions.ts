'use server'

import { cookies } from 'next/headers'
import { isValidThemePreference } from './parse'
import { THEME_COOKIE, type ThemePreference } from './types'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export async function setThemePreferenceAction(value: ThemePreference): Promise<void> {
  if (!isValidThemePreference(value)) {
    throw new Error('Theme preference inválida')
  }
  const store = await cookies()
  store.set(THEME_COOKIE, value, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  })
}
