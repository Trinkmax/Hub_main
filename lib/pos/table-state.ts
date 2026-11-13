/**
 * En qué está cada mesa — PURO y testeado.
 *
 * El mapa tiene que decir, sin tocar nada, qué le pasa a cada mesa y cuál pide
 * atención primero. Todo sale de datos que ya existen (la mesa abierta, sus
 * tandas, la reserva): nadie marca un estado a mano.
 *
 * Cuando una mesa está en más de una situación gana la que no puede esperar:
 *   comida lista sin llevar > pidió la cuenta > esperando comida > comiendo > sin pedido.
 */
import type { FloorReservation, FloorSession, PosThresholds } from './types'
import { DEFAULT_THRESHOLDS } from './types'

export type TableStateKey = 'free' | 'reserved' | 'seated' | 'kitchen' | 'ready' | 'eating' | 'bill'

/** none = todo bien · warn = miralo · late = ya es tarde. */
export type Urgency = 'none' | 'warn' | 'late'

export type TableState = {
  key: TableStateKey
  urgency: Urgency
  /** Minutos que lleva en este estado (lo que muestra el reloj de la mesa). */
  minutes: number | null
  /** Hay una tanda cargada esperando y ya no queda nada en cocina: hora de marcharla. */
  nextCourseDue: boolean
  /** Tandas en espera («después»). */
  heldTickets: number
  /** La reserva que explica el estado «reservada», o la próxima de esta mesa si está libre. */
  reservation: FloorReservation | null
  /** Minutos que faltan para la reserva (negativo = ya pasó la hora). */
  reservationIn: number | null
}

export const STATE_LABEL: Record<TableStateKey, string> = {
  free: 'Libre',
  reserved: 'Reservada',
  seated: 'Sin pedido',
  kitchen: 'En cocina',
  ready: 'Para llevar',
  eating: 'Comiendo',
  bill: 'Cuenta',
}

/** Cuánto antes de la hora una reserva «toma» su mesa en el mapa. */
export const RESERVATION_HOLD_BEFORE_MIN = 45
/** Cuánto después de la hora la sigue tomando si nadie llegó. */
export const RESERVATION_HOLD_AFTER_MIN = 45
/** Corte del día de servicio: antes de las 5 sigue siendo la noche anterior. */
const ROLLOVER_HOUR = 5

function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}

function escalate(minutes: number | null, warnAt: number, lateAt: number): Urgency {
  if (minutes === null) return 'none'
  if (minutes >= lateAt) return 'late'
  if (minutes >= warnAt) return 'warn'
  return 'none'
}

/**
 * Minutos del día de servicio para una hora «HH:MM»: las horas de la madrugada
 * (antes de las 5) van después de la medianoche, así 00:30 queda más tarde que 23:00.
 */
export function serviceMinutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return (h < ROLLOVER_HOUR ? h + 24 : h) * 60 + m
}

/** Minutos del día de servicio de un instante, en la zona horaria del bar. */
export function serviceMinutesAt(now: Date, timeZone = 'America/Argentina/Cordoba'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return (h < ROLLOVER_HOUR ? h + 24 : h) * 60 + m
}

/** Las mesas que nombra la etiqueta libre de una reserva: «12», «12+13», «Barra». */
export function tablesOfLabel(label: string | null): string[] {
  if (!label) return []
  return label
    .split(/[+,/]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
}

/**
 * La reserva que le corresponde a una mesa: la más próxima entre las que la
 * nombran. Las que ya llegaron («arrived») van primero: esa gente está esperando.
 */
export function reservationForTable(
  tableLabel: string,
  reservations: readonly FloorReservation[],
  nowServiceMinutes: number,
): { reservation: FloorReservation; inMinutes: number } | null {
  const wanted = tableLabel.trim().toLowerCase()
  if (!wanted) return null
  let best: { reservation: FloorReservation; inMinutes: number; rank: number } | null = null
  for (const reservation of reservations) {
    if (!tablesOfLabel(reservation.table_label).includes(wanted)) continue
    const at = serviceMinutesOf(reservation.time)
    if (at === null) continue
    const inMinutes = at - nowServiceMinutes
    // Las que ya llegaron ganan; después, la más cercana en el tiempo.
    const rank = (reservation.status === 'arrived' ? -100_000 : 0) + Math.abs(inMinutes)
    if (!best || rank < best.rank) best = { reservation, inMinutes, rank }
  }
  return best ? { reservation: best.reservation, inMinutes: best.inMinutes } : null
}

const FREE: TableState = {
  key: 'free',
  urgency: 'none',
  minutes: null,
  nextCourseDue: false,
  heldTickets: 0,
  reservation: null,
  reservationIn: null,
}

/** Estado de una mesa sin gente: libre, o tomada por una reserva que está por llegar. */
export function deriveFreeState(
  match: { reservation: FloorReservation; inMinutes: number } | null,
): TableState {
  if (!match) return FREE
  const { reservation, inMinutes } = match
  const arrived = reservation.status === 'arrived'
  const holding =
    arrived ||
    (inMinutes <= RESERVATION_HOLD_BEFORE_MIN && inMinutes >= -RESERVATION_HOLD_AFTER_MIN)
  if (!holding) {
    // Libre por ahora; la reserva queda de dato para que nadie siente a alguien que no llega a irse.
    return { ...FREE, reservation, reservationIn: inMinutes }
  }
  return {
    key: 'reserved',
    // Llegaron y nadie los sentó, o ya pasó la hora: miralo.
    urgency: arrived ? 'warn' : inMinutes < -15 ? 'warn' : 'none',
    minutes: inMinutes < 0 ? -inMinutes : null,
    nextCourseDue: false,
    heldTickets: 0,
    reservation,
    reservationIn: inMinutes,
  }
}

/** Estado de una mesa abierta. */
export function deriveSessionState(
  session: FloorSession,
  nowMs: number,
  thresholds: PosThresholds | null = null,
): TableState {
  const t = thresholds ?? DEFAULT_THRESHOLDS
  const inKitchen = session.items_queued + session.items_preparing
  const base = {
    nextCourseDue: false,
    heldTickets: session.held_tickets,
    reservation: null,
    reservationIn: null,
  }

  if (session.items_ready > 0) {
    const minutes = minutesSince(session.ready_since, nowMs)
    return {
      ...base,
      key: 'ready',
      minutes,
      // Lista y sin llevar siempre pide atención: la comida se enfría.
      urgency:
        escalate(minutes, t.ready_warn_minutes, t.ready_warn_minutes * 3) === 'late'
          ? 'late'
          : 'warn',
    }
  }

  if (session.bill_requested_at) {
    const minutes = minutesSince(session.bill_requested_at, nowMs)
    return {
      ...base,
      key: 'bill',
      minutes,
      urgency: escalate(minutes, t.bill_warn_minutes, t.bill_warn_minutes * 2),
    }
  }

  if (inKitchen > 0) {
    const minutes = minutesSince(session.waiting_since, nowMs)
    return {
      ...base,
      key: 'kitchen',
      minutes,
      urgency: escalate(minutes, t.kitchen_warn_minutes, t.kitchen_late_minutes),
    }
  }

  if (session.items_served > 0) {
    return {
      ...base,
      key: 'eating',
      minutes: minutesSince(session.last_served_at, nowMs),
      urgency: 'none',
      nextCourseDue: session.held_tickets > 0,
    }
  }

  // Sentada: sin pedido, o con todo en espera.
  const minutes = minutesSince(session.opened_at, nowMs)
  return {
    ...base,
    key: 'seated',
    minutes,
    urgency:
      session.held_tickets > 0
        ? 'none'
        : escalate(minutes, t.order_warn_minutes, t.order_warn_minutes * 2),
    nextCourseDue: session.held_tickets > 0,
  }
}

/** Orden de «qué miro primero»: menor = más urgente. */
export function attentionRank(state: TableState): number {
  const byKey: Record<TableStateKey, number> = {
    ready: 0,
    bill: 2,
    kitchen: 3,
    seated: 4,
    reserved: 5,
    eating: 6,
    free: 8,
  }
  const base = byKey[state.key]
  if (state.urgency === 'late') return base === 0 ? -2 : -1 + base / 10
  if (state.urgency === 'warn') return base + 0.1
  if (state.nextCourseDue) return base + 0.2
  return base + 1
}

/** ¿Esta mesa tiene algo pendiente de alguien del salón? (lo que cuenta cada pestaña de sector) */
export function needsAttention(state: TableState): boolean {
  return (
    state.key === 'ready' || state.key === 'bill' || state.urgency !== 'none' || state.nextCourseDue
  )
}

export type FloorSummary = {
  tables: number
  open: number
  free: number
  people: number
  /** Mesas esperando comida (en cocina). */
  waitingFood: number
  /** Mesas con comida lista sin llevar. */
  ready: number
  /** Mesas demoradas (en rojo). */
  late: number
  /** Mesas que pidieron la cuenta. */
  bill: number
  /** Mesas tomadas por una reserva que está por llegar. */
  reserved: number
}

export function summarize(
  entries: readonly { state: TableState; partySize: number | null }[],
): FloorSummary {
  const summary: FloorSummary = {
    tables: entries.length,
    open: 0,
    free: 0,
    people: 0,
    waitingFood: 0,
    ready: 0,
    late: 0,
    bill: 0,
    reserved: 0,
  }
  for (const { state, partySize } of entries) {
    if (state.key === 'free') summary.free++
    else if (state.key === 'reserved') summary.reserved++
    else {
      summary.open++
      summary.people += partySize ?? 0
    }
    if (state.key === 'kitchen') summary.waitingFood++
    if (state.key === 'ready') summary.ready++
    if (state.key === 'bill') summary.bill++
    if (state.urgency === 'late') summary.late++
  }
  return summary
}

/** «12 min», «1 h 05». Corto: entra en la bandera de una mesa. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** «12′», «1h05». Más corto todavía: para la mesa chica. */
export function formatMinutesTight(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes < 60) return `${minutes}′`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}
