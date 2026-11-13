'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'

export type PokeWhat = 'floor' | 'kitchen' | 'menu'
export type LiveStatus = 'connecting' | 'live' | 'offline'

/**
 * Avisos en vivo de una sucursal. La base manda un «algo cambió» sin datos (canal `pos:<sucursal>`)
 * cada vez que una mesa, una tanda o la carta se mueven, y cada pantalla vuelve a leer lo suyo.
 *
 * Devuelve el estado real del canal para poder decirlo en pantalla: si se corta, se nota. Al volver,
 * llama a `onPoke` una vez (lo que pasó mientras estuvo caído no se reenvía).
 */
export function usePosPoke(
  branchId: string | null,
  onPoke: (what: PokeWhat, sessionId: string | null) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const handler = useRef(onPoke)

  useEffect(() => {
    handler.current = onPoke
  }, [onPoke])

  useEffect(() => {
    if (!branchId) return
    const supabase = createClient()
    let wasDown = false
    let channel: RealtimeChannel | null = supabase
      .channel(`pos:${branchId}`)
      .on('broadcast', { event: 'poke' }, (message) => {
        const payload = (message.payload ?? {}) as { what?: PokeWhat; session_id?: string | null }
        handler.current(payload.what ?? 'floor', payload.session_id ?? null)
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          setStatus('live')
          if (wasDown) handler.current('floor', null)
          wasDown = false
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          wasDown = true
          setStatus('offline')
        }
      })

    const onOffline = () => setStatus('offline')
    const onOnline = () => {
      wasDown = true
      setStatus('connecting')
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) setStatus('offline')

    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      if (channel) void supabase.removeChannel(channel)
      channel = null
    }
  }, [branchId])

  return status
}
