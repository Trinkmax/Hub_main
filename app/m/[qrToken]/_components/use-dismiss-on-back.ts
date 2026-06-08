'use client'

import { useEffect, useRef } from 'react'
import { armBackGuard } from '@/lib/m-session/back-guard'

/**
 * Cierra un sheet/overlay cuando el usuario toca "atrás" en el teléfono,
 * en vez de salir de la carta. Activo solo mientras `open` sea true.
 */
export function useDismissOnBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    return armBackGuard(window, () => onCloseRef.current())
  }, [open])
}
