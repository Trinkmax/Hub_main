'use client'

import { Cake, DoorClosed, DoorOpen, GlassWater, RotateCcw, Users, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  type ActionState,
  markArrived,
  markClosed,
  markNoShow,
  markSeated,
  revertStatus,
} from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { STATUS_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const STATUS_BADGE: Record<
  SalonReservationStatus,
  'default' | 'secondary' | 'success' | 'info' | 'destructive' | 'muted'
> = {
  pending: 'muted',
  arrived: 'info',
  seated: 'success',
  closed: 'secondary',
  no_show: 'destructive',
  cancelled: 'muted',
}

const STATUS_DOT: Record<SalonReservationStatus, string> = {
  pending: 'bg-muted-foreground/50',
  arrived: 'bg-info animate-pulse',
  seated: 'bg-success',
  closed: 'bg-muted-foreground/40',
  no_show: 'bg-destructive',
  cancelled: 'bg-muted-foreground/30',
}

export function ReservationRow({
  tenantSlug,
  reservation,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [closeOpen, setCloseOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [closeGuests, setCloseGuests] = useState(
    reservation.actual_guests ?? reservation.estimated_guests,
  )

  function run(action: Promise<ActionState>, label = 'Listo.') {
    startTransition(async () => {
      const result = await action
      if (result.ok) {
        toast.success(result.message ?? label)
        router.refresh()
      } else {
        toast.error(result.message ?? 'No se pudo completar la acción.')
      }
    })
  }

  const time = reservation.reservation_time_local.slice(0, 5)
  const guests = reservation.actual_guests ?? reservation.estimated_guests
  const allowed = nextAllowed(reservation.status)
  const isClosed = reservation.status === 'closed'
  const isNoShow = reservation.status === 'no_show'
  const tplColor = reservation.scheduled_event?.template?.color_hex

  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-4',
        (isClosed || isNoShow) && 'opacity-70',
      )}
      style={
        tplColor && !isClosed && !isNoShow ? { boxShadow: `inset 3px 0 0 ${tplColor}` } : undefined
      }
    >
      {/* Hora */}
      <span className="font-mono text-base font-semibold tabular-nums sm:w-14 sm:shrink-0">
        {time}
      </span>

      {/* Datos del huésped */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate font-medium leading-tight', isNoShow && 'line-through')}>
            {reservation.guest_name}
          </span>
          {reservation.cake_count > 0 ? (
            <Cake className="size-3.5 shrink-0 text-pink-500" aria-label="Torta" />
          ) : null}
          {reservation.champagne_count > 0 ? (
            <GlassWater className="size-3.5 shrink-0 text-amber-500" aria-label="Champán" />
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            <span className="font-mono font-semibold tabular-nums text-foreground">{guests}</span>
            {reservation.actual_guests !== null &&
            reservation.actual_guests !== reservation.estimated_guests ? (
              <span className="opacity-70">(est {reservation.estimated_guests})</span>
            ) : null}
          </span>
          <span>{ZONE_LABEL[reservation.zone]}</span>
          {reservation.primary_manager ? (
            <span className="truncate">{reservation.primary_manager.display_name}</span>
          ) : null}
        </div>
      </div>

      {/* Estado */}
      <Badge variant={STATUS_BADGE[reservation.status]} className="shrink-0 gap-1.5">
        <span className={cn('size-1.5 rounded-full', STATUS_DOT[reservation.status])} />
        {STATUS_LABELS[reservation.status]}
      </Badge>

      {/* Acciones de transición */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {allowed.includes('arrived') ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pending}
            onClick={() => run(markArrived(tenantSlug, reservation.id), 'Marcado: llegó.')}
          >
            <DoorOpen className="size-3.5" />
            Llegó
          </Button>
        ) : null}
        {allowed.includes('seated') ? (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={pending}
            onClick={() => run(markSeated(tenantSlug, reservation.id), 'Sentada.')}
          >
            <Users className="size-3.5" />
            Sentar
          </Button>
        ) : null}
        {allowed.includes('closed') ? (
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            disabled={pending}
            onClick={() => {
              setCloseGuests(reservation.actual_guests ?? reservation.estimated_guests)
              setCloseOpen(true)
            }}
          >
            <DoorClosed className="size-3.5" />
            Cerrar
          </Button>
        ) : null}
        {allowed.includes('no_show') ? (
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => run(markNoShow(tenantSlug, reservation.id), 'Marcado: no vino.')}
          >
            <XCircle className="size-3.5" />
            No vino
          </Button>
        ) : null}
        {reservation.status !== 'pending' && reservation.status !== 'cancelled' ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            disabled={pending}
            aria-label="Revertir estado"
            title="Revertir estado"
            onClick={() => setRevertOpen(true)}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {/* Diálogo cerrar mesa con cantidad real */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar mesa de {reservation.guest_name}</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmá la cantidad real de personas. Se recalcula la comisión del gestor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Restar persona"
              onClick={() => setCloseGuests((g) => Math.max(1, g - 1))}
            >
              −
            </Button>
            <div className="min-w-[5rem] text-center">
              <div className="font-mono text-4xl font-semibold tabular-nums">{closeGuests}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                personas reales
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Sumar persona"
              onClick={() => setCloseGuests((g) => Math.min(99, g + 1))}
            >
              +
            </Button>
          </div>
          {closeGuests !== reservation.estimated_guests ? (
            <p className="text-center text-xs text-warning">
              Estimaste {reservation.estimated_guests}, cerrás con {closeGuests}.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseOpen(false)
                run(markClosed(tenantSlug, reservation.id, closeGuests), 'Mesa cerrada.')
              }}
            >
              Cerrar mesa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo revertir estado */}
      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revertir estado</AlertDialogTitle>
            <AlertDialogDescription>{reversibleHint(reservation.status)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRevertOpen(false)
                const target = reverseTarget(reservation.status)
                if (target) {
                  run(revertStatus(tenantSlug, reservation.id, target), 'Estado revertido.')
                }
              }}
            >
              Revertir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const ZONE_LABEL: Record<ReservationWithJoins['zone'], string> = {
  planta_alta: 'Planta Alta',
  planta_baja: 'Planta Baja',
  event_floating: 'Evento',
}

function nextAllowed(status: SalonReservationStatus): SalonReservationStatus[] {
  switch (status) {
    case 'pending':
      return ['arrived', 'no_show']
    case 'arrived':
      return ['seated']
    case 'seated':
      return ['closed']
    default:
      return []
  }
}

function reverseTarget(status: SalonReservationStatus): SalonReservationStatus | null {
  switch (status) {
    case 'arrived':
      return 'pending'
    case 'seated':
      return 'arrived'
    case 'closed':
      return 'seated'
    default:
      return null
  }
}

function reversibleHint(status: SalonReservationStatus): string {
  switch (status) {
    case 'arrived':
      return 'Volver a Pendiente. Se pierde el timestamp de llegada.'
    case 'seated':
      return 'Volver a Llegó. Se pierde el timestamp de sentada.'
    case 'closed':
      return 'Reabrir la mesa. La comisión se recalcula al volver a cerrar.'
    default:
      return 'No reversible.'
  }
}
