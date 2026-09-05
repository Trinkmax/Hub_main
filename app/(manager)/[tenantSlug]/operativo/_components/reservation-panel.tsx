'use client'

import {
  Armchair,
  Check,
  ChevronRight,
  Clock,
  DoorClosed,
  GlassWater,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ContactButton } from '@/components/messaging/contact-button'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip } from '@/components/reservations/celebration-chip'
import { GuestCountStepper } from '@/components/reservations/guest-count-stepper'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { EarnRate } from '@/lib/points/earn-rate'
import type { RecentQrAward } from '@/lib/points/queries'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { ARSFormat, endsNextDay } from '@/lib/salon/format'
import { minutesUntil, relativeTimeLabel, reverseLabel } from '@/lib/salon/operativo'
import {
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
  STATUS_LABELS,
  ZONE_LABELS,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { ArrivalForm } from './arrival-form'
import { MemberPanel } from './member-panel'
import type { BoardActions } from './operativo-board'
import { TableEditor } from './table-editor'

export type PanelMode = 'detail' | 'arrive' | 'table' | 'close'

const STATUS_BADGE: Record<
  ReservationWithJoins['status'],
  'default' | 'secondary' | 'success' | 'info' | 'destructive' | 'muted'
> = {
  pending: 'muted',
  arrived: 'success',
  seated: 'success',
  closed: 'secondary',
  no_show: 'destructive',
  cancelled: 'muted',
}

function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

function fmtStamp(iso: string | null): string | null {
  if (!iso) return null
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date(iso))
}

/**
 * La ficha de UNA reserva: en mobile vive en un sheet, en desktop en el aside.
 * Es la misma pieza en los dos, y tiene un solo nivel: cuando hay que contar
 * gente o poner la mesa, el CONTENIDO se reemplaza (no se apila otro sheet).
 *
 * Arriba lo que se hace (acciones por estado), después lo que hay que saber
 * (avisos, torta, comentario), el club, y al final los datos fríos.
 */
export function ReservationPanel({
  tenantSlug,
  reservation: r,
  mode,
  onModeChange,
  actions,
  award,
  earnRate,
  occupied,
  usedToday,
  clock,
  isFuture,
  canOperate,
  canAward,
  canLink,
  isOwner,
  onClose,
  remoteTouched,
}: {
  tenantSlug: string
  reservation: ReservationWithJoins
  mode: PanelMode
  onModeChange: (mode: PanelMode) => void
  actions: BoardActions
  award: RecentQrAward | null
  earnRate: EarnRate | null
  /** mesa normalizada → apellido de quien la tiene ahora (sin esta reserva). */
  occupied: Map<string, string>
  /** Etiquetas de mesa crudas de la noche, para los atajos. */
  usedToday: string[]
  clock: number | null
  isFuture: boolean
  canOperate: boolean
  canAward: boolean
  canLink: boolean
  isOwner: boolean
  onClose: () => void
  remoteTouched: boolean
}) {
  const reduced = useReducedMotion()
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const guests = r.actual_guests ?? r.estimated_guests
  const inside = r.status === 'arrived' || r.status === 'seated'
  const operable = canOperate && !isFuture
  const diff = clock !== null && r.status === 'pending' ? minutesUntil(r, clock) : null
  const late = diff !== null && diff < -15
  const zone =
    r.zone === 'event_floating'
      ? (r.scheduled_event?.template?.name ?? 'Evento')
      : ZONE_LABELS[r.zone]
  const phone = r.customer?.phone ?? r.guest_phone ?? ''
  const [revertOpen, setRevertOpen] = useState(false)
  const [tableDraft, setTableDraft] = useState(r.table_label ?? '')
  useEffect(() => setTableDraft(r.table_label ?? ''), [r.table_label])

  // Personas: se guarda solo, 700 ms después del último toque. Si el panel se
  // cierra antes, se guarda igual al desmontar (el conteo no se pierde).
  const [guestsDraft, setGuestsDraft] = useState(guests)
  const guestsTimer = useRef<number | null>(null)
  const pendingGuests = useRef<number | null>(null)
  useEffect(
    () => setGuestsDraft(r.actual_guests ?? r.estimated_guests),
    [r.actual_guests, r.estimated_guests],
  )
  const flushGuests = () => {
    if (guestsTimer.current) window.clearTimeout(guestsTimer.current)
    guestsTimer.current = null
    const n = pendingGuests.current
    pendingGuests.current = null
    if (n !== null) void actions.setGuests(r.id, n)
  }
  const bumpGuests = (n: number) => {
    setGuestsDraft(n)
    pendingGuests.current = n
    if (guestsTimer.current) window.clearTimeout(guestsTimer.current)
    guestsTimer.current = window.setTimeout(flushGuests, 700)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush al desmontar, con lo último que haya
  useEffect(() => () => flushGuests(), [])

  const saveTable = async () => {
    const clean = tableDraft.trim().replace(/\s+/g, ' ')
    const ok = await actions.setTable(r.id, clean ? clean : null)
    if (ok) onModeChange('detail')
  }

  return (
    <div className="flex flex-col">
      {/* Cabecera */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-serif text-xl font-semibold leading-tight tracking-tight">
              {r.guest_name}
            </h2>
            <Badge variant={STATUS_BADGE[r.status]} className="gap-1">
              {inside ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
              {STATUS_LABELS[r.status]}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {fmtTime(r.reservation_time_local)}
              {r.reservation_end_time_local ? (
                <span
                  className="font-normal text-muted-foreground"
                  title={
                    endsNextDay(r.reservation_time_local, r.reservation_end_time_local)
                      ? 'Termina a la madrugada'
                      : 'Hora de fin'
                  }
                >
                  {' '}
                  → {fmtTime(r.reservation_end_time_local)}
                </span>
              ) : null}
            </span>
            {diff !== null && (late || Math.abs(diff) <= 60) ? (
              <span className={cn('font-medium', late && 'text-warning-text')}>
                {relativeTimeLabel(diff)}
              </span>
            ) : null}
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden />
              {guests}
              {r.actual_guests !== null && r.actual_guests !== r.estimated_guests ? (
                <span className="text-xs">(reservaron {r.estimated_guests})</span>
              ) : null}
            </span>
            <span aria-hidden>·</span>
            <span>{zone}</span>
            {r.table_label ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Armchair className="size-3.5" aria-hidden />
                  Mesa {r.table_label}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {phone ? (
            <ContactButton
              tenantSlug={tenantSlug}
              phone={phone}
              customerId={r.customer_id ?? undefined}
              name={r.guest_name}
              variant="outline"
              size="icon"
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full text-muted-foreground"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {remoteTouched ? (
        <p className="mx-4 mb-2 rounded-lg bg-info/10 px-3 py-1.5 text-xs text-foreground sm:mx-5">
          Actualizada desde el salón recién.
        </p>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'arrive' || mode === 'close' ? (
          <motion.div
            key={mode}
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.16 }}
          >
            <ArrivalForm
              reservation={r}
              occupied={occupied}
              usedToday={usedToday}
              variant={mode}
              onCancel={() => onModeChange('detail')}
              onConfirm={async (n, table) => {
                const ok =
                  mode === 'close'
                    ? await actions.close(r.id, n)
                    : await actions.arrive(r.id, n, table)
                if (ok) onClose()
                return ok
              }}
            />
          </motion.div>
        ) : mode === 'table' ? (
          <motion.div
            key="table"
            initial={reduced ? false : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.16 }}
            className="space-y-4 px-4 pb-4 sm:px-5"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Mesa de {r.guest_name}
            </p>
            <TableEditor
              value={tableDraft}
              onChange={setTableDraft}
              occupied={occupied}
              currentId={r.id}
              usedToday={usedToday}
              autoFocus
              onSubmit={saveTable}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl px-5"
                onClick={() => {
                  setTableDraft(r.table_label ?? '')
                  onModeChange('detail')
                }}
              >
                Volver
              </Button>
              <Button type="button" className="h-12 flex-1 gap-2 rounded-xl" onClick={saveTable}>
                <Check className="size-4" aria-hidden />
                {tableDraft.trim() ? `Guardar mesa ${tableDraft.trim()}` : 'Quitar mesa'}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="detail"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="space-y-4 px-4 pb-5 sm:px-5"
          >
            {/* Acciones del momento */}
            {operable ? (
              <div className="space-y-2">
                {r.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="success"
                      className="h-14 flex-1 gap-2 rounded-2xl text-base"
                      onClick={() => onModeChange('arrive')}
                    >
                      <Check className="size-5" strokeWidth={2.5} aria-hidden />
                      Llegó
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 gap-2 rounded-2xl border-destructive/40 px-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        void actions.noShow(r.id)
                        onClose()
                      }}
                    >
                      <XCircle className="size-5" aria-hidden />
                      No vino
                    </Button>
                  </div>
                ) : null}

                {inside ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 justify-between gap-2 rounded-2xl px-4"
                      onClick={() => onModeChange('table')}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Armchair className="size-5 text-muted-foreground" aria-hidden />
                        <span className="text-left leading-tight">
                          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                            Mesa
                          </span>
                          <span className="block font-serif text-lg font-semibold">
                            {r.table_label ?? 'Asignar'}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </Button>
                    <div className="flex h-14 items-center justify-between rounded-2xl border border-border/70 bg-card px-1.5 pl-3">
                      <span className="text-left leading-tight">
                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                          Personas
                        </span>
                        <span className="block text-[11px] text-muted-foreground tabular-nums">
                          de {r.estimated_guests}
                        </span>
                      </span>
                      <GuestCountStepper
                        value={guestsDraft}
                        onChange={bumpGuests}
                        size="md"
                        className="gap-1 [&_button]:size-11"
                      />
                    </div>
                  </div>
                ) : null}

                {r.status === 'no_show' ? (
                  <div className="space-y-2">
                    <p className="rounded-xl bg-destructive/8 px-3 py-2 text-sm">
                      Marcada como <strong>no vino</strong>
                      {fmtStamp(r.updated_at) ? ` a las ${fmtStamp(r.updated_at)}` : ''}.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-14 flex-1 gap-2 rounded-2xl"
                        onClick={() => {
                          void actions.revert(r.id, 'pending')
                          onClose()
                        }}
                      >
                        <RotateCcw className="size-4" aria-hidden />
                        Apareció, esperar
                      </Button>
                      <Button
                        type="button"
                        variant="success"
                        className="h-14 flex-1 gap-2 rounded-2xl"
                        onClick={() => onModeChange('arrive')}
                      >
                        <Check className="size-5" strokeWidth={2.5} aria-hidden />
                        Llegó igual
                      </Button>
                    </div>
                  </div>
                ) : null}

                {r.status === 'closed' ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-full gap-2 rounded-2xl"
                    onClick={() => {
                      void actions.revert(r.id, 'seated')
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Reabrir mesa
                  </Button>
                ) : null}

                {/* Secundarias, escondidas: cerrar mesa (dueño) y reversos. */}
                {inside ? (
                  <div className="flex items-center justify-between gap-2">
                    {isOwner ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 gap-1.5 rounded-xl text-muted-foreground"
                        onClick={() => onModeChange('close')}
                      >
                        <DoorClosed className="size-4" aria-hidden />
                        Cerrar mesa
                      </Button>
                    ) : (
                      <span />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-11 gap-1.5 rounded-xl text-muted-foreground"
                          aria-label="Más opciones"
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                          Más
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {/* La RPC solo admite seated → arrived y arrived → pending:
                            desde "sentada" primero se vuelve a "llegó". */}
                        {r.status === 'seated' ? (
                          <DropdownMenuItem onSelect={() => void actions.revert(r.id, 'arrived')}>
                            <RotateCcw className="size-4" aria-hidden />
                            {reverseLabel('seated')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() => setRevertOpen(true)}
                            className="text-destructive focus:text-destructive"
                          >
                            <RotateCcw className="size-4" aria-hidden />
                            Me equivoqué, no llegó
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ) : isFuture && r.status === 'pending' ? (
              <p className="rounded-xl bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                Todavía no es el día: las llegadas se marcan ese día.
              </p>
            ) : null}

            {/* Lo que hay que saber antes de sentarlos */}
            {alerts.length > 0 ||
            r.cake_count > 0 ||
            r.champagne_count > 0 ||
            r.kind !== 'normal' ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <ServiceAlertChips alerts={alerts} />
                {r.kind !== 'normal' ? <CelebrationChip kind={r.kind} /> : null}
                {r.cake_count > 0 ? (
                  <CakeChip
                    count={r.cake_count}
                    option={r.cake_option}
                    optionId={r.cake_option_id}
                    detailed
                    className="basis-full"
                  />
                ) : null}
                {r.champagne_count > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 text-xs">
                    <GlassWater className="size-3.5 text-primary" aria-hidden />
                    {r.champagne_count} {r.champagne_count === 1 ? 'champagne' : 'champagnes'}
                  </span>
                ) : null}
              </div>
            ) : null}

            {r.comments ? (
              <div
                className={cn(
                  'rounded-xl px-3 py-2.5 text-sm leading-snug',
                  r.highlight_comment
                    ? 'border border-warning/40 bg-warning/10 font-medium'
                    : 'bg-secondary/60',
                )}
              >
                {r.comments}
              </div>
            ) : null}

            <MemberPanel
              tenantSlug={tenantSlug}
              reservation={r}
              award={award}
              earnRate={earnRate}
              canAward={canAward}
              canLink={canLink}
              actions={actions}
            />

            {/* Datos fríos */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <Field label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Field>
              <Field label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Field>
              <Field label="Gestor">
                {r.primary_manager?.display_name ?? '—'}
                {r.assistant_manager ? (
                  <span className="text-muted-foreground">
                    {' '}
                    + {r.assistant_manager.display_name}
                  </span>
                ) : null}
              </Field>
              <Field label="Origen">{ORIGIN_LABELS[r.origin]}</Field>
              {r.scheduled_event?.template ? (
                <Field label="Evento">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: r.scheduled_event.template.color_hex }}
                    />
                    {r.scheduled_event.template.name}
                  </span>
                </Field>
              ) : null}
              {r.deposit_cents > 0 ? (
                <Field label="Seña">
                  <span className="font-mono tabular-nums">{ARSFormat(r.deposit_cents)}</span>
                </Field>
              ) : null}
              {phone ? (
                <Field label="Teléfono">
                  <span className="font-mono text-xs">{phone}</span>
                </Field>
              ) : null}
            </dl>

            {/* Pie: la historia del turno + edición completa */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-x-2 tabular-nums">
                <Clock className="size-3.5" aria-hidden />
                {fmtStamp(r.arrived_at) ? <span>llegó {fmtStamp(r.arrived_at)}</span> : null}
                {fmtStamp(r.seated_at) ? <span>· sentada {fmtStamp(r.seated_at)}</span> : null}
                {fmtStamp(r.closed_at) ? <span>· cerrada {fmtStamp(r.closed_at)}</span> : null}
                {!r.arrived_at && !r.closed_at ? <span>sin movimientos todavía</span> : null}
              </span>
              <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
                <Link href={`/${tenantSlug}/reservas/${r.id}`} prefetch={false}>
                  <Pencil className="size-3.5" aria-hidden />
                  Edición completa
                </Link>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Volver a pendiente desde llegó: la única que confirma (liquida comisión). */}
      <AlertDialog open={revertOpen} onOpenChange={setRevertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿No llegó {r.guest_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Vuelve a "por llegar" y se recalcula la comisión del gestor. Si la gente está adentro,
              dejá la reserva como está.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRevertOpen(false)
                void actions.revert(r.id, 'pending')
                onClose()
              }}
            >
              Sí, no llegó
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  )
}
