'use client'

import {
  Armchair,
  Check,
  ChevronRight,
  Clock,
  DoorClosed,
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
import { CelebrationChip, ChampagneChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { RESERVATION_STATUS } from '@/components/reservations/status-meta'
import { Amount } from '@/components/ui/amount'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { NumberField } from '@/components/ui/number-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatTime } from '@/lib/dates'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { EarnRate } from '@/lib/points/earn-rate'
import type { RecentQrAward } from '@/lib/points/queries'
import { resolveReservationAlerts } from '@/lib/salon/alerts'
import { endsNextDay } from '@/lib/salon/format'
import { minutesUntil, relativeTimeLabel, reverseLabel } from '@/lib/salon/operativo'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import {
  MEAL_TYPE_LABELS,
  ORIGIN_LABELS,
  RESERVATION_KIND_LABELS,
  type ReservationWithJoins,
} from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { ArrivalForm } from './arrival-form'
import { MemberPanel } from './member-panel'
import type { BoardActions } from './operativo-board'
import { TableEditor } from './table-editor'

export type PanelMode = 'detail' | 'arrive' | 'table' | 'close'

/** Lo mismo que acepta la acción (`actualGuestsSchema`): cero no es un conteo, es «no vino». */
const MIN_GUESTS = 1
const MAX_GUESTS = 99

function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

/** 'HH:mm' del reloj del bar (a mano, sin `Intl`). */
function fmtStamp(iso: string | null): string | null {
  return iso ? formatTime(iso) || null : null
}

/**
 * La ficha de UNA reserva: en mobile vive en una hoja, en desktop en el aside.
 * Es la misma pieza en los dos, y tiene un solo nivel: cuando hay que contar
 * gente o poner la mesa, el CONTENIDO se reemplaza (no se apila otra hoja).
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
  const confirm = useConfirm()
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const guests = r.actual_guests ?? r.estimated_guests
  const inside = r.status === 'arrived' || r.status === 'seated'
  const operable = canOperate && !isFuture
  const diff = clock !== null && r.status === 'pending' ? minutesUntil(r, clock) : null
  const late = diff !== null && diff < -15
  // Dónde se sienta, con `placeLabel` como en todas las pantallas: la planta,
  // el evento sin planta ("Pizza libre") o los dos ("Pizza libre · Planta
  // Alta"). Antes una de evento con planta decía solo "Planta Alta" y no se
  // sabía que venía al evento.
  const zone = placeLabel(r, joinedEventName(r))
  const phone = r.customer?.phone ?? r.guest_phone ?? ''
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

  // Volver a pendiente desde llegó: la única que confirma (liquida comisión).
  // El diálogo vive en el shell (`useConfirm`), no adentro del menú que lo abre.
  const confirmNotArrived = async () => {
    const ok = await confirm({
      title: `¿No llegó ${r.guest_name}?`,
      description:
        'Vuelve a «por llegar» y se recalcula la comisión del gestor. Si la gente está adentro, dejá la reserva como está.',
      confirmLabel: 'Sí, no llegó',
      cancelLabel: 'Volver',
      tone: 'danger',
    })
    if (!ok) return
    void actions.revert(r.id, 'pending')
    onClose()
  }

  return (
    <div className="flex flex-col">
      {/* Cabecera */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-section text-balance">{r.guest_name}</h2>
            <StatusBadge status={r.status} map={RESERVATION_STATUS} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 type-body text-muted-foreground">
            <span className="font-semibold text-foreground type-amount">
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
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden="true" />
              {guests}
              {r.actual_guests !== null && r.actual_guests !== r.estimated_guests ? (
                <span className="type-caption">(reservaron {r.estimated_guests})</span>
              ) : null}
            </span>
            <span aria-hidden="true">·</span>
            <span>{zone}</span>
            {r.table_label ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Armchair className="size-3.5" aria-hidden="true" />
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
              variant="secondary"
              size="icon"
            />
          ) : null}
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      {remoteTouched ? (
        <Callout tone="info" announce="polite" className="mx-4 mb-2 sm:mx-5">
          Actualizada desde el salón recién.
        </Callout>
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
            className="flex flex-col gap-4 px-4 pb-4 sm:px-5"
          >
            {/* El campo de mesa toma etiqueta, ayuda e id del Field (kit). */}
            <Field label={`Mesa de ${r.guest_name}`} hint="Juntá mesas con «+»: 12+13.">
              <TableEditor
                value={tableDraft}
                onChange={setTableDraft}
                occupied={occupied}
                currentId={r.id}
                usedToday={usedToday}
                autoFocus
                onSubmit={saveTable}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => {
                  setTableDraft(r.table_label ?? '')
                  onModeChange('detail')
                }}
              >
                Volver
              </Button>
              <Button type="button" size="lg" className="flex-1" onClick={saveTable}>
                <Check aria-hidden="true" />
                <span className="truncate">
                  {tableDraft.trim() ? `Guardar mesa ${tableDraft.trim()}` : 'Quitar mesa'}
                </span>
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
            className="flex flex-col gap-4 px-4 pb-5 sm:px-5"
          >
            {/* Acciones del momento */}
            {operable ? (
              <div className="flex flex-col gap-2">
                {r.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="lg"
                      className="flex-1"
                      onClick={() => onModeChange('arrive')}
                    >
                      <Check strokeWidth={2.5} aria-hidden="true" />
                      Llegó
                    </Button>
                    <Button
                      type="button"
                      variant="danger-ghost"
                      size="lg"
                      onClick={() => {
                        void actions.noShow(r.id)
                        onClose()
                      }}
                    >
                      <XCircle aria-hidden="true" />
                      No vino
                    </Button>
                  </div>
                ) : null}

                {inside ? (
                  <div className="grid grid-cols-2 items-start gap-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="type-label">Mesa</p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="justify-between"
                        onClick={() => onModeChange('table')}
                        aria-label={
                          r.table_label ? `Mesa ${r.table_label}, cambiar` : 'Asignar mesa'
                        }
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Armchair className="text-muted-foreground" aria-hidden="true" />
                          <span className="truncate font-semibold">
                            {r.table_label ?? 'Asignar'}
                          </span>
                        </span>
                        <ChevronRight className="text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </div>
                    <Field label="Personas" hint={`Reservaron ${r.estimated_guests}`}>
                      <NumberField
                        value={guestsDraft}
                        onValueChange={(n) => {
                          if (n !== null) bumpGuests(n)
                        }}
                        min={MIN_GUESTS}
                        max={MAX_GUESTS}
                        incrementLabel="Una persona más"
                        decrementLabel="Una persona menos"
                      />
                    </Field>
                  </div>
                ) : null}

                {r.status === 'no_show' ? (
                  <div className="flex flex-col gap-2">
                    <Callout tone="danger" icon={XCircle}>
                      Marcada como <strong className="font-medium text-foreground">no vino</strong>
                      {fmtStamp(r.updated_at) ? (
                        <>
                          {' '}
                          a las <span className="type-amount">{fmtStamp(r.updated_at)}</span>
                        </>
                      ) : null}
                      .
                    </Callout>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        className="flex-1"
                        onClick={() => {
                          void actions.revert(r.id, 'pending')
                          onClose()
                        }}
                      >
                        <RotateCcw aria-hidden="true" />
                        Apareció, esperar
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        className="flex-1"
                        onClick={() => onModeChange('arrive')}
                      >
                        <Check strokeWidth={2.5} aria-hidden="true" />
                        Llegó igual
                      </Button>
                    </div>
                  </div>
                ) : null}

                {r.status === 'closed' ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    onClick={() => {
                      void actions.revert(r.id, 'seated')
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    Reabrir mesa
                  </Button>
                ) : null}

                {/* Secundarias, escondidas: cerrar mesa (dueño) y reversos. */}
                {inside ? (
                  <div className="flex items-center justify-between gap-2">
                    {isOwner ? (
                      <Button type="button" variant="ghost" onClick={() => onModeChange('close')}>
                        <DoorClosed aria-hidden="true" />
                        Cerrar mesa
                      </Button>
                    ) : (
                      <span />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" aria-label="Más opciones">
                          <MoreHorizontal aria-hidden="true" />
                          Más
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {/* La RPC solo admite seated → arrived y arrived → pending:
                            desde "sentada" primero se vuelve a "llegó". */}
                        {r.status === 'seated' ? (
                          <DropdownMenuItem onSelect={() => void actions.revert(r.id, 'arrived')}>
                            <RotateCcw aria-hidden="true" />
                            {reverseLabel('seated')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void confirmNotArrived()}
                          >
                            <RotateCcw aria-hidden="true" />
                            Me equivoqué, no llegó
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ) : isFuture && r.status === 'pending' ? (
              <Callout tone="info">Todavía no es el día: las llegadas se marcan ese día.</Callout>
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
                <ChampagneChip count={r.champagne_count} />
              </div>
            ) : null}

            {r.comments ? (
              <div
                className={cn(
                  'rounded-lg px-3 py-2.5 type-body text-pretty',
                  r.highlight_comment ? 'bg-warning-soft font-medium' : 'bg-muted',
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
              // Una sola acción principal por vista: si arriba está «Llegó», sumar
              // puntos pasa a secundaria.
              primary={!(operable && (r.status === 'pending' || r.status === 'no_show'))}
              actions={actions}
            />

            {/* Datos fríos */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
              <Datum label="Servicio">{MEAL_TYPE_LABELS[r.meal_type]}</Datum>
              <Datum label="Naturaleza">{RESERVATION_KIND_LABELS[r.kind]}</Datum>
              <Datum label="Gestor">
                {r.primary_manager?.display_name ?? '—'}
                {r.assistant_manager ? (
                  <span className="text-muted-foreground">
                    {' '}
                    + {r.assistant_manager.display_name}
                  </span>
                ) : null}
              </Datum>
              <Datum label="Origen">{ORIGIN_LABELS[r.origin]}</Datum>
              {r.scheduled_event?.template ? (
                <Datum label="Evento">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: r.scheduled_event.template.color_hex }}
                    />
                    {r.scheduled_event.template.name}
                  </span>
                </Datum>
              ) : null}
              {r.deposit_cents > 0 ? (
                <Datum label="Seña">
                  <Amount cents={r.deposit_cents} decimals={0} />
                </Datum>
              ) : null}
              {phone ? (
                <Datum label="Teléfono">
                  <span className="type-amount">{formatPhoneForDisplay(phone)}</span>
                </Datum>
              ) : null}
            </dl>

            {/* Pie: la historia del turno + edición completa */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 type-caption text-muted-foreground">
              <span className="inline-flex flex-wrap items-center gap-x-2 tabular-nums">
                <Clock className="size-3.5" aria-hidden="true" />
                {fmtStamp(r.arrived_at) ? <span>llegó {fmtStamp(r.arrived_at)}</span> : null}
                {fmtStamp(r.seated_at) ? <span>· sentada {fmtStamp(r.seated_at)}</span> : null}
                {fmtStamp(r.closed_at) ? <span>· cerrada {fmtStamp(r.closed_at)}</span> : null}
                {!r.arrived_at && !r.closed_at ? <span>sin movimientos todavía</span> : null}
              </span>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/${tenantSlug}/reservas/${r.id}`} prefetch={false}>
                  <Pencil aria-hidden="true" />
                  Edición completa
                </Link>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Un dato de la reserva: etiqueta chica arriba, valor abajo. */
function Datum({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-caption text-muted-foreground">{label}</dt>
      <dd className="truncate type-body font-medium">{children}</dd>
    </div>
  )
}
