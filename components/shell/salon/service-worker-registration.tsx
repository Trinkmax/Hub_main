'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker (`/sw.js`) cuando montamos el shell del salón.
 * No-op en navegadores sin soporte. Errores se loggean pero no rompen la UI.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    let cancelled = false

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        if (cancelled) return
        // Forzar actualización si hay versión nueva en el registro
        registration.update().catch(() => {})
      } catch (error) {
        console.error('[sw] registration failed', error)
      }
    }

    void register()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
