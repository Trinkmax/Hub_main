'use client'

import { Users } from 'lucide-react'
import { ContactButton } from '@/components/messaging/contact-button'
import { timeRangeLabel } from '@/lib/salon/format'
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
        const guests = r.actual_guests ?? r.estimated_guests
        return (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{r.guest_name}</span>
              <span className="text-xs text-muted-foreground">
                {timeRangeLabel(r.reservation_time_local, r.reservation_end_time_local)} ·{' '}
                {r.primary_manager?.display_name ?? '—'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Pastilla con ícono: el número suelto no decía de qué era, y
                  pegado al botón se leía como parte del botón. */}
              <span
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-semibold tabular-nums"
                title={`${guests} ${guests === 1 ? 'persona' : 'personas'}`}
              >
                <Users className="size-3.5 text-muted-foreground" aria-hidden />
                {guests}
                <span className="sr-only">{guests === 1 ? 'persona' : 'personas'}</span>
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
