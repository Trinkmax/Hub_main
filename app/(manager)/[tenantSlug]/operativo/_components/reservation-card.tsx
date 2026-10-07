'use client'

import { Check, GlassWater, MessageSquareMore, RotateCcw, Sparkles, Users } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TierBadge } from '@/components/loyalty/tier-badge'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/dates'
import type { RecentQrAward } from '@/lib/points/queries'
import { highestSeverity, resolveReservationAlerts, SERVICE_ALERT_META } from '@/lib/salon/alerts'
import { minutesUntil, relativeTimeLabel, type Urgency } from '@/lib/salon/operativo'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'
import type { ReservationWithJoins } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { HighlightText } from './highlight-text'

function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

/** 'HH:mm' del reloj del bar a partir de un timestamp ISO (a mano, sin `Intl`). */
function fmtStamp(iso: string | null): string | null {
  return iso ? formatTime(iso) || null : null
}

/**
 * La superficie según el momento. Tokens suaves del kit, sin opacidad sobre el
 * texto: lo terminado se apaga con el fondo, no bajando el contraste.
 */
const SURFACE: Record<Urgency, string> = {
  late: 'border-warning bg-warning-soft',
  soon: 'border-border bg-card',
  later: 'border-border bg-card',
  inside: 'border-success/40 bg-success-soft/60',
  done: 'border-border bg-muted',
  cancelled: 'border-border bg-muted',
}

/**
 * Una reserva en el tablero. Tres zonas, tres gestos:
 *
 *  - el RIEL de la izquierda cambia de dato con el estado: antes de llegar es
 *    la HORA; una vez adentro es la MESA (grande, porque "¿dónde está la de
 *    Pérez?" se responde mirando, no leyendo). Tocarlo edita la mesa.
 *  - el CENTRO es la reserva (nombre, avisos, torta, gestor) y abre la ficha.
 *  - la DERECHA es la acción del momento: "Llegó" mientras espera, el tilde
 *    cuando entró, "Apareció" si se la había dado por perdida.
 *
 * La tarjeta no se mueve de lugar al cambiar de estado: la lista es el tiempo.
 * «Llegó» es la acción principal del kit (verde en claro, dorado en oscuro);
 * el verde de «adentro» queda para el estado, no para el botón.
 */
export function ReservationCard({
  reservation: r,
  urgency,
  clock,
  query,
  suffix,
  award,
  selected,
  remoteTouched,
  canOperate,
  index,
  onOpen,
  onArrive,
  onNoShow,
  onReappear,
  onTable,
}: {
  reservation: ReservationWithJoins
  urgency: Urgency
  clock: number | null
  query: string
  /** "…4821" cuando hay otra reserva con el mismo nombre. */
  suffix: string | null
  award: RecentQrAward | null
  selected: boolean
  remoteTouched: boolean
  canOperate: boolean
  index: number
  onOpen: () => void
  onArrive: () => void
  onNoShow: () => void
  onReappear: () => void
  onTable: () => void
}) {
  const reduced = useReducedMotion()
  const alerts = resolveReservationAlerts(r.service_alerts, r.customer?.service_alerts)
  const tone = highestSeverity(alerts)
  const guests = r.actual_guests ?? r.estimated_guests
  const inside = r.status === 'arrived' || r.status === 'seated'
  const done = r.status === 'closed' || r.status === 'no_show'
  const diff = clock !== null && r.status === 'pending' ? minutesUntil(r, clock) : null
  const late = urgency === 'late'
  const tplColor = r.scheduled_event?.template?.color_hex
  const tier = r.customer?.tier ?? null
  // Dónde se sienta, con `placeLabel` como en todas las pantallas: la planta,
  // el evento sin planta ("Pizza libre") o los dos ("Pizza libre · Planta
  // Alta"). Antes una de evento con planta decía solo "Planta Alta" y no se
  // sabía que venía al evento.
  const zone = placeLabel(r, joinedEventName(r))
  const arrivedAt = fmtStamp(r.arrived_at)
  const closedAt = fmtStamp(r.closed_at)
  // Lo que un lector de pantalla tiene que saber de la fila, en una frase.
  const summary = [
    `${fmtTime(r.reservation_time_local)} ${r.guest_name}`,
    `${guests} ${guests === 1 ? 'persona' : 'personas'}`,
    r.table_label ? `mesa ${r.table_label}` : null,
    statusSentence(r.status, late),
    ...alerts.map((a) => SERVICE_ALERT_META[a.alert].label),
    r.cake_count > 0 ? 'con torta' : null,
    tier ? `nivel ${tier.name}` : null,
    r.comments ? 'con nota' : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <article
      aria-label={summary}
      data-status={r.status}
      className={cn(
        'group relative grid min-h-[84px] grid-cols-[3.5rem_minmax(0,1fr)_auto] items-stretch gap-x-3 overflow-hidden rounded-xl border px-3 py-2.5 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:px-4',
        'transition-[background-color,border-color] duration-(--duration-overlay) ease-(--ease-ui) motion-reduce:transition-none',
        SURFACE[urgency],
        // Elegida (la que se ve en el panel): el vocabulario de «una tarjeta elegida» del kit.
        selected && 'border-primary ring-1 ring-primary',
        tone === 'critical' && !done && 'outline-2 -outline-offset-2 outline-destructive',
        remoteTouched && 'bg-info-soft',
      )}
    >
      {/* Riel: hora → mesa */}
      <button
        type="button"
        onClick={inside && canOperate ? onTable : onOpen}
        aria-label={
          inside
            ? r.table_label
              ? `Mesa ${r.table_label}, cambiar`
              : 'Asignar mesa'
            : `Abrir reserva de ${r.guest_name}`
        }
        className="-my-2.5 -ml-3 flex flex-col items-center justify-center rounded-l-xl py-2 pl-3 text-center outline-(--ring) -outline-offset-2 hover:bg-hover focus-visible:outline-2 sm:-ml-4 sm:pl-4"
      >
        <AnimatePresence mode="wait" initial={false}>
          {inside ? (
            <motion.span
              key="table"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex flex-col items-center"
            >
              {r.table_label ? (
                <span
                  className={cn(
                    'leading-none font-semibold tracking-tight type-amount',
                    r.table_label.length <= 3
                      ? 'text-2xl'
                      : r.table_label.length <= 6
                        ? 'text-lg'
                        : 'text-sm',
                  )}
                >
                  {r.table_label}
                </span>
              ) : (
                <span className="rounded-sm border border-dashed border-warning px-1.5 type-caption font-semibold text-warning-text">
                  Mesa?
                </span>
              )}
              <span className="mt-1 type-caption text-muted-foreground type-amount">
                {fmtTime(r.reservation_time_local)}
              </span>
            </motion.span>
          ) : (
            <motion.span
              key="time"
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex flex-col items-center"
            >
              <span
                className={cn(
                  'text-base leading-none font-semibold type-amount',
                  late && 'text-warning-text',
                  r.status === 'no_show' && 'text-muted-foreground line-through',
                )}
              >
                {fmtTime(r.reservation_time_local)}
              </span>
              {diff !== null && (late || urgency === 'soon') ? (
                <span
                  className={cn(
                    'mt-1 type-caption font-medium tabular-nums',
                    late ? 'text-warning-text' : 'text-muted-foreground',
                  )}
                >
                  {relativeTimeLabel(diff)}
                </span>
              ) : (
                <span className="mt-1 inline-flex items-center gap-0.5 type-caption text-muted-foreground tabular-nums">
                  <Users className="size-3" aria-hidden="true" />
                  {guests}
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Centro: la reserva */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 rounded-lg py-0.5 text-left outline-(--ring) outline-offset-2 focus-visible:outline-2"
        aria-label={`Ver ficha de ${r.guest_name}`}
      >
        {/* Con `flex-wrap`, si el nombre y el nivel no entran juntos, el nivel baja
            un renglón: en el celular el nombre se leía «Santiago …». */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span
            className={cn(
              'min-w-0 truncate type-subtitle',
              r.status === 'no_show' && 'text-muted-foreground line-through',
            )}
          >
            <HighlightText text={r.guest_name} query={query} />
          </span>
          {suffix ? (
            <span className="shrink-0 type-caption text-muted-foreground type-amount">
              {suffix}
            </span>
          ) : null}
          {tier ? <TierBadge tier={tier} className="shrink-0" /> : null}
          {r.champagne_count > 0 ? (
            <GlassWater className="size-3.5 shrink-0 text-primary" aria-label="Champagne" />
          ) : null}
        </div>

        {/* Chips: lo crítico primero, siempre visible. */}
        {alerts.length > 0 || r.cake_count > 0 || r.kind !== 'normal' ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <ServiceAlertChips alerts={alerts} size="xs" />
            {r.cake_count > 0 ? (
              <CakeChip count={r.cake_count} option={r.cake_option} optionId={r.cake_option_id} />
            ) : r.kind !== 'normal' ? (
              <CelebrationChip kind={r.kind} compact />
            ) : null}
          </div>
        ) : null}

        {r.highlight_comment && r.comments ? (
          <p className="mt-1 line-clamp-2 type-caption font-medium text-foreground">{r.comments}</p>
        ) : null}

        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 type-caption text-muted-foreground">
          {inside ? (
            <span className="inline-flex items-center gap-1 font-medium text-success-text">
              <Users className="size-3" aria-hidden="true" />
              <span className="tabular-nums">{guests}</span>
              {r.actual_guests !== null && r.actual_guests !== r.estimated_guests ? (
                <span className="font-normal text-muted-foreground">(de {r.estimated_guests})</span>
              ) : null}
            </span>
          ) : null}
          {inside ? <span aria-hidden="true">·</span> : null}
          <span className="inline-flex min-w-0 items-center gap-1">
            {/* La tinta del evento, como en el calendario: un punto, no una franja. */}
            {tplColor && r.status !== 'cancelled' ? (
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: tplColor }}
              />
            ) : null}
            {zone}
          </span>
          {r.primary_manager ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{r.primary_manager.display_name}</span>
            </>
          ) : null}
          {r.comments && !r.highlight_comment ? (
            <>
              <span aria-hidden="true">·</span>
              <MessageSquareMore className="size-3" aria-label="Tiene nota" />
            </>
          ) : null}
          {award ? (
            <>
              <span aria-hidden="true">·</span>
              <Badge tone="gold" icon={Sparkles} className="type-amount">
                +{award.points} pts
              </Badge>
            </>
          ) : null}
        </p>
      </button>

      {/* Derecha: la acción del momento */}
      <div className="flex flex-col items-end justify-center gap-1">
        <AnimatePresence mode="wait" initial={false}>
          {r.status === 'pending' && canOperate ? (
            <motion.div
              key="pending"
              initial={reduced ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.16 }}
              className="flex flex-col items-end gap-1"
            >
              <Button
                type="button"
                onClick={onArrive}
                aria-label={`Marcar que ${r.guest_name} llegó`}
              >
                <Check strokeWidth={2.5} aria-hidden="true" />
                Llegó
              </Button>
              {late ? (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  onClick={onNoShow}
                  aria-label={`Marcar que ${r.guest_name} no vino`}
                >
                  No vino
                </Button>
              ) : null}
            </motion.div>
          ) : inside ? (
            <motion.div
              key="inside"
              initial={reduced ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              className="flex flex-col items-center"
            >
              <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success-text">
                <Check className="size-5" strokeWidth={2.6} aria-hidden="true" />
              </span>
              {arrivedAt ? (
                <span className="mt-1 type-caption text-muted-foreground type-amount">
                  {arrivedAt}
                </span>
              ) : null}
            </motion.div>
          ) : r.status === 'no_show' && canOperate ? (
            <motion.div
              key="noshow"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onReappear}
                aria-label={`${r.guest_name} apareció: volver a esperar`}
              >
                <RotateCcw aria-hidden="true" />
                Apareció
              </Button>
            </motion.div>
          ) : r.status === 'closed' ? (
            <motion.span
              key="closed"
              initial={false}
              animate={{ opacity: 1 }}
              className="text-right type-caption text-muted-foreground"
            >
              Cerrada
              {closedAt ? <span className="block type-amount">{closedAt}</span> : null}
            </motion.span>
          ) : r.status === 'no_show' ? (
            <span key="noshow-ro" className="type-caption font-medium text-destructive-text">
              No vino
            </span>
          ) : (
            <span key="pending-ro" className="type-caption text-muted-foreground">
              {index >= 0 ? 'Pendiente' : ''}
            </span>
          )}
        </AnimatePresence>
      </div>
    </article>
  )
}

function statusSentence(status: ReservationWithJoins['status'], late: boolean): string {
  switch (status) {
    case 'pending':
      return late ? 'atrasada' : 'por llegar'
    case 'arrived':
    case 'seated':
      return 'adentro'
    case 'closed':
      return 'cerrada'
    case 'no_show':
      return 'no vino'
    default:
      return 'cancelada'
  }
}
