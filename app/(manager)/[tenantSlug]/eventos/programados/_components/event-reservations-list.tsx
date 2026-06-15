'use client'

import { ContactButton } from '@/components/messaging/contact-button'
import type { ReservationWithJoins } from '@/lib/salon/types'

export function EventReservationsList({
  tenantSlug,
  reservations,
}: {
  tenantSlug: string
  reservations: ReservationWithJoins[]
}) {
  if (reservations.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin reservas todavía.</p>
  }

  return (
    <ul className="divide-y divide-border/60">
      {reservations.map((r) => {
        const contactPhone = r.customer?.phone ?? r.guest_phone ?? null
        return (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{r.guest_name}</span>
              <span className="text-xs text-muted-foreground">
                {r.reservation_time_local.slice(0, 5)} · {r.primary_manager?.display_name ?? '—'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-base font-semibold tabular-nums">
                {r.actual_guests ?? r.estimated_guests}
              </span>
              {contactPhone ? (
                <ContactButton
                  tenantSlug={tenantSlug}
                  phone={contactPhone}
                  customerId={r.customer?.id}
                  name={r.guest_name}
                  size="icon"
                />
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
