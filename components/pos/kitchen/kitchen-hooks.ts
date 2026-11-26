'use client'

import { useEffect, useState } from 'react'

/**
 * La hora de la base, avanzando acá. El reloj de una tele o de una tablet puede estar corrido: los
 * minutos de cada comanda se cuentan contra la hora que mandó el servidor.
 */
export function useServerNow(serverNow: string, everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.parse(serverNow))
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now()
    setNow(Date.now() + offset)
    const timer = window.setInterval(() => setNow(Date.now() + offset), everyMs)
    return () => window.clearInterval(timer)
  }, [serverNow, everyMs])
  return now
}

/** Que la pantalla no se apague sola. Si el navegador no puede, no pasa nada. */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    const request = async () => {
      if (gone || lock || document.hidden) return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (gone) {
          void next.release().catch(() => {})
          return
        }
        lock = next
        next.addEventListener('release', () => {
          if (lock === next) lock = null
        })
      } catch {
        // batería baja, pestaña sin foco o permiso negado: se vuelve a intentar al volver
      }
    }
    // El navegador lo suelta al esconder la pestaña: hay que pedirlo de nuevo al volver.
    const onVisibility = () => {
      if (!document.hidden) void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', onVisibility)
      void lock?.release().catch(() => {})
      lock = null
    }
  }, [])
}
