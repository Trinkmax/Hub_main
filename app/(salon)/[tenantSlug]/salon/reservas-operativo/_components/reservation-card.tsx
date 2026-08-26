'use client'

import {
  Cake,
  Check,
  GlassWater,
  Loader2,
  MessageSquareMore,
  Minus,
  Plus,
  RotateCcw,
  Users,
  XCircle,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { markArrived, markNoShow, revertStatus, updateActualGuests } from '@/lib/salon/actions'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'

/**
 * Una reserva en el pase de lista de la noche.
 *
 * El mozo tiene UN gesto: "Llegó", en la card, sin abrir nada. Antes eran dos
 * toques para eso (tap en la card → sheet → tap en Llegó) y siete para cerrar
 * una mesa, con una escalera de estados —pendiente, llegó, sentada, cerrada—
 * que en la práctica nadie subía entera: 24 de 29 reservas quedaron en pendiente
 * para siempre.
 *
 * Sentar y cerrar mesa salieron del salón. La comisión del gestor ahora se
 * liquida al marcar "Llegó" (migración 20260826150000), así que nadie tiene que
 * cerrar nada para que los números del mes salgan bien. El dueño sigue pudiendo
 * cerrar desde /[slug]/operativo si lo necesita para su contabilidad.
 *
 * Lo que queda detrás del tap en la card es la excepción: no vino, se
 * equivocaron de mesa, o vinieron más/menos personas que las reservadas.
 */

const STATUS_STYLE: Record<SalonReservationStatus, string> = {
  pending: 'border-border bg-card',
  arrived: 'border-success/50 bg-success/8',
  // Sentada y cerrada ya no se marcan desde el salón, pero pueden venir del
  // manager: se muestran como "adentro" / "terminada", sin acciones.
  seated: 'border-success/50 bg-success/8',
  closed: 'border-border/60 bg-secondary/40 opacity-70',
  no_show: 'border-destructive/40 bg-destructive/8 opacity-75',
  cancelled: 'border-border/50 bg-muted/40 opacity-50',
}

const STATUS_TEXT: Record<SalonReservationStatus, string> = {
  pending: 'Esperando',
  arrived: 'Llegó',
  seated: 'Adentro',
  closed: 'Terminada',
  no_show: 'No vino',
  cancelled: 'Cancelada',
}

/** Estados en los que el cliente ya está en el bar (nada más que hacer). */
function isHere(status: SalonReservationStatus): boolean {
  return status === 'arrived' || status === 'seated' || status === 'closed'
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
  const [guests, setGuests] = useState(reservation.actual_guests ?? reservation.estimated_guests)

  function run(p: Promise<{ ok: boolean; message?: string }>, label: string) {
    startTransition(async () => {
      const r = await p
      if (r.ok) toast.success(label)
      else toast.error(r.message ?? 'No pudimos guardarlo.')
      setOpen(false)
    })
  }

  const time = reservation.reservation_time_local.slice(0, 5)
  const shownGuests = reservation.actual_guests ?? reservation.estimated_guests
  const here = isHere(reservation.status)
  const canArrive = canOperate && reservation.status === 'pending'
  const tplColor = reservation.scheduled_event?.template?.color_hex
  const extras =
    (reservation.cake_count > 0 ? 1 : 0) + (reservation.champagne_count > 0 ? 1 : 0) > 0

  return (
    <>
      <motion.li
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={cn(
          'relative flex items-center gap-3 rounded-2xl border p-3 transition-colors',
          STATUS_STYLE[reservation.status],
        )}
        style={
          tplColor && reservation.status !== 'cancelled'
            ? { boxShadow: `inset 3px 0 0 ${tplColor}` }
            : undefined
        }
      >
        {/* Todo el bloque de datos abre el sheet de excepciones. */}
        <button
          type="button"
          onClick={() => canOperate && setOpen(true)}
          disabled={!canOperate}
          aria-label={`Opciones de ${reservation.guest_name}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <div className="shrink-0 text-center">
            <div className="font-mono text-lg font-semibold leading-none tabular-nums">{time}</div>
            <div className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              <Users className="size-3" aria-hidden />
              {shownGuests}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold leading-tight">
                {reservation.guest_name}
              </p>
              {reservation.cake_count > 0 ? (
                <Cake className="size-3.5 shrink-0 text-primary" aria-label="Torta" />
              ) : null}
              {reservation.champagne_count > 0 ? (
                <GlassWater className="size-3.5 shrink-0 text-primary" aria-label="Champagne" />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {here || reservation.status !== 'pending' ? (
                <span
                  className={cn(
                    'font-medium',
                    here && 'text-success',
                    reservation.status === 'no_show' && 'text-destructive',
                  )}
                >
                  {STATUS_TEXT[reservation.status]}
                </span>
              ) : null}
              {reservation.primary_manager ? (
                <>
                  {reservation.status !== 'pending' ? ' · ' : ''}
                  {reservation.primary_manager.display_name}
                </>
              ) : null}
              {reservation.comments && !extras ? (
                <>
                  {reservation.status !== 'pending' || reservation.primary_manager ? ' · ' : ''}
                  <MessageSquareMore className="inline size-3 align-[-2px]" aria-hidden /> nota
                </>
              ) : null}
            </p>
          </div>
        </button>

        {/* EL gesto del turno: un toque, sin sheet, sin confirmación. */}
        {canArrive ? (
          <Button
            type="button"
            size="lg"
            disabled={pending}
            onClick={() => run(markArrived(tenantSlug, reservation.id), 'Llegó')}
            className="h-12 shrink-0 gap-1.5 px-4"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            Llegó
          </Button>
        ) : here ? (
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"
          >
            <Check className="size-5" strokeWidth={2.6} />
          </span>
        ) : null}
      </motion.li>

      {/* Excepciones. No es el camino normal: acá se entra solo si algo se salió
          del libreto. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="font-mono text-lg tabular-nums">{time}</span>
              <span className="truncate">{reservation.guest_name}</span>
            </SheetTitle>
            <SheetDescription>
              {shownGuests} {shownGuests === 1 ? 'persona' : 'personas'}
              {reservation.primary_manager
                ? ` · Gestor: ${reservation.primary_manager.display_name}`
                : ''}
              {reservation.scheduled_event?.template
                ? ` · ${reservation.scheduled_event.template.name}`
                : ''}
            </SheetDescription>
          </SheetHeader>

          {reservation.comments ? (
            <div className="mx-4 mb-3 rounded-xl bg-secondary/60 p-3 text-sm">
              {reservation.comments}
            </div>
          ) : null}

          <div className="space-y-2 px-4 pb-4">
            {reservation.status === 'pending' && canOperate ? (
              <Button
                size="xl"
                disabled={pending}
                onClick={() => run(markArrived(tenantSlug, reservation.id), 'Llegó')}
                className="h-14 w-full justify-start gap-3"
              >
                <Check className="size-5" aria-hidden />
                Llegó
              </Button>
            ) : null}

            {/* Cubiertos reales: es lo que se factura al gestor, así que corregirlo
                importa. Default = lo reservado; un toque por persona de más o de
                menos. */}
            {canOperate && reservation.status !== 'cancelled' ? (
              <div className="rounded-xl border p-3">
                <p className="text-sm font-medium">¿Vinieron más o menos?</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Reservaron {reservation.estimated_guests}. Esto es lo que se le factura al gestor.
                </p>
                <div className="mt-3 flex items-center justify-center gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-12 rounded-full"
                    aria-label="Una persona menos"
                    onClick={() => setGuests((g) => Math.max(1, g - 1))}
                  >
                    <Minus className="size-5" aria-hidden />
                  </Button>
                  <span className="min-w-14 text-center font-mono text-3xl font-semibold tabular-nums">
                    {guests}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-12 rounded-full"
                    aria-label="Una persona más"
                    onClick={() => setGuests((g) => Math.min(99, g + 1))}
                  >
                    <Plus className="size-5" aria-hidden />
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={pending || guests === shownGuests}
                  className="mt-3 h-12 w-full"
                  onClick={() =>
                    run(
                      updateActualGuests(tenantSlug, {
                        id: reservation.id,
                        actual_guests: guests,
                      }),
                      `Anotado: ${guests} ${guests === 1 ? 'persona' : 'personas'}`,
                    )
                  }
                >
                  Guardar {guests} {guests === 1 ? 'persona' : 'personas'}
                </Button>
              </div>
            ) : null}

            {reservation.status === 'pending' && canOperate ? (
              <Button
                variant="outline"
                size="xl"
                disabled={pending}
                className="h-13 w-full justify-start gap-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => run(markNoShow(tenantSlug, reservation.id), 'Marcado: no vino')}
              >
                <XCircle className="size-5" aria-hidden />
                No vino
              </Button>
            ) : null}

            {reservation.status === 'arrived' && canOperate ? (
              <Button
                variant="ghost"
                size="lg"
                disabled={pending}
                className="w-full justify-start gap-3 text-muted-foreground"
                onClick={() =>
                  run(revertStatus(tenantSlug, reservation.id, 'pending'), 'Vuelta a esperando')
                }
              >
                <RotateCcw className="size-4" aria-hidden />
                Me equivoqué, no llegó
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
