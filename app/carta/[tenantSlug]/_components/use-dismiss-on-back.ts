'use client'

import { useEffect, useRef } from 'react'

/**
 * Cierra un overlay (Sheet) cuando el usuario toca "atrás" del teléfono, en
 * lugar de abandonar la carta. Mete una entrada en el history al abrir y la
 * consume en `popstate`. Versión local y autocontenida (sin dependencias de
 * `lib/`) porque la carta pública es read-only y vive aislada de la sesión.
 */
export function useDismissOnBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPop = () => onCloseRef.current()
    window.history.pushState({ cartaSheet: true }, '')
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Si el sheet se cerró por UI (no por "atrás"), limpiamos la entrada
      // que metimos para no dejar history basura.
      if (window.history.state?.cartaSheet) window.history.back()
    }
  }, [open])
}
