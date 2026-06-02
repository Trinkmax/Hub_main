'use client'

import { AlertTriangle, CheckCircle2, Circle, Clock4 } from 'lucide-react'
import { ReservationStatusControls } from '@/components/reservations/reservation-status-controls'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ReservationDetailSidebar({
  tenantSlug,
  reservation,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
}) {
  return (
    <aside className="space-y-4">
      <ReservationStatusControls tenantSlug={tenantSlug} reservation={reservation} />

      {/* Timeline operativo */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <header className="mb-3 flex items-center gap-2">
          <Clock4 className="size-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Timeline</span>
        </header>
        <ol className="space-y-2 text-sm">
          <Step label="Creada" at={reservation.created_at} done />
          <Step label="Llegó" at={reservation.arrived_at} done={!!reservation.arrived_at} />
          <Step label="Sentada" at={reservation.seated_at} done={!!reservation.seated_at} />
          <Step label="Cerrada" at={reservation.closed_at} done={!!reservation.closed_at} />
          {reservation.cancelled_at ? (
            <Step
              label="Cancelada"
              at={reservation.cancelled_at}
              done
              negative
              note={reservation.cancelled_reason ?? undefined}
            />
          ) : null}
        </ol>
      </section>
    </aside>
  )
}

function Step({
  label,
  at,
  done,
  negative,
  note,
}: {
  label: string
  at: string | null
  done: boolean
  negative?: boolean
  note?: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5">
        {done ? (
          negative ? (
            <AlertTriangle className="size-4 text-rose-500" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-500" />
          )
        ) : (
          <Circle className="size-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-sm', done ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatRelative(at)}
          </span>
        </div>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
    </li>
  )
}
