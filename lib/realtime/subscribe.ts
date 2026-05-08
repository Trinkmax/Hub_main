'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser'

type Filter = `${string}=eq.${string}`

export type SubscribeOptions = {
  channel: string
  events: Array<{
    event: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
    table: string
    filter?: Filter
    onChange: (payload: unknown) => void
  }>
}

/**
 * Suscribe a uno o varios eventos postgres_changes y devuelve un cleanup.
 * Pensado para usar dentro de useEffect.
 */
export function subscribeChanges(opts: SubscribeOptions): () => void {
  const supabase = createClient()
  let ch: RealtimeChannel = supabase.channel(opts.channel)
  for (const evt of opts.events) {
    ch = ch.on(
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
  ch.subscribe()
  return () => {
    void supabase.removeChannel(ch)
  }
}
