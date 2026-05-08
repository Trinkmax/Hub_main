'use client'

import { Bell, Receipt, Users } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { subscribeChanges } from '@/lib/realtime/subscribe'
import { useDebouncedRefresh } from '@/lib/realtime/use-debounced-refresh'
import type { WaiterSessionRow } from '@/lib/sessions-waiter/queries'

// Cada 30s también re-fetcheamos por si perdimos un payload (Realtime no
// garantiza delivery 100%). Esto es safety net, no la fuente principal.
const SAFETY_NET_INTERVAL_MS = 30_000
const REALTIME_DEBOUNCE_MS = 500

export function SessionsGrid({
  tenantSlug,
  tenantId,
  initialSessions,
}: {
  tenantSlug: string
  tenantId: string
  initialSessions: WaiterSessionRow[]
}) {
  const [sessions, setSessions] = useState(initialSessions)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sessions/list?tenant_id=${encodeURIComponent(tenantId)}`, {
      cache: 'no-store',
    })
    if (res.ok) {
      const data = (await res.json()) as { sessions: WaiterSessionRow[] }
      setSessions(data.sessions)
    }
  }, [tenantId])

  // Agrupar varios payloads que llegan juntos en un único refresh.
  // (Las counts de la vista vienen con joins múltiples; un optimistic merge
  // puro requeriría replicar la lógica del query — overkill por ahora.)
  const debouncedRefresh = useDebouncedRefresh(refresh, REALTIME_DEBOUNCE_MS)

  useEffect(() => {
    const cleanup = subscribeChanges({
      channel: `waiter-${tenantId}`,
      events: [
        {
          event: '*',
          table: 'tickets',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        {
          event: '*',
          table: 'table_sessions',
          filter: `tenant_id=eq.${tenantId}`,
          onChange: debouncedRefresh,
        },
        { event: 'INSERT', table: 'table_session_events', onChange: debouncedRefresh },
      ],
    })

    // Safety net: poll cada 30s aunque no haya tráfico realtime.
    const safetyNet = window.setInterval(() => {
      void refresh()
    }, SAFETY_NET_INTERVAL_MS)

    return () => {
      cleanup()
      window.clearInterval(safetyNet)
    }
  }, [tenantId, refresh, debouncedRefresh])

  if (sessions.length === 0) {
    return (
      <EmptyState
        title="Por ahora no hay mesas abiertas"
        description="Cuando un comensal escanee un QR de mesa, va a aparecer acá."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => (
        <Link
          key={s.id}
          href={`/${tenantSlug}/salon/mesas/${s.id}`}
          className="card-hairline group block rounded-xl border border-border/70 bg-card/85 p-4 shadow-xs transition-[transform,box-shadow,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:bg-card hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-lg font-semibold tracking-tight">
                {s.table_label ?? 'Mesa'}
              </h3>
              <p className="text-xs text-muted-foreground">
                Abierta{' '}
                {new Date(s.opened_at).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <p className="font-serif text-xl font-semibold tabular-nums">
              ${(s.total_cents / 100).toFixed(2)}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="gap-1">
              <Users className="size-3" aria-hidden />
              {s.guest_count}
            </Badge>
            {s.pending_tickets > 0 && (
              <Badge variant="warning" className="gap-1">
                <Bell className="size-3" aria-hidden />
                {s.pending_tickets} pendientes
              </Badge>
            )}
            {s.bill_requested && (
              <Badge variant="destructive" className="gap-1">
                <Receipt className="size-3" aria-hidden />
                Pidieron cuenta
              </Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
