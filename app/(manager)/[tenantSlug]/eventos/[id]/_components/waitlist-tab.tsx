'use client'

import { ListChecks } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import type { ReservationRow } from '@/lib/events/queries'
import { cancelReservation } from '@/lib/events/reservations'
import { formatPhoneForDisplay } from '@/lib/phone'

export function WaitlistTab({
  tenantSlug,
  reservations,
}: {
  tenantSlug: string
  reservations: ReservationRow[]
}) {
  const [, start] = useTransition()

  const onCancel = (id: string) => {
    if (!confirm('¿Quitar de la waitlist?')) return
    start(async () => {
      const r = await cancelReservation(tenantSlug, id)
      if (!r.ok) toast.error(r.message)
      else toast.success('Quitado de la lista.')
    })
  }

  if (reservations.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Sin lista de espera"
        description="Cuando se llene el cupo, los próximos en anotarse van a aparecer acá."
        className="m-3 border-0 bg-transparent"
      />
    )
  }

  return (
    <ul className="divide-y divide-border/60">
      {reservations
        .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0))
        .map((r) => {
          const initials =
            `${r.customer.first_name?.[0] ?? ''}${r.customer.last_name?.[0] ?? ''}`.toUpperCase()
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/30"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-warning/15 font-mono text-xs font-bold text-warning">
                {r.waitlist_position ?? '?'}
              </span>
              <Avatar className="size-9">
                <AvatarFallback className="bg-secondary text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {r.customer.first_name} {r.customer.last_name}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {formatPhoneForDisplay(r.customer.phone)} · ×{r.guests_count}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onCancel(r.id)}
              >
                Quitar
              </Button>
            </li>
          )
        })}
    </ul>
  )
}
