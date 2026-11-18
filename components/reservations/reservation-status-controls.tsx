'use client'

import { Check, DoorClosed, MoreHorizontal, RotateCcw, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  cancelSalonReservation,
  closeTable,
  markArrived,
  markNoShow,
  revertStatus,
  updateActualGuests,
} from '@/lib/salon/actions'
import { todayInCordoba } from '@/lib/salon/date-presets'
import { type ReservationWithJoins, STATUS_LABELS } from '@/lib/salon/types'
import { GuestCountStepper } from './guest-count-stepper'

const STATUS_BADGE: Record<
  ReservationWithJoins['status'],
  'secondary' | 'success' | 'destructive' | 'muted'
> = {
  pending: 'muted',
  arrived: 'success',
  seated: 'success',
  closed: 'secondary',
  no_show: 'destructive',
  cancelled: 'muted',
}

// Reloj de 24 horas, como en el resto del panel («20:24», no «08:24 p. m.»).
const CLOCK = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Cordoba',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const DAY_AND_CLOCK = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Cordoba',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function stamp(iso: string | null, withDay = false): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return (withDay ? DAY_AND_CLOCK : CLOCK).format(date)
}

/**
 * El estado de una reserva y lo que se puede hacer con ella AHORA.
 *
 * Reemplaza a la columna de cuatro botones (Llegó · Sentar · Cerrar mesa · No vino) que mostraba
 * todos los pasos siempre, la mitad apagados. En el bar el camino real es uno solo: la reserva está
 * pendiente y, esa noche, llegó o no vino. Así que se muestra el paso que toca y nada más, igual que
 * la ficha del tablero Operativo:
 *
 *  - Pendiente → «Llegó» (grande) y «No vino».
 *  - Adentro → cuántos vinieron de verdad; «Cerrar mesa» y «Me equivoqué» quedan a mano, chicos.
 *  - No vino → «Apareció, esperar» o «Llegó igual».
 *  - Cerrada → «Reabrir».
 *
 * «Sentar» no existe más como paso: llegar y sentarse eran la misma cosa y nadie lo marcaba. Una
 * reserva vieja que quedó en «Sentada» se trata como adentro.
 *
 * `onChanged` se llama tras cada acción exitosa: el popup lo usa para refrescar su data; la ficha
 * lo omite (las Server Actions ya revalidan la página).
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
   * El popup trae su propio contador de personas, así que esconde este para no mostrar dos veces el
   * mismo número.
   */
  showActualGuestsEditor?: boolean
}) {
  const r = reservation
  const [pending, startTransition] = useTransition()
  const inside = r.status === 'arrived' || r.status === 'seated'
  // Las llegadas se marcan el día de la reserva (o después, para corregir): antes es un error seguro.
  const isFuture = r.reservation_date > todayInCordoba()

  function run(action: Promise<{ ok: boolean; message?: string }>, done?: string) {
    startTransition(async () => {
      const result = await action
      if (result.ok) {
        toast.success(done ?? result.message ?? 'Listo.')
        onChanged?.()
      } else {
        toast.error(result.message ?? 'No se pudo guardar. Probá de nuevo.')
      }
    })
  }

  // Personas que vinieron: se guarda solo, un rato después del último toque (como en el Operativo).
  const [guests, setGuests] = useState(r.actual_guests ?? r.estimated_guests)
  useEffect(
    () => setGuests(r.actual_guests ?? r.estimated_guests),
    [r.actual_guests, r.estimated_guests],
  )
  // Hasta que alguien lo toca, el número es lo que reservaron (una propuesta), no un conteo.
  const [touched, setTouched] = useState(false)
  const timer = useRef<number | null>(null)
  const unsaved = useRef<number | null>(null)
  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    const value = unsaved.current
    unsaved.current = null
    if (value === null) return
    void updateActualGuests(tenantSlug, { id: r.id, actual_guests: value }).then((result) => {
      if (result.ok) onChanged?.()
      else toast.error(result.message ?? 'No se pudo guardar cuántos vinieron.')
    })
  }
  const bump = (value: number) => {
    setGuests(value)
    setTouched(true)
    unsaved.current = value
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 700)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: al desmontar se guarda lo último que haya
  useEffect(() => () => flush(), [])

  const detail = statusDetail(r)

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado</p>
          {detail ? (
            <p className="mt-1 text-sm text-muted-foreground text-pretty">{detail}</p>
          ) : null}
        </div>
        <Badge variant={STATUS_BADGE[r.status]} className="shrink-0 gap-1">
          {inside ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
          {inside ? 'Llegó' : STATUS_LABELS[r.status]}
        </Badge>
      </header>

      {r.status === 'pending' ? (
        isFuture ? (
          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
            Todavía no es el día: las llegadas se marcan ese día.
          </p>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="success"
              className="h-12 flex-1 gap-2 rounded-xl text-base"
              disabled={pending}
              onClick={() => run(markArrived(tenantSlug, r.id), 'Llegó.')}
            >
              <Check className="size-5" strokeWidth={2.5} aria-hidden />
              Llegó
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-12 gap-2 rounded-xl border-destructive/40 px-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              onClick={() => run(markNoShow(tenantSlug, r.id), 'Marcada como no vino.')}
            >
              <XCircle className="size-4" aria-hidden />
              No vino
            </Button>
          </div>
        )
      ) : null}

      {inside ? (
        <>
          {showActualGuestsEditor ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 py-1.5 pr-1.5 pl-3">
              <span className="leading-tight">
                <span className="block text-sm font-medium">Vinieron</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {r.actual_guests === null
                    ? `Reservaron ${r.estimated_guests}. Si fueron otros, corregilo.`
                    : `Reservaron ${r.estimated_guests}`}
                </span>
              </span>
              <GuestCountStepper
                value={guests}
                onChange={bump}
                size="md"
                muted={r.actual_guests === null && !touched}
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground"
                  disabled={pending}
                >
                  <DoorClosed className="size-4" aria-hidden />
                  Cerrar mesa
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Ya se fueron?</AlertDialogTitle>
                  <AlertDialogDescription>
                    La reserva queda cerrada con {guests} {guests === 1 ? 'persona' : 'personas'}.
                    Si después hace falta, se puede reabrir.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Volver</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      // Lo que se haya tocado en el contador viaja en el cierre.
                      if (timer.current) window.clearTimeout(timer.current)
                      unsaved.current = null
                      run(closeTable(tenantSlug, { id: r.id, actual_guests: guests }))
                    }}
                  >
                    Cerrar mesa
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground"
                  disabled={pending}
                  aria-label="Más opciones"
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                  Más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {/* La base solo deja volver de a un paso: de «sentada» primero a «llegó». */}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    run(
                      revertStatus(tenantSlug, r.id, r.status === 'seated' ? 'arrived' : 'pending'),
                      r.status === 'seated' ? 'Listo.' : 'Volvió a pendiente.',
                    )
                  }
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Me equivoqué, no llegó
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : null}

      {r.status === 'no_show' ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 gap-2 rounded-xl"
            disabled={pending}
            onClick={() => run(revertStatus(tenantSlug, r.id, 'pending'), 'Volvió a pendiente.')}
          >
            <RotateCcw className="size-4" aria-hidden />
            Apareció, esperar
          </Button>
          <Button
            type="button"
            variant="success"
            className="h-11 flex-1 gap-2 rounded-xl"
            disabled={pending}
            onClick={() => run(markArrived(tenantSlug, r.id), 'Llegó.')}
          >
            <Check className="size-4" strokeWidth={2.5} aria-hidden />
            Llegó igual
          </Button>
        </div>
      ) : null}

      {r.status === 'closed' ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full gap-2 rounded-xl"
          disabled={pending}
          onClick={() => run(revertStatus(tenantSlug, r.id, 'seated'), 'Mesa reabierta.')}
        >
          <RotateCcw className="size-4" aria-hidden />
          Reabrir mesa
        </Button>
      ) : null}

      {r.status !== 'cancelled' && r.status !== 'closed' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="block w-full rounded-md py-1 text-center text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline focus-visible:text-destructive focus-visible:underline focus-visible:outline-none disabled:opacity-50"
            >
              Cancelar la reserva
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
              <AlertDialogDescription>
                Se libera su lugar en el cupo y la comisión de quien la gestionó se da de baja
                (salvo lo que ya se pagó). No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <CancelReasonForm
              onSubmit={(reason) =>
                run(cancelSalonReservation(tenantSlug, { id: r.id, reason }), 'Reserva cancelada.')
              }
            />
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  )
}

/** El estado dicho en una línea, con su hora cuando se sabe. */
function statusDetail(r: ReservationWithJoins): string | null {
  switch (r.status) {
    case 'pending':
      return null
    case 'arrived':
    case 'seated': {
      const at = stamp(r.arrived_at)
      const table = r.table_label ? `Mesa ${r.table_label}` : null
      return [at ? `Llegó a las ${at}` : null, table].filter(Boolean).join(' · ') || null
    }
    case 'closed': {
      const at = stamp(r.closed_at)
      const people = r.actual_guests ?? r.estimated_guests
      return `${at ? `Se fueron a las ${at}` : 'Mesa cerrada'} · ${people} ${people === 1 ? 'persona' : 'personas'}`
    }
    case 'no_show':
      return 'No apareció. Si llega más tarde, se puede corregir.'
    case 'cancelled': {
      const at = stamp(r.cancelled_at, true)
      const reason = r.cancelled_reason?.trim()
      return [at ? `Se canceló el ${at}` : 'Se canceló', reason ? `«${reason}»` : null]
        .filter(Boolean)
        .join(' · ')
    }
  }
}

function CancelReasonForm({ onSubmit }: { onSubmit: (reason?: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <>
      <div className="space-y-2 py-4">
        <Input
          placeholder="Motivo (opcional)"
          aria-label="Motivo de la cancelación (opcional)"
          value={reason}
          maxLength={280}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Volver</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => onSubmit(reason.trim() || undefined)}
        >
          Cancelar la reserva
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}
