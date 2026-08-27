'use client'

import { useEffect, useRef } from 'react'

/**
 * `setInterval` que sólo corre mientras la pestaña está visible, y dispara una
 * vez al volver a primer plano.
 *
 * Es la red de seguridad de las pantallas en vivo (Realtime no garantiza
 * delivery 100 %). Con `setInterval` a secas, cada tablet olvidada con el salón
 * abierto en segundo plano seguía pegándole a una función de Vercel (y a
 * Supabase) toda la noche: el intervalo cuenta en la factura aunque nadie mire.
 */
export function useVisibleInterval(fn: () => void | Promise<void>, ms: number): void {
  const fnRef = useRef(fn)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    let timer: number | null = null
    const start = () => {
      if (timer !== null) return
      timer = window.setInterval(() => {
        if (!document.hidden) void fnRef.current()
      }, ms)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
        return
      }
      // Volvió: sincronizar YA (lo típico es que guardó el celular un rato).
      void fnRef.current()
      start()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
}
