'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { setThemePreferenceAction } from '@/lib/theme/actions'
import type { ResolvedTheme, ThemePreference } from '@/lib/theme/types'

type ThemeContextValue = {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => Promise<void>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyClass(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function ThemeProvider({
  initialPreference,
  children,
}: {
  initialPreference: ThemePreference
  children: ReactNode
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    if (initialPreference === 'auto') return 'light'
    return initialPreference
  })

  useEffect(() => {
    if (preference !== 'auto') {
      const next = preference
      setResolved(next)
      applyClass(next)
      return
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const next: ResolvedTheme = mq.matches ? 'dark' : 'light'
      setResolved(next)
      applyClass(next)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [preference])

  const setPreference = useCallback(async (next: ThemePreference) => {
    setPreferenceState(next)
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.themePref = next
    }
    if (next !== 'auto') {
      applyClass(next)
      setResolved(next)
    } else {
      const sys = resolveSystemTheme()
      applyClass(sys)
      setResolved(sys)
    }
    await setThemePreferenceAction(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
