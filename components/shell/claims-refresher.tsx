'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/browser'

const STORAGE_KEY = 'hub_claims_refreshed_at'
const MIN_INTERVAL_MS = 60_000

/**
 * El proxy rutea por rol leyendo `app_metadata.tenants` del JWT, que sólo se
 * regenera al refrescar el access token (≤1 h). Si el owner cambia el rol de
 * alguien, ese alguien queda hasta 1 h con el rol viejo en el JWT: el proxy lo
 * manda al workspace equivocado y las pages (que sí leen el rol fresco de la
 * DB) le dan 404.
 *
 * El layout monta este componente SOLO cuando el rol del JWT difiere del rol
 * que devolvió `get_tenant_access`. Fuerza un refresh de sesión desde el
 * browser (que sí puede escribir cookies) — el hook re-inyecta los claims — y
 * re-renderiza. Con el guard de 60 s no puede loopear aunque el hook no esté
 * habilitado en el proyecto (en ese caso el layout tampoco lo montaría: sin
 * claim, `tenants` es null y no hay nada que comparar).
 */
export function ClaimsRefresher() {
  const router = useRouter()

  useEffect(() => {
    let last = 0
    try {
      last = Number(window.sessionStorage.getItem(STORAGE_KEY) ?? 0)
    } catch {
      // sessionStorage bloqueado (modo privado estricto): igual refrescamos una vez.
    }
    if (Date.now() - last < MIN_INTERVAL_MS) return
    try {
      window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {
      // ídem
    }

    let cancelled = false
    void createClient()
      .auth.refreshSession()
      .then(({ error }) => {
        if (cancelled || error) return
        router.refresh()
      })
    return () => {
      cancelled = true
    }
  }, [router])

  return null
}
