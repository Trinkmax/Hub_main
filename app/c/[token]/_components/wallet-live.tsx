'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/browser'

/**
 * Mantiene la billetera al día sin que el socio recargue.
 *
 * El problema concreto: el socio genera el QR de canje, se lo muestra al mozo, el
 * mozo lo valida — y en su pantalla seguía el mismo QR y los mismos puntos. Lo
 * mismo cuando el cajero le acredita el consumo.
 *
 * Cómo se entera ahora (migración 20260827200000_wallet_broadcast):
 *
 *   1. **Realtime Broadcast** (camino principal, cero funciones de Vercel): la DB
 *      publica un ping sin datos en el topic público `wallet:<sha256(qr_token)>`
 *      cada vez que cambian puntos, nivel, canjes o sellos del socio. La pantalla
 *      es anónima, pero un topic público con nombre no adivinable alcanza: el
 *      hash no es reversible y el ping no lleva nada. Al recibirlo, refresh.
 *   2. **Polling de seguridad** contra /api/wallet/[token]/pulse, LENTO: antes
 *      era cada 3 s con el QR abierto — 20 invocaciones por minuto por socio, el
 *      mayor consumidor de la cuenta de Vercel. Con el socket conectado alcanza
 *      con 45 s (QR vivo) / 3 min; sin socket, 15 s / 60 s. En segundo plano,
 *      nada; al volver, un chequeo al toque.
 */
const REFRESH_GRACE_MS = 6_000
const BROADCAST_DEBOUNCE_MS = 400

function pollDelay(live: boolean, urgent: boolean): number {
  if (live) return urgent ? 45_000 : 180_000
  return urgent ? 15_000 : 60_000
}

/** Mismo hash que `public.wallet_topic` en la DB. Null si no hay WebCrypto (http plano). */
async function walletTopic(qrToken: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(qrToken))
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `wallet:${hex}`
  } catch {
    return null
  }
}

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
  // En refs para que cambiar de ritmo no reinicie el ciclo ni pierda el
  // baseline entre renders.
  const revRef = useRef(rev)
  const refreshingRef = useRef(false)
  const liveRef = useRef(false)
  const urgentRef = useRef(urgent)

  useEffect(() => {
    revRef.current = rev
    refreshingRef.current = false
  }, [rev])

  useEffect(() => {
    urgentRef.current = urgent
  }, [urgent])

  useEffect(() => {
    if (!qrToken) return
    let cancelled = false
    let timer = 0
    let grace = 0
    let debounce = 0
    let channel: RealtimeChannel | null = null

    // Refresh "seguro": marca que estamos refrescando y arma la red de
    // seguridad. Sin el techo, si el refresh devuelve el mismo `rev` (payload
    // cacheado, `computeWalletRev` que falló) la bandera nunca bajaba y la
    // billetera dejaba de actualizarse sola.
    const refreshNow = () => {
      if (cancelled) return
      refreshingRef.current = true
      window.clearTimeout(grace)
      grace = window.setTimeout(() => {
        refreshingRef.current = false
      }, REFRESH_GRACE_MS)
      router.refresh()
    }

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
        refreshNow()
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
        pollDelay(liveRef.current, urgentRef.current),
      )
    }

    // Broadcast: la DB avisa "cambió algo" → refresh. Varios triggers por una
    // misma acción (visita + puntos + nivel) llegan juntos: se agrupan.
    void walletTopic(qrToken).then((topic) => {
      if (cancelled || !topic) return
      const supabase = createClient()
      channel = supabase
        .channel(topic)
        .on('broadcast', { event: 'changed' }, () => {
          if (cancelled) return
          window.clearTimeout(debounce)
          debounce = window.setTimeout(() => {
            // Con un aviso real no hace falta consultar el pulse: refrescamos.
            refreshingRef.current = false
            refreshNow()
          }, BROADCAST_DEBOUNCE_MS)
        })
        .subscribe((status) => {
          liveRef.current = status === 'SUBSCRIBED'
        })
    })

    // Un chequeo ya, sin esperar el primer tick: al montar con el QR abierto el
    // mozo puede haber validado hace un segundo.
    void check()
    loop()

    const onVisible = () => {
      if (!document.hidden) void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.clearTimeout(grace)
      window.clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      if (channel) void createClient().removeChannel(channel)
    }
  }, [qrToken, router])

  return null
}
