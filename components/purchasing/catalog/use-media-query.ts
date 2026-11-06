'use client'

import { useCallback, useSyncExternalStore } from 'react'

/** Desde acá la hoja va al costado (compu, tablet); antes, abajo (celular). */
export const WIDE_QUERY = '(min-width: 640px)'

/**
 * ¿Se cumple la media query? En el servidor y al hidratar devuelve `fallback`; después, lo que diga
 * el navegador (y se actualiza si cambia, por ejemplo al girar la tablet).
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback,
  )
}

const subscribeNever = () => () => {}

/**
 * `false` en el servidor y mientras hidrata; `true` después. Una hoja que llega abierta por la URL
 * (`?editar=`) espera a esto para abrirse ya del lado correcto (abajo o al costado) y no saltar.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
}

/** ¿Se usa con el dedo? En el celular el foco no abre el teclado solo. */
export function isTouchPointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}
