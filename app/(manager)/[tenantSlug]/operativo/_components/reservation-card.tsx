'use client'

import { Check, GlassWater, MessageSquareMore, RotateCcw, Sparkles, Users } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CakeChip } from '@/components/reservations/cake-chip'
import { CelebrationChip } from '@/components/reservations/celebration-chip'
import { ServiceAlertChips } from '@/components/reservations/service-alert-chips'
import type { RecentQrAward } from '@/lib/points/queries'
import { highestSeverity, resolveReservationAlerts, SERVICE_ALERT_META } from '@/lib/salon/alerts'
import { minutesUntil, relativeTimeLabel, type Urgency } from '@/lib/salon/operativo'
import { type ReservationWithJoins, ZONE_LABELS } from '@/lib/salon/types'
import { cn } from '@/lib/utils'
import { HighlightText } from './highlight-text'

function fmtTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

/** 'HH:mm' del reloj del bar a partir de un timestamp ISO. */
function fmtStamp(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Argentina/Cordoba',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

const SURFACE: Record<Urgency, string> = {
  late: 'border-warning/50 bg-warning/6',
  soon: 'border-border/70 bg-card',
  later: 'border-border/70 bg-card',
  inside: 'border-success/40 bg-success/6',
  done: 'border-border/50 bg-card/60',
  cancelled: 'border-border/50 bg-muted/40',
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
  const veryLate = late && diff !== null && diff <= -30
  const tplColor = r.scheduled_event?.template?.color_hex
  const tier = r.customer?.tier ?? null
  const zone =
    r.zone === 'event_floating'
      ? (r.scheduled_event?.template?.name ?? 'Evento')
      : ZONE_LABELS[r.zone]
  const arrivedAt = fmtStamp(r.arrived_at)
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
        'card-hairline group relative grid min-h-[84px] grid-cols-[3.5rem_minmax(0,1fr)_auto] items-stretch gap-x-3 overflow-hidden rounded-2xl border px-3 py-2.5 shadow-xs transition-[background-color,border-color,box-shadow,opacity] duration-(--duration-slow) ease-(--ease-out) sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:px-4',
        SURFACE[urgency],
        done && 'opacity-75',
        selected && 'ring-2 ring-primary/40',
        tone === 'critical' &&
          !done &&
          'outline outline-2 -outline-offset-2 outline-destructive/45',
        remoteTouched && 'bg-info/10',
      )}
    >
      {/* Franja del evento: un elemento propio (no box-shadow inline) para que
          no pise el ring de selección ni la sombra de la tarjeta. */}
      {tplColor && r.status !== 'cancelled' ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: tplColor }}
        />
      ) : null}
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
        className="-my-2.5 -ml-3 flex flex-col items-center justify-center rounded-l-2xl py-2 pl-3 text-center transition-colors hover:bg-(--cream-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:-ml-4 sm:pl-4"
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
                    'font-serif font-semibold leading-none tracking-tight',
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
                <span className="rounded-md border border-dashed border-warning/70 px-1.5 py-0.5 text-[11px] font-semibold text-warning-text">
                  Mesa?
                </span>
              )}
              <span className="mt-1 font-mono text-[11px] leading-none text-muted-foreground tabular-nums">
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
                  'font-mono text-base font-semibold leading-none tabular-nums',
                  late && 'text-warning-text',
                  r.status === 'no_show' && 'text-muted-foreground line-through',
                )}
              >
                {fmtTime(r.reservation_time_local)}
              </span>
              {diff !== null && (late || urgency === 'soon') ? (
                <span
                  className={cn(
                    'mt-1 text-[11px] font-medium leading-none tabular-nums',
                    late ? 'text-warning-text' : 'text-muted-foreground',
                  )}
                >
                  {relativeTimeLabel(diff)}
                </span>
              ) : (
                <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] leading-none text-muted-foreground tabular-nums">
                  <Users className="size-3" aria-hidden />
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
        className="min-w-0 rounded-lg py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Ver ficha de ${r.guest_name}`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-[15px] font-semibold leading-tight',
              r.status === 'no_show' && 'text-muted-foreground line-through',
            )}
          >
            <HighlightText text={r.guest_name} query={query} />
          </span>
          {suffix ? (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{suffix}</span>
          ) : null}
          {tier ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
              style={{
                backgroundColor: `color-mix(in oklch, ${tier.color ?? 'var(--primary)'} 18%, transparent)`,
                color: tier.color ?? 'var(--primary)',
              }}
            >
              {tier.name}
            </span>
          ) : null}
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
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-foreground">
            {r.comments}
          </p>
        ) : null}

        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {inside ? (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <Users className="size-3" aria-hidden />
              <span className="tabular-nums">{guests}</span>
              {r.actual_guests !== null && r.actual_guests !== r.estimated_guests ? (
                <span className="text-muted-foreground">(de {r.estimated_guests})</span>
              ) : null}
            </span>
          ) : null}
          {inside ? <span aria-hidden>·</span> : null}
          <span>{zone}</span>
          {r.primary_manager ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{r.primary_manager.display_name}</span>
            </>
          ) : null}
          {r.comments && !r.highlight_comment ? (
            <>
              <span aria-hidden>·</span>
              <MessageSquareMore className="size-3" aria-label="Tiene nota" />
            </>
          ) : null}
          {award ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                <Sparkles className="size-3" aria-hidden />+{award.points} pts
              </span>
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
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16 }}
              className="flex flex-col items-end gap-1"
            >
              <button
                type="button"
                onClick={onArrive}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-success px-4 text-sm font-semibold text-success-foreground shadow-xs transition-[transform,filter] duration-(--duration-fast) hover:brightness-105 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Marcar que ${r.guest_name} llegó`}
              >
                <Check className="size-4" strokeWidth={2.5} aria-hidden />
                Llegó
              </button>
              {late ? (
                <button
                  type="button"
                  onClick={onNoShow}
                  className={cn(
                    'inline-flex h-10 items-center rounded-full px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    veryLate ? 'opacity-100' : 'opacity-80',
                  )}
                  aria-label={`Marcar que ${r.guest_name} no vino`}
                >
                  No vino
                </button>
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
              <span className="grid size-10 place-items-center rounded-full bg-success/15 text-success">
                <Check className="size-5" strokeWidth={2.6} aria-hidden />
              </span>
              {arrivedAt ? (
                <span className="mt-1 font-mono text-[10px] leading-none text-muted-foreground tabular-nums">
                  {arrivedAt}
                </span>
              ) : null}
            </motion.div>
          ) : r.status === 'no_show' && canOperate ? (
            <motion.button
              key="noshow"
              type="button"
              onClick={onReappear}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-xs font-medium transition-colors hover:bg-(--cream-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${r.guest_name} apareció: volver a esperar`}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Apareció
            </motion.button>
          ) : r.status === 'closed' ? (
            <motion.span
              key="closed"
              initial={false}
              animate={{ opacity: 1 }}
              className="text-right text-[11px] leading-tight text-muted-foreground"
            >
              Cerrada
              {fmtStamp(r.closed_at) ? (
                <span className="block font-mono tabular-nums">{fmtStamp(r.closed_at)}</span>
              ) : null}
            </motion.span>
          ) : r.status === 'no_show' ? (
            <span key="noshow-ro" className="text-[11px] font-medium text-destructive">
              No vino
            </span>
          ) : (
            <span key="pending-ro" className="text-[11px] text-muted-foreground">
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
