'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Devuelve una función que dispara `fn` después de `delayMs` ms de inactividad.
 * Si vuelve a ser invocada antes de que expire el timer, lo reinicia.
 *
 * Patrón típico para Realtime: agrupar varios payloads que llegan juntos en un
 * solo refresh, en lugar de hacer N fetches.
 */
export function useDebouncedRefresh(fn: () => void | Promise<void>, delayMs = 500) {
  const fnRef = useRef(fn)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mantener la última versión de fn sin reiniciar el debounce.
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void fnRef.current()
    }, delayMs)
  }, [delayMs])
}
