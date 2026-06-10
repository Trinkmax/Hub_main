'use client'

import { ListChecks } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  const [pending, start] = useTransition()
  const [removeId, setRemoveId] = useState<string | null>(null)

  const onConfirmRemove = () => {
    if (!removeId) return
    start(async () => {
      const r = await cancelReservation(tenantSlug, removeId)
      if (!r.ok) toast.error(r.message)
      else {
        setRemoveId(null)
        toast.success('Quitado de la lista.')
      }
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
    <>
      <ul className="divide-y divide-border/60">
        {reservations
          .sort((a, b) => (a.waitlist_position ?? 0) - (b.waitlist_position ?? 0))
          .map((r) => {
            const initials = r.display_name
              .split(' ')
              .map((w) => w[0] ?? '')
              .slice(0, 2)
              .join('')
              .toUpperCase()
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
                  <p className="text-sm font-medium">{r.display_name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatPhoneForDisplay(r.customer.phone)} · ×{r.guests_count}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setRemoveId(r.id)}
                >
                  Quitar
                </Button>
              </li>
            )
          })}
      </ul>

      <AlertDialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar de la waitlist?</AlertDialogTitle>
            <AlertDialogDescription>
              La persona dejará de estar en la lista de espera de este evento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmRemove}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
