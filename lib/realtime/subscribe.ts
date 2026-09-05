'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient, realtimeAuthReady } from '@/lib/supabase/browser'

type Filter = `${string}=eq.${string}`

export type SubscribeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

export type SubscribeOptions = {
  channel: string
  events: Array<{
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    table: string
    filter?: Filter
    onChange: (payload: unknown) => void
  }>
  /**
   * Estado real del canal (JOIN hecho, error, timeout, cerrado). Sirve para
   * un indicador "en vivo" honesto y para re-sincronizar tras una reconexión:
   * postgres_changes NO reproduce lo que pasó mientras el socket estuvo caído.
   */
  onStatus?: (status: SubscribeStatus, error?: Error) => void
}

/**
 * Suscribe a uno o varios eventos postgres_changes y devuelve un cleanup.
 * Pensado para usar dentro de useEffect.
 *
 * Espera el JWT del usuario antes del JOIN: los claims de postgres_changes se
 * fijan al suscribirse y con claims anon RLS filtra todos los eventos.
 */
export function subscribeChanges(opts: SubscribeOptions): () => void {
  const supabase = createClient()
  let ch: RealtimeChannel | null = null
  let disposed = false

  void realtimeAuthReady().then(() => {
    if (disposed) return
    let channel: RealtimeChannel = supabase.channel(opts.channel)
    for (const evt of opts.events) {
      channel = channel.on(
        // biome-ignore lint/suspicious/noExplicitAny: Supabase realtime types are loose
        'postgres_changes' as any,
        {
          event: evt.event,
          schema: 'public',
          table: evt.table,
          ...(evt.filter ? { filter: evt.filter } : {}),
        },
        evt.onChange,
      )
    }
    channel.subscribe((status, error) => {
      if (disposed) return
      opts.onStatus?.(status as SubscribeStatus, error)
    })
    ch = channel
  })

  return () => {
    disposed = true
    if (ch) void supabase.removeChannel(ch)
  }
}
