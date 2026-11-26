'use client'

import { useEffect } from 'react'
import { holdReload } from '@/lib/app-version/hold'

/**
 * Mientras `when` sea verdadero, la app no se recarga sola por quietud ni al volver (sí al cambiar de
 * pantalla, y si su versión dejó de contestar). Para las pantallas con algo a medio hacer que una recarga se
 * llevaría puesto: ver `lib/app-version/decide.ts`.
 */
export function useHoldReload(when: boolean): void {
  useEffect(() => (when ? holdReload() : undefined), [when])
}

/** Lo mismo, para ponerlo en una página de servidor: mientras esté en pantalla, no se recarga sola. */
export function HoldReload({ when = true }: { when?: boolean }) {
  useHoldReload(when)
  return null
}
