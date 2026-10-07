'use client'

import {
  ChevronDown,
  ClipboardEdit,
  DoorClosed,
  DoorOpen,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  cancelSalonReservation,
  markArrived,
  markClosed,
  markNoShow,
  markSeated,
  revertStatus,
  updateActualGuests,
} from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { StatusPill } from './status-pill'

/**
 * Controles operativos del comensal (Llegó / Sentar / Cerrar mesa + revertir
 * + No vino + cantidad real + cancelar). Extraído del sidebar de detalle para
 * reusarlo en el popup de gestión rápida y en el popup del día del calendario.
 *
 * `onChanged` se llama tras cada acción exitosa: el popup lo usa para refrescar
 * su data; el sidebar lo omite (las Server Actions ya hacen revalidatePath).
 */
export function ReservationStatusControls({
  tenantSlug,
  reservation,
  onChanged,
  showActualGuestsEditor = true,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  onChanged?: () => void
  /**
   * El quick view trae su propio stepper de personas (estimadas o reales según
   * estado), así que oculta este editor para no duplicarlo en el mismo popup.
   */
  showActualGuestsEditor?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [actualGuests, setActualGuests] = useState<number>(
    reservation.actual_guests ?? reservation.estimated_guests,
  )

  function run(p: Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const r = await p
      if (r.ok) {
        toast.success(r.message ?? 'Listo.')
        onChanged?.()
      } else toast.error(r.message ?? 'Falló.')
    })
  }

  const allowedNext: SalonReservationStatus[] = (() => {
    switch (reservation.status) {
      case 'pending':
        return ['arrived', 'no_show', 'cancelled']
      case 'arrived':
        return ['seated', 'pending']
      case 'seated':
        return ['closed', 'arrived']
      case 'closed':
        return ['seated']
      case 'no_show':
      case 'cancelled':
        return []
    }
  })()

  return (
    <div className="space-y-4">
      {/* Estado actual + acciones */}
      <section className="rounded-xl border border-border/70 bg-card p-4">
        <header className="mb-3 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Estado</span>
          <StatusPill status={reservation.status} />
        </header>

        <div className="grid grid-cols-1 gap-2">
          {(['arrived', 'seated', 'closed'] as const).map((to) => {
            const enabled = allowedNext.includes(to)
            const icon = to === 'arrived' ? DoorOpen : to === 'seated' ? Users : DoorClosed
            const Icon = icon
            const label = to === 'arrived' ? 'Llegó' : to === 'seated' ? 'Sentar' : 'Cerrar mesa'
            if (to === 'closed') {
              return (
                <ClosedDialog
                  key={to}
                  disabled={!enabled || pending}
                  defaultGuests={actualGuests}
                  estimated={reservation.estimated_guests}
                  onConfirm={(n) => {
                    setActualGuests(n)
                    run(markClosed(tenantSlug, reservation.id, n))
                  }}
                />
              )
            }
            return (
              <Button
                key={to}
                disabled={!enabled || pending}
                className={cn(
                  'h-11 justify-start gap-3',
                  to === 'arrived'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white',
                )}
                onClick={() => {
                  if (to === 'arrived') run(markArrived(tenantSlug, reservation.id))
                  if (to === 'seated') run(markSeated(tenantSlug, reservation.id))
                }}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            )
          })}

          {allowedNext.includes('pending') ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'pending' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Revertir a Pendiente
            </Button>
          ) : null}
          {allowedNext.includes('arrived') && reservation.status === 'seated' ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'arrived' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Revertir a Llegó
            </Button>
          ) : null}
          {allowedNext.includes('seated') && reservation.status === 'closed' ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs"
              disabled={pending}
              onClick={() =>
                run(revertStatus(tenantSlug, reservation.id, 'seated' as SalonReservationStatus))
              }
            >
              <ChevronDown className="size-4 rotate-90" />
              Reabrir mesa
            </Button>
          ) : null}

          {reservation.status !== 'no_show' &&
          reservation.status !== 'cancelled' &&
          allowedNext.includes('no_show') ? (
            <Button
              variant="outline"
              className="h-9 justify-start gap-3 text-xs text-muted-foreground"
              disabled={pending}
              onClick={() => run(markNoShow(tenantSlug, reservation.id))}
            >
              <XCircle className="size-4" />
              No vino
            </Button>
          ) : null}
        </div>
      </section>

      {/* Cantidad real inline editor */}
      {showActualGuestsEditor &&
      reservation.status !== 'cancelled' &&
      reservation.status !== 'no_show' ? (
        <section className="rounded-xl border border-border/70 bg-card p-4">
          <header className="mb-3 flex items-center gap-2">
            <ClipboardEdit className="size-4 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Cantidad real
            </span>
          </header>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={99}
              value={actualGuests}
              onChange={(e) => setActualGuests(Math.max(1, Math.min(99, Number(e.target.value))))}
              className="h-10 w-20 text-center text-base tabular-nums"
            />
            <Button
              size="sm"
              disabled={pending || actualGuests === reservation.actual_guests}
              onClick={() =>
                run(
                  updateActualGuests(tenantSlug, {
                    id: reservation.id,
                    actual_guests: actualGuests,
                  } as Record<string, unknown>),
                )
              }
            >
              Guardar
            </Button>
          </div>
          {reservation.actual_guests === null ? (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Sin cantidad real cargada — la comisión se calcula sobre{' '}
              {reservation.estimated_guests} estimadas.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Real cargada: {reservation.actual_guests} (estimadas {reservation.estimated_guests}).
            </p>
          )}
        </section>
      ) : null}

      {/* Cancelar */}
      {reservation.status !== 'cancelled' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full gap-2 text-rose-700 hover:text-rose-700 dark:text-rose-300 dark:hover:text-rose-300"
              disabled={pending}
            >
              <Trash2 className="size-4" />
              Cancelar reserva
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
              <AlertDialogDescription>
                Liberá el cupo del bucket. La comisión asociada se reversa automáticamente (excepto
                las entries ya pagadas).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <CancelReasonForm
              onSubmit={(reason) =>
                run(
                  cancelSalonReservation(tenantSlug, {
                    id: reservation.id,
                    reason,
                  } as Record<string, unknown>),
                )
              }
            />
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

function ClosedDialog({
  disabled,
  defaultGuests,
  estimated,
  onConfirm,
}: {
  disabled: boolean
  defaultGuests: number
  estimated: number
  onConfirm: (n: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [guests, setGuests] = useState(defaultGuests)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          className="h-11 justify-start gap-3 bg-slate-700 hover:bg-slate-800 text-white"
        >
          <DoorClosed className="size-4" />
          Cerrar mesa
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cerrar mesa</AlertDialogTitle>
          <AlertDialogDescription>
            Confirmá la cantidad real de personas que pasaron por la mesa. Se recalcula la comisión.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4 flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setGuests(Math.max(1, guests - 1))}
          >
            −
          </Button>
          <div className="text-center">
            <div className="font-mono text-3xl font-semibold tabular-nums">{guests}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              personas reales
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setGuests(Math.min(99, guests + 1))}
          >
            +
          </Button>
        </div>
        {guests !== estimated ? (
          <p className="text-center text-xs text-amber-700 dark:text-amber-300">
            Estimaste {estimated}, vas a cerrar con {guests}.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Volver</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(guests)
              setOpen(false)
            }}
          >
            Cerrar mesa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CancelReasonForm({ onSubmit }: { onSubmit: (reason?: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <>
      <div className="space-y-2 py-4">
        <Input
          placeholder="Motivo (opcional)…"
          value={reason}
          maxLength={280}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Volver</AlertDialogCancel>
        <AlertDialogAction
          className="bg-rose-600 hover:bg-rose-700"
          onClick={() => onSubmit(reason.trim() || undefined)}
        >
          Cancelar reserva
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}
