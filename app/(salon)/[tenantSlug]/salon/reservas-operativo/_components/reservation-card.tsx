'use client'

import {
  Cake,
  DoorClosed,
  DoorOpen,
  GlassWater,
  MessageSquareMore,
  RotateCcw,
  User,
  Users,
  XCircle,
} from 'lucide-react'
import { motion } from 'motion/react'
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
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { markArrived, markClosed, markNoShow, markSeated, revertStatus } from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

const STATUS_RING: Record<SalonReservationStatus, string> = {
  pending: 'border-slate-300/80 bg-card hover:border-slate-400 dark:border-slate-700',
  arrived: 'border-blue-400 bg-blue-50/70 dark:bg-blue-950/30',
  seated:
    'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 shadow-md shadow-emerald-500/10',
  closed: 'border-slate-400/60 bg-secondary/40 opacity-70',
  no_show: 'border-rose-400 bg-rose-50/40 dark:bg-rose-950/30 line-through opacity-70',
  cancelled: 'border-zinc-300/60 bg-zinc-100/50 dark:bg-zinc-900/40 line-through opacity-50',
}

const STATUS_DOT: Record<SalonReservationStatus, string> = {
  pending: 'bg-slate-400',
  arrived: 'bg-blue-500 animate-pulse',
  seated: 'bg-emerald-500',
  closed: 'bg-slate-400',
  no_show: 'bg-rose-500',
  cancelled: 'bg-zinc-400',
}

const STATUS_TEXT: Record<SalonReservationStatus, string> = {
  pending: 'Pendiente',
  arrived: 'Llegó',
  seated: 'Sentada',
  closed: 'Cerrada',
  no_show: 'No vino',
  cancelled: 'Cancelada',
}

export function ReservationCard({
  tenantSlug,
  reservation,
  canOperate,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  canOperate: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [closeOpen, setCloseOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
  const [closeGuests, setCloseGuests] = useState(
    reservation.actual_guests ?? reservation.estimated_guests,
  )

  function run(p: Promise<{ ok: boolean; message?: string }>, label = 'Listo.') {
    startTransition(async () => {
      const r = await p
      if (r.ok) toast.success(r.message ?? label)
      else toast.error(r.message ?? 'Falló.')
      setOpen(false)
    })
  }

  const time = reservation.reservation_time_local.slice(0, 5)
  const guests = reservation.actual_guests ?? reservation.estimated_guests
  const tplColor = reservation.scheduled_event?.template?.color_hex
  const allowed = nextAllowed(reservation.status)

  return (
    <>
      <motion.button
        layout
        type="button"
        onClick={() => canOperate && setOpen(true)}
        key={reservation.status}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        whileTap={canOperate ? { scale: 0.97 } : undefined}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        disabled={!canOperate}
        className={cn(
          'group relative flex w-full flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all',
          STATUS_RING[reservation.status],
          canOperate ? 'cursor-pointer' : 'cursor-default',
        )}
        style={
          tplColor && reservation.status !== 'closed' && reservation.status !== 'cancelled'
            ? { boxShadow: `inset 4px 0 0 ${tplColor}` }
            : undefined
        }
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-base font-semibold tabular-nums">{time}</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className={cn('size-1.5 rounded-full', STATUS_DOT[reservation.status])} />
            {STATUS_TEXT[reservation.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <User className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium leading-tight">
            {reservation.guest_name}
          </span>
          {reservation.cake_count > 0 ? <Cake className="size-3.5 shrink-0 text-pink-500" /> : null}
          {reservation.champagne_count > 0 ? (
            <GlassWater className="size-3.5 shrink-0 text-amber-500" />
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            <span className="font-mono tabular-nums font-semibold text-foreground">{guests}</span>
            {reservation.actual_guests !== null &&
            reservation.actual_guests !== reservation.estimated_guests ? (
              <span className="text-[10px] opacity-70">(est {reservation.estimated_guests})</span>
            ) : null}
          </span>
          {reservation.primary_manager ? (
            <span className="truncate">{reservation.primary_manager.display_name}</span>
          ) : null}
        </div>
        {reservation.comments ? (
          <div className="flex items-start gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">
            <MessageSquareMore className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2 leading-snug">{reservation.comments}</span>
          </div>
        ) : null}
      </motion.button>

      {/* Bottom sheet con acciones */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3">
              <span className="font-mono text-xl tabular-nums">{time}</span>
              <span className="truncate">{reservation.guest_name}</span>
            </SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" />
                <span className="font-semibold tabular-nums">{guests}</span> personas
              </span>
              {reservation.primary_manager ? (
                <span>Gestor: {reservation.primary_manager.display_name}</span>
              ) : null}
              {reservation.scheduled_event?.template ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: tplColor }} />
                  {reservation.scheduled_event.template.name}
                </span>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          {reservation.comments ? (
            <div className="mx-4 my-3 rounded-lg bg-secondary/50 p-3 text-sm">
              {reservation.comments}
            </div>
          ) : null}

          {canOperate ? (
            <div className="grid grid-cols-1 gap-2 px-4 pt-2">
              {allowed.includes('arrived') ? (
                <Button
                  size="lg"
                  className="h-14 justify-start gap-3 bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={pending}
                  onClick={() => run(markArrived(tenantSlug, reservation.id), 'Marcado: Llegó')}
                >
                  <DoorOpen className="size-5" />
                  <span className="text-base font-semibold">Llegó</span>
                </Button>
              ) : null}
              {allowed.includes('seated') ? (
                <Button
                  size="lg"
                  className="h-14 justify-start gap-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={pending}
                  onClick={() => run(markSeated(tenantSlug, reservation.id), 'Sentada')}
                >
                  <Users className="size-5" />
                  <span className="text-base font-semibold">Sentar</span>
                </Button>
              ) : null}
              {allowed.includes('closed') ? (
                <Button
                  size="lg"
                  className="h-14 justify-start gap-3 bg-slate-700 hover:bg-slate-800 text-white"
                  disabled={pending}
                  onClick={() => setCloseOpen(true)}
                >
                  <DoorClosed className="size-5" />
                  <span className="text-base font-semibold">Cerrar mesa</span>
                </Button>
              ) : null}
              {allowed.includes('no_show') ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 justify-start gap-3 text-rose-700 dark:text-rose-300"
                  disabled={pending}
                  onClick={() => run(markNoShow(tenantSlug, reservation.id), 'Marcado: No vino')}
                >
                  <XCircle className="size-4" />
                  No vino
                </Button>
              ) : null}
              {reservation.status !== 'pending' && reservation.status !== 'cancelled' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-muted-foreground"
                  onClick={() => setRevertOpen(true)}
                >
                  <RotateCcw className="size-4" />
                  Revertir estado
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <a
                  href={`/${tenantSlug}/reservas/${reservation.id}`}
                  target="_blank"
                  rel="noopener"
                >
                  Editar detalle completo →
                </a>
              </Button>
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Sin permiso para operar. Pedile al cajero/dueño.
            </p>
          )}
        </SheetContent>
      </Sheet>

      {/* Diálogo "cerrar mesa" con cantidad real */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar mesa</AlertDialogTitle>
            <AlertDialogDescription>
              Confirmá la cantidad real de personas. Se recalcula la comisión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-12"
              onClick={() => setCloseGuests(Math.max(1, closeGuests - 1))}
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
              className="size-12"
              onClick={() => setCloseGuests(Math.min(99, closeGuests + 1))}
            >
              +
            </Button>
          </div>
          {closeGuests !== reservation.estimated_guests ? (
            <p className="text-center text-xs text-amber-700 dark:text-amber-300">
              Estimaste {reservation.estimated_guests}, cerrás con {closeGuests}.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseOpen(false)
                run(markClosed(tenantSlug, reservation.id, closeGuests), 'Mesa cerrada')
              }}
            >
              Cerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo revertir */}
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
                  run(revertStatus(tenantSlug, reservation.id, target), 'Revertida')
                }
              }}
            >
              Revertir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function nextAllowed(status: SalonReservationStatus): SalonReservationStatus[] {
  switch (status) {
    case 'pending':
      return ['arrived', 'no_show']
    case 'arrived':
      return ['seated']
    case 'seated':
      return ['closed']
    case 'closed':
      return []
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
      return 'Volver a Pendiente. Los timestamps de llegada se pierden.'
    case 'seated':
      return 'Volver a Llegó. El timestamp de sentada se pierde.'
    case 'closed':
      return 'Reabrir la mesa. La comisión se recalcula al volver a cerrar.'
    default:
      return 'No reversible.'
  }
}
