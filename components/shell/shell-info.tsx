'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

/**
 * Lo poco que las pantallas de error y de «no encontrado» necesitan del shell:
 * el bar y el inicio de quien mira (el Resumen del dueño, Administración de la
 * contadora, la carta de contenido). `error.tsx` y `not-found.tsx` no reciben
 * params ni saben el rol; el shell ya los tiene y los pasa por acá, sin I/O.
 */
export type ShellInfo = {
  tenantSlug: string
  /** `homePathForRole(role, slug)`. */
  homeHref: string
}

const ShellInfoContext = createContext<ShellInfo | null>(null)

export function ShellInfoProvider({
  tenantSlug,
  homeHref,
  children,
}: ShellInfo & { children: ReactNode }) {
  const value = useMemo(() => ({ tenantSlug, homeHref }), [tenantSlug, homeHref])
  return <ShellInfoContext.Provider value={value}>{children}</ShellInfoContext.Provider>
}

/** `null` fuera del shell del panel (un error del layout mismo sube al boundary de arriba). */
export function useShellInfo(): ShellInfo | null {
  return useContext(ShellInfoContext)
}
