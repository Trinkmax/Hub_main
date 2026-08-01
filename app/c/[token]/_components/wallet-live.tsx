'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Mantiene la billetera al día sin que el socio recargue.
 *
 * El problema concreto: el socio genera el QR de canje, se lo muestra al mozo, el
 * mozo lo valida — y en su pantalla seguía el mismo QR y los mismos puntos. Lo
 * mismo cuando el cajero le acredita el consumo: tenía que recargar para verlo.
 *
 * No es Realtime de Supabase porque no puede serlo: esta pantalla es anónima (la
 * identidad es el `qr_token`, no una sesión), y `postgres_changes` con claims
 * `anon` no entrega ningún evento salvo que se abran policies de lectura sobre
 * `customers` y `reward_redemptions` — un precio altísimo por un refresh.
 *
 * En su lugar: se consulta un hash de unos bytes y sólo cuando cambia se dispara
 * el `router.refresh()`, que es lo caro. El ritmo se adapta al momento:
 *
 *   · Con el QR en pantalla → cada 3 s. Es el momento ansioso: el mozo está
 *     escaneando ahí mismo y el socio mira la pantalla esperando.
 *   · El resto del tiempo → cada 20 s. Alcanza para que los puntos aparezcan
 *     mientras todavía está en la caja.
 *   · Con la pestaña en segundo plano → nada. Y al volver, consulta al toque:
 *     el caso típico es que guardó el celular mientras el mozo validaba.
 */
const FAST_MS = 3_000
const SLOW_MS = 20_000

export function WalletLive({
  qrToken,
  rev,
  urgent,
}: {
  qrToken: string
  /** Hash del estado con el que se renderizó esta pantalla. */
  rev: string | null
  /** Hay un QR de canje vivo: el cambio puede llegar en cualquier segundo. */
  urgent: boolean
}): null {
  const router = useRouter()
  // En un ref para que cambiar de ritmo no reinicie el ciclo ni pierda el
  // baseline entre renders.
  const revRef = useRef(rev)
  const refreshingRef = useRef(false)

  useEffect(() => {
    revRef.current = rev
    refreshingRef.current = false
  }, [rev])

  useEffect(() => {
    if (!qrToken) return
    let cancelled = false
    let timer = 0

    const check = async () => {
      if (cancelled || document.hidden || refreshingRef.current) return
      try {
        const res = await fetch(`/api/wallet/${qrToken}/pulse`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { rev?: string | null }
        const next = body.rev ?? null
        // `null` es "no pudimos calcularlo": no vale como cambio, o entraríamos
        // en un bucle de refresh contra un error transitorio.
        if (!next || next === revRef.current) return
        revRef.current = next
        refreshingRef.current = true
        router.refresh()
      } catch {
        // Sin señal, celular en el subsuelo del bar: se reintenta al próximo tick.
      }
    }

    const loop = () => {
      timer = window.setTimeout(
        async () => {
          await check()
          if (!cancelled) loop()
        },
        urgent ? FAST_MS : SLOW_MS,
      )
    }
    loop()

    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [qrToken, urgent, router])

  return null
}
