'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'

export function LiveStats({ broadcastId }: { broadcastId: string }) {
  const router = useRouter()
  const [client] = useState(() => createClient())
  useEffect(() => {
    const channel = client
      .channel(`broadcast-${broadcastId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'broadcast_recipients',
          filter: `broadcast_id=eq.${broadcastId}`,
        },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'broadcasts',
          filter: `id=eq.${broadcastId}`,
        },
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [client, broadcastId, router])
  return null
}
