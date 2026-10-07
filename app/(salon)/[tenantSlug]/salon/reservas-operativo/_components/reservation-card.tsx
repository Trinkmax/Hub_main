'use client'

import {
  Armchair,
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
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CakeChip } from '@/components/reservations/cake-chip'
import { GuestCountStepper } from '@/components/reservations/guest-count-stepper'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  markArrived,
  markNoShow,
  revertStatus,
  updateActualGuests,
  updateReservationTableLabel,
} from '@/lib/salon/actions'
import { highestSeverity, resolveReservationAlerts } from '@/lib/salon/alerts'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import type { ReservationWithJoins, SalonReservationStatus } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { cleanTableLabel, TableField } from './table-field'

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
 *
 * La MESA (23/09/2026) entra por el mismo camino: se carga opcionalmente junto
 * con el conteo al marcar "Llegó" —el que la sienta es el que sabe dónde— y
 * después se corrige tocándola en la tarjeta. Antes solo podía cargarla la
 * anfitriona desde el tablero del manager, así que quedaba vacía justo cuando
 * sirve. Se escribe por RPC (`set_reservation_table_label`): la RLS de
 * `salon_reservations` no le deja escribir al mozo.
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

  // Realtime reemplaza la fila cuando alguien confirma la llegada. Sin este
  // re-sync el stepper de excepciones quedaba congelado en el número viejo y su
  // botón "Guardar 20" pisaba los 18 recién confirmados.
  useEffect(() => {
    setGuests(reservation.actual_guests ?? reservation.estimated_guests)
  }, [reservation.actual_guests, reservation.estimated_guests])
  // Contador de llegada: sheet propio, separado del de excepciones. Arranca en
  // lo reservado, que es la respuesta correcta la mayoría de las veces.
  const [arriveOpen, setArriveOpen] = useState(false)
  const [arriveGuests, setArriveGuests] = useState(reservation.estimated_guests)
  // La mesa: se carga en el mismo gesto que la llegada (el que la sienta es el
  // que sabe dónde) y se corrige después tocándola en la tarjeta.
  const [arriveTable, setArriveTable] = useState('')
  const [tableOpen, setTableOpen] = useState(false)
  const [tableDraft, setTableDraft] = useState('')

  function run(p: Promise<{ ok: boolean; message?: string }>, label: string) {
    startTransition(async () => {
      const r = await p
      if (r.ok) {
        toast.success(label)
        setOpen(false)
        setArriveOpen(false)
        setTableOpen(false)
        return
      }
      // Se queda abierto a propósito: si se cerrara, el mozo perdería el conteo
      // que acaba de hacer con la gente adelante y tendría que empezar de cero
      // sin saber que falló.
      toast.error(r.message ?? 'No pudimos guardarlo.')
    })
  }

  const time = reservation.reservation_time_local.slice(0, 5)
  const endTime = reservation.reservation_end_time_local?.slice(0, 5) ?? null
  const alerts = resolveReservationAlerts(
    reservation.service_alerts,
    reservation.customer?.service_alerts,
  )
  const alertTone = highestSeverity(alerts)
  const stillMatters =
    reservation.status === 'pending' ||
    reservation.status === 'arrived' ||
    reservation.status === 'seated'
  const shownGuests = reservation.actual_guests ?? reservation.estimated_guests
  const here = isHere(reservation.status)
  const canArrive = canOperate && reservation.status === 'pending'
  const tplColor = reservation.scheduled_event?.template?.color_hex
  // Dónde se sienta, para llevar a la gente: "Planta Baja", "Pizza libre" (del
  // evento, todavía sin planta) o "Pizza libre · Planta Alta".
  const place = placeLabel(reservation, joinedEventName(reservation))
  const extras =
    (reservation.cake_count > 0 ? 1 : 0) + (reservation.champagne_count > 0 ? 1 : 0) > 0
  const table = reservation.table_label ?? ''

  /**
   * Confirma la llegada y, si el mozo la cargó, la mesa — en UNA sola llamada
   * (`markArrived` la manda junto con la transición). El orden lo decide el
   * server: primero la llegada, que es lo que dispara la comisión y no se puede
   * perder; si la mesa falla, vuelve `ok: true` con un aviso y la llegada queda
   * igual hecha.
   */
  function confirmArrival() {
    const label = cleanTableLabel(arriveTable)
    const people = `${arriveGuests} ${arriveGuests === 1 ? 'persona' : 'personas'}`
    startTransition(async () => {
      const res = await markArrived(
        tenantSlug,
        reservation.id,
        arriveGuests,
        // `undefined` = no tocar la columna (no la editó); `null` = la borró.
        label === table ? undefined : label || null,
      )
      if (!res.ok) {
        toast.error(res.message ?? 'No pudimos guardarlo.')
        return
      }
      setArriveOpen(false)
      // La mesa que confirma el server, no la que se tipeó: si esa segunda
      // escritura falló, la llegada igual quedó hecha (ok: true + aviso) y el
      // toast verde no puede decir "Mesa 12" de una mesa que no se guardó.
      const saved =
        (res.data?.row as { table_label?: string | null } | undefined)?.table_label ?? ''
      toast.success(`Llegó · ${people}${saved ? ` · Mesa ${saved}` : ''}`)
      if (res.message) toast.warning(res.message)
    })
  }

  /** Cambiar la mesa de una reserva que ya está adentro. */
  function saveTable() {
    const label = cleanTableLabel(tableDraft)
    if (label === table) {
      setTableOpen(false)
      return
    }
    run(
      updateReservationTableLabel(tenantSlug, { id: reservation.id, table_label: label }),
      label ? `Mesa ${label}` : 'Mesa quitada',
    )
  }

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
          // El fondo lo usa el estado y la franja izquierda el color del
          // evento. Queda `outline`, que es una propiedad CSS aparte: `ring-*`
          // de Tailwind es box-shadow y el `style={{ boxShadow }}` de abajo lo
          // pisa, así que en toda reserva de evento el aro no se vería nunca.
          //
          // Solo mientras el aviso sirve: en `no_show` el rojo YA significa
          // "no vino" (ver STATUS_STYLE) y en cerrada/cancelada la mesa terminó.
          // Un aro rojo ahí sería rojo sobre rojo sin decir nada nuevo.
          alertTone === 'critical' &&
            stillMatters &&
            'outline outline-2 -outline-offset-2 outline-destructive/50',
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
            {endTime ? (
              <div className="mt-0.5 font-mono text-[11px] leading-none tabular-nums text-muted-foreground">
                → {endTime}
              </div>
            ) : null}
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
              {reservation.champagne_count > 0 ? (
                <GlassWater className="size-3.5 shrink-0 text-primary" aria-label="Champagne" />
              ) : null}
            </div>
            <ServiceAlertChips alerts={alerts} size="xs" className="mt-1" />
            {/* Qué torta va, no solo que hay una: la hace el bar y el que la
                arma necesita el sabor, no un ícono. */}
            {reservation.cake_count > 0 ? (
              <CakeChip
                count={reservation.cake_count}
                option={reservation.cake_option}
                optionId={reservation.cake_option_id}
                className="mt-1"
              />
            ) : null}
            {reservation.highlight_comment && reservation.comments ? (
              <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-foreground">
                {reservation.comments}
              </p>
            ) : null}
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
              {/* La mesa ya NO va en esta línea: para una reserva que está
                  adentro vive a la derecha, en su propio botón (se toca para
                  cambiarla). Acá se perdía por el truncado justo cuando alguien
                  pregunta dónde está la mesa de García. */}
              {/* Dónde se sienta va antes que el gestor: la línea se trunca por
                  el final, y para llevar a la gente importa más la planta que
                  quién tomó la reserva. */}
              {reservation.status !== 'pending' ? ' · ' : ''}
              {place}
              {reservation.primary_manager ? (
                <>
                  {' · '}
                  {reservation.primary_manager.display_name}
                </>
              ) : null}
              {reservation.comments && !extras ? (
                <>
                  {' · '}
                  <MessageSquareMore className="inline size-3 align-[-2px]" aria-hidden /> nota
                </>
              ) : null}
            </p>
          </div>
        </button>

        {/* EL gesto del turno. Ahora abre el contador: el único momento en que
            alguien SABE cuántos vinieron es este, con la gente adelante. El
            número arranca en lo reservado, así que confirmar es un toque más;
            corregir, dos o tres. Antes el conteo vivía a 4 toques dentro del
            sheet de excepciones y por eso 114 de 137 reservas no lo tienen. */}
        {canArrive ? (
          <Button
            type="button"
            size="lg"
            disabled={pending}
            onClick={() => {
              // `actual_guests` primero: si el encargado ya contó desde la
              // agenda, arrancar en el estimado haría que el mozo le pise el
              // dato sin enterarse.
              setArriveGuests(reservation.actual_guests ?? reservation.estimated_guests)
              setArriveTable(table)
              setArriveOpen(true)
            }}
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
          /* Ya está adentro: el lugar del botón lo ocupa la mesa. Es el dato
             que se pregunta a mitad del servicio ("¿dónde está García?") y
             ahora además se toca para cambiarla. El tilde verde se fue: la
             tarjeta ya está teñida de verde y dice "Llegó" en la línea de
             estado, así que no decía nada nuevo. */
          canOperate ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setTableDraft(table)
                setTableOpen(true)
              }}
              aria-label={
                table
                  ? `Mesa ${table} de ${reservation.guest_name}. Tocá para cambiarla`
                  : `Asignar mesa a ${reservation.guest_name}`
              }
              className={cn(
                'flex h-12 min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-2.5 transition-colors',
                table
                  ? 'border-success/40 bg-success/15 text-success active:bg-success/25'
                  : 'border-dashed border-border text-muted-foreground active:bg-secondary',
              )}
            >
              <TableFace label={table} />
            </button>
          ) : table ? (
            <span className="flex h-12 min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-success/40 bg-success/15 px-2.5 text-success">
              <TableFace label={table} />
            </span>
          ) : (
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"
            >
              <Check className="size-5" strokeWidth={2.6} />
            </span>
          )
        ) : null}
      </motion.li>

      {/* El contador de llegada. Sheet propio y no el de excepciones: este ES el
          camino normal del turno, y tiene que abrir directo en el número, sin
          nada más que mirar. */}
      <Sheet open={arriveOpen} onOpenChange={setArriveOpen}>
        <SheetContent side="bottom">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="font-mono text-lg tabular-nums">{time}</span>
              <span className="truncate">{reservation.guest_name}</span>
            </SheetTitle>
            <SheetDescription>¿Cuántos llegaron?</SheetDescription>
          </SheetHeader>

          {/* Los avisos también acá: es el momento en que el mozo la sienta. */}
          <ServiceAlertChips alerts={alerts} className="px-4 pb-2" />

          <div className="px-4 pb-4">
            <GuestCountStepper
              value={arriveGuests}
              onChange={setArriveGuests}
              size="lg"
              disabled={pending}
              className="py-2"
            />
            <p className="mb-4 text-center text-xs text-muted-foreground">
              Reservó {reservation.estimated_guests}{' '}
              {reservation.estimated_guests === 1 ? 'persona' : 'personas'}
              {arriveGuests !== reservation.estimated_guests
                ? ` · ${arriveGuests > reservation.estimated_guests ? 'vinieron' : 'faltaron'} ${Math.abs(arriveGuests - reservation.estimated_guests)}`
                : ''}
            </p>

            {/* La mesa, en el mismo paso: el mozo sienta a la gente y anota
                dónde de una. Opcional y sin foco automático — el teclado
                taparía el contador, que es lo que se toca siempre. */}
            <div className="mb-4">
              <label
                htmlFor={`mesa-llegada-${reservation.id}`}
                className="mb-1.5 block text-sm font-medium"
              >
                Mesa <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <TableField
                id={`mesa-llegada-${reservation.id}`}
                value={arriveTable}
                onChange={setArriveTable}
                disabled={pending}
                onSubmit={confirmArrival}
              />
            </div>

            <Button
              size="xl"
              disabled={pending}
              className="h-14 w-full justify-center gap-3"
              onClick={confirmArrival}
            >
              {pending ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-5" aria-hidden />
              )}
              Confirmar {arriveGuests} {arriveGuests === 1 ? 'persona' : 'personas'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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
              {` · ${place}`}
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
                onClick={() =>
                  run(
                    markArrived(tenantSlug, reservation.id, guests),
                    `Llegó · ${guests} ${guests === 1 ? 'persona' : 'personas'}`,
                  )
                }
                className="h-14 w-full justify-start gap-3"
              >
                <Check className="size-5" aria-hidden />
                Llegó · {guests} {guests === 1 ? 'persona' : 'personas'}
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
                  // Contra `actual_guests` crudo y NO contra `shownGuests`
                  // (que coalesce con el estimado): si el tablero del dueño
                  // marcó la llegada sin contar, `actual_guests` queda null y
                  // con la comparación vieja era imposible confirmar "vinieron
                  // los que reservaron" — el botón nacía deshabilitado. Es el
                  // mismo criterio que usa reservation-status-controls.tsx.
                  disabled={pending || guests === reservation.actual_guests}
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

      {/* Cambiar la mesa de una que ya está adentro: los cambian de mesa todo
          el tiempo. Sheet chico, un campo y un botón — se entra tocando la mesa
          en la tarjeta, así que no hay nada más que decidir acá. */}
      <Sheet open={tableOpen} onOpenChange={setTableOpen}>
        <SheetContent side="bottom">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2.5">
              <Armchair className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">Mesa de {reservation.guest_name}</span>
            </SheetTitle>
            <SheetDescription>
              Podés poner varias ("12+13") o un lugar ("Barra"). Vacío = sin mesa.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-4">
            <TableField
              id={`mesa-${reservation.id}`}
              label={`Mesa de ${reservation.guest_name}`}
              value={tableDraft}
              onChange={setTableDraft}
              disabled={pending}
              autoFocus
              onSubmit={saveTable}
            />
            <Button
              size="xl"
              disabled={pending || cleanTableLabel(tableDraft) === table}
              className="mt-4 h-14 w-full justify-center gap-3"
              onClick={saveTable}
            >
              {pending ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-5" aria-hidden />
              )}
              {cleanTableLabel(tableDraft)
                ? `Guardar mesa ${cleanTableLabel(tableDraft)}`
                : table
                  ? 'Quitar la mesa'
                  : 'Guardar mesa'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/**
 * La cara del control de mesa: "MESA / 12" cuando ya la tiene, o una silla con
 * la palabra "Mesa" cuando todavía no (invita a cargarla sin gritar).
 */
function TableFace({ label }: { label: string }) {
  if (!label) {
    return (
      <>
        <Armchair className="size-4" aria-hidden />
        <span className="text-[10px] font-medium leading-none">Mesa</span>
      </>
    )
  }
  return (
    <>
      <span className="text-[10px] font-medium uppercase leading-none opacity-80">Mesa</span>
      <span className="max-w-20 truncate font-mono text-base font-bold leading-none tabular-nums">
        {label}
      </span>
    </>
  )
}
