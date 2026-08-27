'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/** Mínimo tiempo escondida para que valga la pena re-pedir la página. */
const MIN_HIDDEN_MS = 10_000

/**
 * Re-pide la página al server cuando la pestaña/app vuelve a primer plano
 * después de ≥10 s escondida, o cuando el browser la restaura del bfcache.
 *
 * Es la contracara de `experimental.staleTimes.dynamic` (next.config.ts): el
 * Client Router Cache hace instantáneo volver a una pantalla reciente, pero un
 * mozo que bloquea el celular y lo desbloquea dos minutos después tiene que
 * ver el salón como está AHORA, no como estaba. `router.refresh()` no toca el
 * estado de los client components; sólo trae el árbol RSC nuevo.
 */
export function RefreshOnReturn() {
  const router = useRouter()
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const since = hiddenAt.current
      hiddenAt.current = null
      if (since !== null && Date.now() - since >= MIN_HIDDEN_MS) router.refresh()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [router])

  return null
}
