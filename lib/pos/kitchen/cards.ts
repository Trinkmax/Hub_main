/**
 * La cola de cocina convertida en comandas para UNA pantalla — PURO y testeado.
 *
 * Una comanda es una tanda («la mesa sale junta»). Cada pantalla elige qué
 * estaciones muestra: lo de esas estaciones son los renglones de la comanda, y
 * lo demás queda en una línea al pie para saber qué más espera la mesa.
 *
 * El estado de la comanda es el del renglón más atrasado de los que ESTA
 * pantalla muestra: si falta uno, la mesa no sale.
 */
import { isServiceAlert, SERVICE_ALERT_META, SERVICE_ALERTS } from '@/lib/salon/alerts'
import type { KitchenItem, KitchenQueue, KitchenTicket, MenuStation, PrepStatus } from '../types'

/** Nuevo → En preparación → Listo. */
export type CardStatus = 'queued' | 'preparing' | 'ready'

export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  queued: 'Nuevo',
  preparing: 'En preparación',
  ready: 'Listo',
}

/** Cómo se nombra el estado de lo que prepara OTRA estación, en la línea del pie. */
export const OTHER_STATUS_LABEL: Record<PrepStatus, string> = {
  queued: 'en cola',
  preparing: 'en preparación',
  ready: 'listos',
  served: 'entregados',
}

/** Cuánto queda a la vista una comanda lista, para poder deshacer. El mismo plazo que usa la base. */
export const READY_LINGER_MS = 10 * 60_000

const RANK: Record<PrepStatus, number> = { queued: 0, preparing: 1, ready: 2, served: 3 }
const BY_RANK: readonly CardStatus[] = ['queued', 'preparing', 'ready']

export type KitchenAlert = {
  key: string
  label: string
  /** Riesgo de salud (celíaco, alergia): va en rojo. El resto es dieta. */
  critical: boolean
}

export type CardLine = {
  id: string
  menuItemId: string
  name: string
  quantity: number
  /** Aclaraciones para tocar («Jugoso», «Sin lechuga»), en el orden en que se cargaron. */
  modifiers: string[]
  notes: string | null
  stationId: string | null
  status: PrepStatus
}

/** Los renglones de una estación. `station` viene vacío cuando la comanda es de una sola: no hace falta rótulo. */
export type LineGroup = {
  stationId: string | null
  station: string | null
  lines: CardLine[]
}

/** Lo que la mesa espera de una estación que esta pantalla no muestra. */
export type OtherStation = {
  stationId: string
  name: string
  color: string | null
  /** Unidades (suma de cantidades), no renglones. */
  quantity: number
  /** El renglón más atrasado de esa estación; `served` = ya salió todo. */
  status: PrepStatus
}

export type KitchenCard = {
  /** El id de la tanda. */
  id: string
  sessionId: string
  /** Lo que va enorme: el número de mesa, o un nombre si no hay mesa. */
  title: string
  /** Cuánto lugar pide el título: un número de mesa entra enorme; un nombre, no. */
  titleFit: 'big' | 'mid' | 'small'
  /** Cómo se dice en una frase: «la mesa 12», «Martín». */
  spoken: string
  /** Sector, o «Mostrador» / «Delivery» si no hay mesa. */
  where: string | null
  alias: string | null
  partySize: number | null
  course: number
  event: string | null
  isPractice: boolean
  alerts: KitchenAlert[]
  firedAt: string
  firedMs: number
  status: CardStatus
  /** Desde cuándo está lista para esta pantalla (su último renglón terminado). */
  doneMs: number | null
  /** La cocina ya la había visto (en esta pantalla o en otra). */
  seen: boolean
  lines: CardLine[]
  groups: LineGroup[]
  others: OtherStation[]
  /** Cambia solo si cambia algo que se dibuja: evita volver a pintar comandas iguales. */
  signature: string
}

/** ¿Esta pantalla muestra lo de esa estación? Sin filtro muestra todo; lo que no tiene estación va a todas. */
export function showsStation(filter: readonly string[], stationId: string | null): boolean {
  return filter.length === 0 || stationId === null || filter.includes(stationId)
}

// Lo que no es de cocina (la silla del bebé, la rampa) no va a la tele.
const NOT_FOR_KITCHEN = new Set<string>(['reduced_mobility', 'baby_seat'])
const KITCHEN_WORDING: Record<string, string> = {
  celiac: 'Celíaco · sin TACC',
  allergy: 'Alergia',
  vegetarian: 'Vegetariano',
  vegan: 'Vegano',
}

/**
 * Los avisos de la mesa que le importan a quien cocina, lo grave primero.
 * Un aviso que esta versión no conoce se muestra igual, y fuerte: es preferible
 * avisar de más que pasar por alto una alergia nueva.
 */
export function kitchenAlerts(raw: readonly string[] | null | undefined): KitchenAlert[] {
  if (!raw || raw.length === 0) return []
  const seen = new Set<string>()
  const alerts: (KitchenAlert & { order: number })[] = []
  for (const key of raw) {
    if (typeof key !== 'string' || key.length === 0) continue
    if (seen.has(key) || NOT_FOR_KITCHEN.has(key)) continue
    seen.add(key)
    if (isServiceAlert(key)) {
      const meta = SERVICE_ALERT_META[key]
      alerts.push({
        key,
        label: KITCHEN_WORDING[key] ?? meta.short,
        critical: meta.severity === 'critical',
        order: SERVICE_ALERTS.indexOf(key),
      })
    } else {
      alerts.push({ key, label: key.replaceAll('_', ' '), critical: true, order: 1000 })
    }
  }
  return alerts
    .sort((a, b) => Number(b.critical) - Number(a.critical) || a.order - b.order)
    .map(({ order: _order, ...alert }) => alert)
}

const KIND_WORD = { table: 'Sin mesa', quick: 'Mostrador', delivery: 'Delivery' } as const
/** Cómo se nombra en una frase un pedido que no tiene mesa ni nombre. */
const KIND_SPOKEN = {
  table: 'el pedido sin mesa',
  quick: 'el pedido de mostrador',
  delivery: 'el delivery',
} as const

function clean(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function nameIt(ticket: KitchenTicket) {
  const label = clean(ticket.table_label)
  const alias = clean(ticket.alias)
  const area = clean(ticket.area)
  if (label) {
    const fit = label.length <= 3 ? 'big' : label.length <= 5 ? 'mid' : 'small'
    return { title: label, titleFit: fit, spoken: `la mesa ${label}`, where: area, alias } as const
  }
  // Sin mesa (mostrador, delivery): manda el nombre de quien lo pidió.
  const kind = ticket.kind in KIND_WORD ? ticket.kind : 'table'
  if (alias) {
    return {
      title: alias,
      titleFit: 'small',
      spoken: `el pedido de ${alias}`,
      where: KIND_WORD[kind],
      alias: null,
    } as const
  }
  return {
    title: KIND_WORD[kind],
    titleFit: 'small',
    spoken: KIND_SPOKEN[kind],
    where: area,
    alias: null,
  } as const
}

function toLine(item: KitchenItem): CardLine {
  return {
    id: item.id,
    menuItemId: item.menu_item_id,
    name: item.name,
    quantity: item.quantity,
    modifiers: (item.modifiers ?? [])
      .map((m) => m.label.trim())
      .filter((label) => label.length > 0),
    notes: clean(item.notes),
    stationId: item.station_id,
    status: item.prep_status,
  }
}

function slowest(statuses: readonly PrepStatus[]): PrepStatus {
  let min: PrepStatus = 'served'
  for (const status of statuses) if (RANK[status] < RANK[min]) min = status
  return min
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

type StationIndex = Map<string, MenuStation & { index: number }>

function buildCard(
  ticket: KitchenTicket,
  filter: readonly string[],
  stations: StationIndex,
): KitchenCard | null {
  const mine: KitchenItem[] = []
  const theirs: KitchenItem[] = []
  for (const item of ticket.items) {
    if (showsStation(filter, item.station_id)) mine.push(item)
    else theirs.push(item)
  }
  // Nada de esta tanda es de esta pantalla, o ya se llevaron todo: no hay comanda que mostrar.
  const pending = mine.filter((item) => item.prep_status !== 'served')
  if (pending.length === 0) return null

  const rank = RANK[slowest(pending.map((item) => item.prep_status))]
  const status = BY_RANK[Math.min(rank, 2)] ?? 'queued'

  let doneMs: number | null = null
  if (status === 'ready') {
    for (const item of pending) {
      const at = time(item.ready_at)
      if (at !== null && (doneMs === null || at > doneMs)) doneMs = at
    }
    doneMs ??= time(ticket.ready_at)
  }

  // Los renglones van como se cargaron; si la comanda mezcla estaciones, juntos por estación.
  const order = (id: string | null) =>
    id === null ? Number.MAX_SAFE_INTEGER : (stations.get(id)?.index ?? 9999)
  const distinct = new Set(mine.map((item) => item.station_id))
  const sorted =
    distinct.size > 1
      ? mine
          .map((item, index) => ({ item, index }))
          .sort((a, b) => order(a.item.station_id) - order(b.item.station_id) || a.index - b.index)
          .map(({ item }) => item)
      : mine
  const lines = sorted.map(toLine)

  const groups: LineGroup[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && last.stationId === line.stationId) {
      last.lines.push(line)
      continue
    }
    const station =
      distinct.size > 1
        ? line.stationId === null
          ? 'Sin estación'
          : (stations.get(line.stationId)?.name ?? 'Otra estación')
        : null
    groups.push({ stationId: line.stationId, station, lines: [line] })
  }

  const byStation = new Map<string, KitchenItem[]>()
  for (const item of theirs) {
    if (item.station_id === null) continue
    const list = byStation.get(item.station_id)
    if (list) list.push(item)
    else byStation.set(item.station_id, [item])
  }
  const others: OtherStation[] = [...byStation.entries()]
    .map(([stationId, items]) => ({
      stationId,
      name: stations.get(stationId)?.name ?? 'Otra estación',
      color: stations.get(stationId)?.color ?? null,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      status: slowest(items.map((item) => item.prep_status)),
    }))
    .sort((a, b) => order(a.stationId) - order(b.stationId) || a.name.localeCompare(b.name, 'es'))

  const named = nameIt(ticket)
  const course = ticket.course > 0 ? ticket.course : 1
  // Dos tandas de la misma mesa pueden estar a la vez en la cola: al nombrarlas hay que distinguirlas.
  const spoken =
    course > 1
      ? `la tanda ${course} ${named.spoken.startsWith('el ') ? `del ${named.spoken.slice(3)}` : `de ${named.spoken}`}`
      : named.spoken
  const firedMs = time(ticket.fired_at) ?? 0
  const card = {
    id: ticket.id,
    sessionId: ticket.session_id,
    title: named.title,
    titleFit: named.titleFit,
    spoken,
    where: named.where,
    alias: named.alias,
    partySize: ticket.party_size && ticket.party_size > 0 ? ticket.party_size : null,
    course,
    event: clean(ticket.event),
    isPractice: ticket.is_practice === true,
    alerts: kitchenAlerts(ticket.alerts),
    firedAt: ticket.fired_at,
    firedMs,
    status,
    doneMs,
    seen: ticket.kitchen_seen_at !== null && ticket.kitchen_seen_at !== undefined,
    lines,
    groups,
    others,
  }
  // `seen` no se dibuja: queda afuera para que «cocina lo vio» no vuelva a pintar la comanda.
  const { seen: _seen, sessionId: _session, ...drawn } = card
  return { ...card, signature: JSON.stringify(drawn) }
}

/** Lo que cuenta para estimar cuánto mide la comanda dibujada (ver `estimateTicket`). */
export function ticketShape(card: KitchenCard): {
  strips: number
  meta: boolean
  labels: number
  footer: boolean
  lines: readonly CardLine[]
} {
  const critical = card.alerts.some((alert) => alert.critical)
  const diet = card.alerts.some((alert) => !alert.critical)
  return {
    strips: Number(critical) + Number(diet) + Number(card.isPractice),
    meta: Boolean(card.where || card.partySize || card.course > 1 || card.alias),
    labels: card.groups.filter((group) => group.station !== null).length,
    footer: card.others.length > 0,
    lines: card.lines,
  }
}

/** Orden de llegada: cuándo salió a cocina, y el id para desempatar igual que la base. */
export function byArrival(a: KitchenCard, b: KitchenCard): number {
  return a.firedMs - b.firedMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Las comandas de una pantalla, en orden de llegada. El orden no depende del
 * estado: avanzar una comanda nunca la cambia de lugar.
 */
export function buildCards(queue: KitchenQueue, filter: readonly string[]): KitchenCard[] {
  const stations: StationIndex = new Map(
    queue.stations.map((station, index) => [station.id, { ...station, index }]),
  )
  const cards: KitchenCard[] = []
  for (const ticket of queue.tickets) {
    const card = buildCard(ticket, filter, stations)
    if (card) cards.push(card)
  }
  return cards.sort(byArrival)
}

/**
 * Una comanda lista deja de mostrarse a los diez minutos. La base ya lo hace
 * con la tanda entera; esto cubre la pantalla que muestra una sola estación,
 * donde la tanda sigue abierta porque otra estación todavía no terminó.
 */
export function hasExpired(card: KitchenCard, nowMs: number): boolean {
  return card.status === 'ready' && card.doneMs !== null && nowMs - card.doneMs > READY_LINGER_MS
}

// ─── Avanzar y deshacer ─────────────────────────────────────────────────────

export type AdvanceTo = 'queued' | 'preparing' | 'ready'

/** A dónde lleva «Avanzar». Lo listo no avanza más: lo sirve el mozo. */
export function advanceTarget(status: CardStatus): AdvanceTo | null {
  if (status === 'queued') return 'preparing'
  if (status === 'preparing') return 'ready'
  return null
}

/** A dónde lleva mantener apretado: un paso para atrás. Lo nuevo no tiene a dónde volver. */
export function undoTarget(status: CardStatus): AdvanceTo | null {
  if (status === 'ready') return 'preparing'
  if (status === 'preparing') return 'queued'
  return null
}

/** El estado de la tanda sale del de sus renglones (igual que `private.pos_sync_ticket`). */
function syncTicket(ticket: KitchenTicket, atIso: string): KitchenTicket {
  if (ticket.status === 'pending' || ticket.status === 'cancelled' || ticket.items.length === 0) {
    return ticket
  }
  let started = 0
  let done = 0
  let served = 0
  for (const item of ticket.items) {
    if (item.prep_status !== 'queued') started += 1
    if (item.prep_status === 'ready' || item.prep_status === 'served') done += 1
    if (item.prep_status === 'served') served += 1
  }
  const total = ticket.items.length
  const status =
    served === total ? 'served' : done === total ? 'ready' : started > 0 ? 'preparing' : 'accepted'
  const finished = status === 'ready' || status === 'served'
  return { ...ticket, status, ready_at: finished ? (ticket.ready_at ?? atIso) : null }
}

/**
 * Lo que va a hacer la base (`pos_kitchen_advance`), hecho acá primero para que
 * la comanda cambie al instante. Mueve los renglones de esta pantalla que no
 * estén servidos; lo de otras estaciones no se toca.
 */
export function applyAdvance(
  queue: KitchenQueue,
  ticketId: string,
  to: AdvanceTo,
  filter: readonly string[],
  atIso: string,
): KitchenQueue {
  let touched = false
  const tickets = queue.tickets.map((ticket) => {
    if (ticket.id !== ticketId) return ticket
    const items = ticket.items.map((item) => {
      if (item.prep_status === 'served' || item.prep_status === to) return item
      if (!showsStation(filter, item.station_id)) return item
      touched = true
      return {
        ...item,
        prep_status: to,
        started_at: to === 'queued' ? null : (item.started_at ?? atIso),
        ready_at: to === 'ready' ? (item.ready_at ?? atIso) : null,
      }
    })
    return touched ? syncTicket({ ...ticket, items }, atIso) : ticket
  })
  return touched ? { ...queue, tickets } : queue
}

// ─── Lo que hay que cocinar ─────────────────────────────────────────────────

export type TotalEntry = { menuItemId: string; name: string; quantity: number }

/**
 * La tira de arriba: cuánto hay que hacer de cada cosa entre todas las comandas,
 * para cocinar por tanda y emplatar por mesa. Cuenta lo que falta (en cola o en
 * preparación); lo listo ya no es trabajo.
 */
export function totalsOf(cards: readonly KitchenCard[]): TotalEntry[] {
  const totals = new Map<string, TotalEntry>()
  for (const card of cards) {
    for (const line of card.lines) {
      if (line.status !== 'queued' && line.status !== 'preparing') continue
      const entry = totals.get(line.menuItemId)
      if (entry) entry.quantity += line.quantity
      else {
        totals.set(line.menuItemId, {
          menuItemId: line.menuItemId,
          name: line.name,
          quantity: line.quantity,
        })
      }
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'es'),
  )
}

export type EventDish = {
  menuItemId: string
  name: string
  total: number
  /** Listo o ya entregado. */
  done: number
  /** Lo que falta hacer. */
  pending: number
}

export type EventGroup = {
  name: string
  cards: KitchenCard[]
  dishes: EventDish[]
  total: number
  done: number
}

/**
 * Con un evento, la pantalla se parte: de un lado el evento (cuánto va de cada
 * plato entre todas sus mesas) y del otro las comandas a la carta.
 * Los platos van de más a menos por su total, que no cambia mientras se cocina:
 * la lista no se mueve cuando algo se termina.
 */
export function splitEvents(cards: readonly KitchenCard[]): {
  events: EventGroup[]
  alaCarte: KitchenCard[]
} {
  const alaCarte: KitchenCard[] = []
  const byEvent = new Map<string, KitchenCard[]>()
  for (const card of cards) {
    if (!card.event) {
      alaCarte.push(card)
      continue
    }
    const list = byEvent.get(card.event)
    if (list) list.push(card)
    else byEvent.set(card.event, [card])
  }

  const events: EventGroup[] = []
  for (const [name, eventCards] of byEvent) {
    const dishes = new Map<string, EventDish>()
    for (const card of eventCards) {
      for (const line of card.lines) {
        const dish = dishes.get(line.menuItemId) ?? {
          menuItemId: line.menuItemId,
          name: line.name,
          total: 0,
          done: 0,
          pending: 0,
        }
        dish.total += line.quantity
        if (line.status === 'ready' || line.status === 'served') dish.done += line.quantity
        else dish.pending += line.quantity
        dishes.set(line.menuItemId, dish)
      }
    }
    const list = [...dishes.values()].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'),
    )
    events.push({
      name,
      cards: eventCards,
      dishes: list,
      total: list.reduce((sum, dish) => sum + dish.total, 0),
      done: list.reduce((sum, dish) => sum + dish.done, 0),
    })
  }
  return { events, alaCarte }
}

// ─── Lo que acaba de entrar ─────────────────────────────────────────────────

/**
 * Las comandas que entraron desde la última vez que se miró: suenan y se
 * destacan. La primera lectura (`before` vacío) no cuenta: al prender la tele
 * no entró nada, ya estaba. Lo que aparece ya listo tampoco.
 */
export function newArrivals(
  before: ReadonlySet<string> | null,
  cards: readonly KitchenCard[],
): string[] {
  if (before === null) return []
  return cards.filter((card) => card.status !== 'ready' && !before.has(card.id)).map((c) => c.id)
}

/** «Cocina lo vio»: lo que esta pantalla muestra por primera vez y nadie avisó todavía. */
export function unseenCards(
  cards: readonly KitchenCard[],
  reported: ReadonlySet<string>,
): string[] {
  return cards.filter((card) => !card.seen && !reported.has(card.id)).map((card) => card.id)
}
