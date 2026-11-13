/**
 * Cómo se lee una tanda — PURO.
 *
 * El mozo no marca estados: salen de lo que ya pasó (se mandó, cocina la vio, la empezó, está lista,
 * se sirvió). Acá se decide qué palabra, qué tildes y qué reloj muestra cada tanda, cuál es el botón
 * que manda abajo y cómo se ve la mesa mientras el servidor confirma lo que el mozo acaba de tocar.
 */
import type {
  PosThresholds,
  PrepStatus,
  SessionDetail,
  SessionItem,
  SessionTicket,
} from '@/lib/pos/types'
import { DEFAULT_THRESHOLDS } from '@/lib/pos/types'
import { minutesSince } from './clock'

/** El servidor acepta tiempos del 1 al 9. */
export const MAX_COURSE = 9

export type TicketStage =
  /** Cargada y esperando: cocina no la ve hasta que se marcha. */
  | 'held'
  /** El servidor la tiene (un tilde). */
  | 'sent'
  /** Una pantalla de cocina la mostró (dos tildes). */
  | 'seen'
  | 'preparing'
  /** Algo ya está para llevar y algo todavía se está haciendo. */
  | 'partly_ready'
  | 'ready'
  | 'served'
  /** Todos los renglones dados de baja. */
  | 'cancelled'

export const STAGE_WORD: Record<TicketStage, string> = {
  held: 'En espera',
  sent: 'Enviada',
  seen: 'Cocina lo vio',
  preparing: 'En preparación',
  partly_ready: 'Lista en parte',
  ready: 'Lista',
  served: 'Servida',
  cancelled: 'Dada de baja',
}

export type LineState = PrepStatus | 'cancelled'

export const LINE_WORD: Record<LineState, string> = {
  queued: 'En cola',
  preparing: 'En preparación',
  ready: 'Listo',
  served: 'Servido',
  cancelled: 'Dado de baja',
}

export function lineState(item: Pick<SessionItem, 'prep_status' | 'cancelled_at'>): LineState {
  return item.cancelled_at ? 'cancelled' : item.prep_status
}

export type TicketCounts = {
  /** Renglones que siguen en pie. */
  live: number
  queued: number
  preparing: number
  ready: number
  served: number
  cancelled: number
}

export function countLines(ticket: Pick<SessionTicket, 'items'>): TicketCounts {
  const counts: TicketCounts = {
    live: 0,
    queued: 0,
    preparing: 0,
    ready: 0,
    served: 0,
    cancelled: 0,
  }
  for (const item of ticket.items) {
    const state = lineState(item)
    counts[state]++
    if (state !== 'cancelled') counts.live++
  }
  return counts
}

export type TicketDisplay = {
  stage: TicketStage
  /** 0 = cocina todavía no la tiene · 1 = enviada · 2 = cocina la vio. */
  ticks: 0 | 1 | 2
  word: string
  /** Minutos en lo que importa de esta etapa: esperando comida, lista sin llevar, en espera. */
  minutes: number | null
  /** Lleva en cocina más de lo que el bar tolera. */
  late: boolean
  /** Los renglones no están todos en lo mismo: cada uno dice su estado con palabra. */
  mixed: boolean
  counts: TicketCounts
}

function earliest(values: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const value of values) {
    if (value && (best === null || Date.parse(value) < Date.parse(best))) best = value
  }
  return best
}

/**
 * La etapa de una tanda sale de sus renglones (no del estado guardado, que puede venir un paso
 * atrás): lo listo sin llevar manda sobre lo que se está haciendo, y eso sobre lo que espera.
 */
export function ticketDisplay(
  ticket: SessionTicket,
  nowMs: number,
  thresholds: Pick<PosThresholds, 'kitchen_late_minutes'> | null = null,
): TicketDisplay {
  const counts = countLines(ticket)
  const lateAt = (thresholds ?? DEFAULT_THRESHOLDS).kitchen_late_minutes
  const fired = ticket.fired_at !== null
  const seen = ticket.kitchen_seen_at !== null
  const states = new Set(ticket.items.map(lineState))
  states.delete('cancelled')
  const base = { counts, mixed: states.size > 1 }
  const make = (
    stage: TicketStage,
    ticks: 0 | 1 | 2,
    minutes: number | null,
    late = false,
  ): TicketDisplay => ({ ...base, stage, ticks, word: STAGE_WORD[stage], minutes, late })

  if (counts.live === 0) return make('cancelled', fired ? 1 : 0, null)
  if (!fired) return make('held', 0, minutesSince(ticket.submitted_at, nowMs))
  if (counts.served === counts.live) return make('served', 2, null)

  if (counts.ready > 0) {
    const since = earliest(
      ticket.items.filter((i) => lineState(i) === 'ready').map((i) => i.ready_at),
    )
    const stage = counts.queued + counts.preparing > 0 ? 'partly_ready' : 'ready'
    return make(stage, 2, minutesSince(since ?? ticket.ready_at, nowMs))
  }

  const waiting = minutesSince(ticket.fired_at, nowMs)
  const late = waiting !== null && waiting >= lateAt
  // Si ya hay algo servido o empezado, cocina la vio aunque ninguna pantalla lo haya avisado.
  if (counts.preparing > 0 || counts.served > 0) return make('preparing', 2, waiting, late)
  return make(seen ? 'seen' : 'sent', seen ? 2 : 1, waiting, late)
}

// ─── Números de tanda ────────────────────────────────────────────────────────

/**
 * El tiempo con el que sale la próxima tanda: 1 la primera y uno más por cada tanda (vaya ahora o
 * quede en espera). Cuenta también las que todavía no confirmó el servidor.
 */
export function nextCourse(
  tickets: readonly Pick<SessionTicket, 'course'>[],
  pendingCourses: readonly number[] = [],
): number {
  let max = 0
  for (const ticket of tickets) max = Math.max(max, ticket.course)
  for (const course of pendingCourses) max = Math.max(max, course)
  return Math.min(MAX_COURSE, max + 1)
}

/**
 * El número que se muestra en cada tanda («Tanda 3»). Es su tiempo, salvo que se repita (dos
 * celulares mandando a la vez, o más de nueve tandas): ahí sigue contando. Nunca se repite ni baja.
 */
export function tandaNumbers(courses: readonly number[]): number[] {
  const numbers: number[] = []
  let last = 0
  for (const course of courses) {
    last = Math.max(course, last + 1)
    numbers.push(last)
  }
  return numbers
}

// ─── La mesa entera ──────────────────────────────────────────────────────────

export type SessionSummary = {
  /** Renglones que cocina tiene y todavía no terminó. */
  inKitchen: number
  /** Unidades listas sin llevar. */
  readyUnits: number
  readyItemIds: string[]
  /** «2 Mojito · 1 Lomo»: lo listo, para leerlo de un vistazo sin buscar la tanda. */
  readyLabel: string
  servedLines: number
  /** Tandas en espera, de la más vieja a la más nueva. */
  held: SessionTicket[]
  /** Hay al menos una tanda viva. */
  hasOrders: boolean
}

export function summarizeSession(tickets: readonly SessionTicket[]): SessionSummary {
  const summary: SessionSummary = {
    inKitchen: 0,
    readyUnits: 0,
    readyItemIds: [],
    readyLabel: '',
    servedLines: 0,
    held: [],
    hasOrders: false,
  }
  const readyNames: string[] = []
  for (const ticket of tickets) {
    const counts = countLines(ticket)
    if (counts.live === 0) continue
    summary.hasOrders = true
    if (ticket.fired_at === null) {
      summary.held.push(ticket)
      continue
    }
    summary.inKitchen += counts.queued + counts.preparing
    summary.servedLines += counts.served
    for (const item of ticket.items) {
      if (lineState(item) !== 'ready') continue
      summary.readyUnits += item.quantity
      summary.readyItemIds.push(item.id)
      readyNames.push(`${item.quantity} ${item.name}`)
    }
  }
  summary.readyLabel = readyNames.join(' · ')
  return summary
}

export type BarPrimary =
  /** Hay un borrador: mandarlo. */
  | { kind: 'send'; units: number }
  /** Hay comida lista: llevarla. */
  | { kind: 'serve'; units: number; itemIds: string[] }
  /** No queda nada en cocina y hay una tanda esperando: marcharla. */
  | { kind: 'fire'; ticketId: string }
  /** Nada pendiente: lo que sigue es cargar. */
  | { kind: 'add' }

/** El botón que manda abajo. Uno solo, por prioridad: lo sin enviar › lo listo › lo que espera. */
export function barPrimary(draftUnits: number, summary: SessionSummary): BarPrimary {
  if (draftUnits > 0) return { kind: 'send', units: draftUnits }
  if (summary.readyUnits > 0) {
    return { kind: 'serve', units: summary.readyUnits, itemIds: summary.readyItemIds }
  }
  const held = summary.held[0]
  if (held && summary.inKitchen === 0) return { kind: 'fire', ticketId: held.id }
  return { kind: 'add' }
}

/** Renglones que pasaron a «listo» desde la última lectura: para el aviso y la vibración. */
export function newlyReady(
  before: ReadonlySet<string>,
  tickets: readonly SessionTicket[],
): string[] {
  return summarizeSession(tickets).readyItemIds.filter((id) => !before.has(id))
}

// ─── Lo que el mozo acaba de tocar ───────────────────────────────────────────

/**
 * Cambios que ya se ven en pantalla mientras el servidor los confirma. Cuando llega la lectura
 * nueva, se sacan; si el servidor dijo que no, también (y se avisa).
 */
export type Overlay = {
  /** Renglones marcados servidos. */
  served: readonly string[]
  /** Tandas marchadas. */
  fired: readonly string[]
  /** `null` = sin tocar. */
  bill: boolean | null
  partySize: number | null
  /** `undefined` = sin tocar · `null` = se borró el nombre. */
  alias?: string | null
}

export const NO_OVERLAY: Overlay = { served: [], fired: [], bill: null, partySize: null }

export function applyOverlay(
  detail: SessionDetail,
  overlay: Overlay,
  nowIso: string,
): SessionDetail {
  const untouched =
    overlay.served.length === 0 &&
    overlay.fired.length === 0 &&
    overlay.bill === null &&
    overlay.partySize === null &&
    overlay.alias === undefined
  if (untouched) return detail

  const served = new Set(overlay.served)
  const fired = new Set(overlay.fired)
  const tickets = detail.tickets.map((ticket) => {
    const firing = fired.has(ticket.id) && ticket.fired_at === null
    const touched = ticket.items.some((item) => served.has(item.id))
    if (!firing && !touched) return ticket
    return {
      ...ticket,
      held: firing ? false : ticket.held,
      fired_at: firing ? nowIso : ticket.fired_at,
      items: ticket.items.map((item) =>
        served.has(item.id) && !item.cancelled_at && item.prep_status !== 'served'
          ? { ...item, prep_status: 'served' as const, served_at: nowIso }
          : item,
      ),
    }
  })

  return {
    ...detail,
    session: {
      ...detail.session,
      party_size: overlay.partySize ?? detail.session.party_size,
      alias: overlay.alias === undefined ? detail.session.alias : overlay.alias,
      bill_requested_at:
        overlay.bill === null
          ? detail.session.bill_requested_at
          : overlay.bill
            ? (detail.session.bill_requested_at ?? nowIso)
            : null,
    },
    tickets,
  }
}
