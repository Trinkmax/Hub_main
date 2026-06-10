'use client'

import { Plus, Search, Users } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReservationRow } from '@/lib/events/queries'
import { cancelReservation, checkInReservation } from '@/lib/events/reservations'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { EventStatus } from '@/types/database'
import { NewReservationDialog } from './new-reservation-dialog'

export function ReservationsTab({
  tenantSlug,
  eventId,
  reservations,
  capacity,
  confirmedSeats,
  status,
}: {
  tenantSlug: string
  eventId: string
  reservations: ReservationRow[]
  capacity: number | null
  confirmedSeats: number
  status: EventStatus
}) {
  const [query, setQuery] = useState('')
  const [openNew, setOpenNew] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const visible = reservations
    .filter((r) => r.status === 'confirmed' || r.status === 'checked_in')
    .filter((r) => {
      if (!query.trim()) return true
      const q = query.toLowerCase()
      return r.display_name.toLowerCase().includes(q) || r.customer.phone.includes(q)
    })

  const onCheckin = (id: string) => {
    start(async () => {
      const r = await checkInReservation(tenantSlug, id)
      if (!r.ok) toast.error(r.message)
      else toast.success('Check-in registrado')
    })
  }

  const onConfirmCancel = () => {
    if (!cancelId) return
    start(async () => {
      const r = await cancelReservation(tenantSlug, cancelId)
      if (!r.ok) toast.error(r.message)
      else {
        setCancelId(null)
        toast.success(r.promoted_id ? 'Cancelada · promovió waitlist' : 'Cancelada')
      }
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-secondary/20 p-3">
        <label className="relative flex flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <input
            placeholder="Buscar nombre o teléfono…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-transparent bg-background/60 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <Users className="size-3.5" />
          {capacity === null
            ? `${confirmedSeats} confirmadas`
            : `${confirmedSeats}/${capacity} ocupado`}
        </span>
        <Button
          size="sm"
          disabled={status !== 'published' && status !== 'draft'}
          onClick={() => setOpenNew(true)}
          className="ml-auto gap-1.5"
        >
          <Plus className="size-3.5" />
          Reservar
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
          {query ? 'Sin coincidencias.' : 'Aún no hay reservas confirmadas.'}
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((r) => {
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
                <Avatar className="size-9">
                  <AvatarFallback className="bg-secondary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {r.display_name}
                    {r.source === 'table' ? (
                      <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
                        Mesa
                      </Badge>
                    ) : null}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatPhoneForDisplay(r.customer.phone)}
                  </p>
                </div>
                <Badge variant="secondary" className="tabular-nums">
                  ×{r.guests_count}
                </Badge>
                {r.status === 'checked_in' ? (
                  <Badge className="bg-success text-success-foreground hover:bg-success/90">
                    Check-in OK
                  </Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onCheckin(r.id)}>
                    Check-in
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setCancelId(r.id)}
                >
                  Cancelar
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {openNew ? (
        <NewReservationDialog
          tenantSlug={tenantSlug}
          eventId={eventId}
          onClose={() => setOpenNew(false)}
        />
      ) : null}

      <AlertDialog open={cancelId !== null} onOpenChange={(open) => !open && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              La reserva quedará cancelada. Si hay lista de espera, se promueve al próximo en la
              fila.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmCancel}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Cancelar reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
