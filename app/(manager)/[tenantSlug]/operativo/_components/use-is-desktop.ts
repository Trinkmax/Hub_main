'use client'

import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1024px)'

/**
 * `true` desde `lg` (1024px): ahí el detalle vive en un aside y no en un
 * sheet. Arranca en `false` para que el primer render del cliente coincida con
 * el del server (que no sabe el ancho).
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const update = () => setDesktop(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return desktop
}
