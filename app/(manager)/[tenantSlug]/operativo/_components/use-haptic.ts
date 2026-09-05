'use client'

import { useCallback } from 'react'

/**
 * Vibración corta al confirmar algo con el dedo. Solo existe en Android
 * (Safari iOS no expone `navigator.vibrate`): donde no está, no hace nada.
 */
export function useHaptic() {
  return useCallback((pattern: number | number[] = 12) => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    try {
      navigator.vibrate(pattern)
    } catch {
      // ignorado a propósito: es un detalle, nunca un error
    }
  }, [])
}
