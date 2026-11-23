/**
 * La cola de cocina convertida en comandas para UNA pantalla — PURO y testeado.
 *
 * En la tele, una comanda es UNA MESA (pedido de los socios, 22/11/2026: «en la solapa de cocina debe
 * mostrar un ticket por mesa»): todas sus tandas vivas van en la misma tarjeta, y lo que se suma
 * después a una mesa que la cocina ya empezó se marca como nuevo (`buildTableCards`). En el papel sigue
 * siendo una tanda por tique, porque a un papel impreso no se le puede agregar nada (`buildCards`).
 *
 * Cada pantalla elige qué estaciones muestra: lo de esas estaciones son los renglones de la comanda, y
 * lo demás queda en una línea al pie para saber qué más espera la mesa.
 *
 * Los renglones van juntos por rubro de la carta («pizzas con pizzas, milanesas con milanesas») y lo
 * que el bar marcó como «sale primero» (una entrada) va arriba de todo.
 *
 * El estado de la comanda es el del renglón más atrasado de los que ESTA pantalla muestra: si falta
 * uno, la mesa no sale.
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

/** Las unidades de un mismo producto que se piden de la misma forma. */
export type LineVariant = {
  quantity: number
  /** Aclaraciones para tocar («Jugoso», «Sin lechuga»), en el orden en que se cargaron. */
  modifiers: string[]
  notes: string | null
}

/**
 * Un renglón de la comanda: UN producto con todas sus unidades («x2 Cheese Burger»), aunque el mozo
 * las haya cargado en renglones distintos. Si todas se piden igual, las aclaraciones van una sola
 * vez; si no (una sin cebolla, otra con otra guarnición), cada forma va debajo con su cantidad.
 */
export type CardLine = {
  /** El id del primer renglón que lo forma: una identidad que no cambia al dibujar. */
  id: string
  /** Los renglones de la tanda que se juntaron acá. */
  itemIds: string[]
  menuItemId: string
  name: string
  /** Unidades entre todas las formas. */
  quantity: number
  /** Lo que piden TODAS las unidades. Vacío cuando hay más de una forma (ver `variants`). */
  modifiers: string[]
  notes: string | null
  /** Las formas distintas del mismo producto, cada una con su cantidad. Vacío si todas van igual. */
  variants: LineVariant[]
  stationId: string | null
  status: PrepStatus
  /** El rubro de la carta («Pizza»). `null` si la cola no lo trae o el producto quedó sin rubro. */
  categoryId: string | null
  category: string | null
  /** Sale primero (una entrada). */
  priority: boolean
  /** Se sumó a una mesa que la cocina ya había empezado: todavía nadie lo arrancó. */
  fresh: boolean
}

/** Cómo se nombra, entre varias formas, la que no lleva ninguna aclaración. */
export const PLAIN_VARIANT = 'Común'

/** Cómo se rotula lo que el bar marcó para que salga antes que el resto. */
export const PRIORITY_LABEL = 'Sale primero'
/** Y lo que no tiene rubro, cuando el resto de la comanda sí. */
export const NO_CATEGORY_LABEL = 'Otros'

/**
 * Un bloque de renglones de la comanda: lo que sale primero, un rubro de la carta, o (si la cola no
 * trae rubros y la comanda mezcla estaciones) una estación. `label` viene vacío cuando la comanda
 * es de un solo bloque: no hace falta rótulo.
 */
export type LineGroup = {
  /** Una identidad que no cambia al dibujar. */
  key: string
  stationId: string | null
  label: string | null
  /** Es el bloque de «sale primero». */
  priority: boolean
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
  /** En la tele, el id de la mesa abierta (todas sus tandas van juntas); en el papel, el de la tanda. */
  id: string
  sessionId: string
  /** Las tandas que forman la comanda, de la más vieja a la más nueva. */
  ticketIds: string[]
  /** De esas, las que la cocina todavía no vio. */
  unseenIds: string[]
  /** Se le sumó algo a una comanda que ya estaba en marcha: hay renglones sin empezar entre los empezados. */
  grew: boolean
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

/** Lo que hace que dos unidades del mismo producto se pidan «igual»: mismas aclaraciones y misma nota. */
function specKey(modifiers: readonly string[], notes: string | null): string {
  const marks = modifiers.map((label) => label.toLowerCase()).sort()
  return JSON.stringify([marks, (notes ?? '').toLowerCase()])
}

/** Lo mínimo que hace falta de un renglón para juntarlo con sus iguales. */
export type LineSource = {
  id: string
  menu_item_id: string
  name: string
  quantity: number
  modifiers?: readonly { label: string }[] | null
  notes?: string | null
  station_id: string | null
  prep_status: PrepStatus
  category_id?: string | null
  category?: string | null
  category_order?: number | null
  priority?: boolean | null
}

/**
 * Junta los renglones del mismo producto: «x2 Cheese Burger» en vez de dos renglones de a uno.
 *
 * Se juntan los que son de la misma estación y van en el mismo paso (uno entregado no se mezcla con
 * uno que falta: la marca de «listo» tiene que seguir siendo verdad). El renglón queda en el lugar
 * del primero que se cargó. Las formas distintas del mismo producto no se pierden: van debajo, cada
 * una con su cantidad, y la que no lleva aclaraciones va última.
 */
export function groupSameProducts(items: readonly LineSource[]): CardLine[] {
  type Open = { line: CardLine; specs: Map<string, LineVariant> }
  const open = new Map<string, Open>()
  const order: Open[] = []
  for (const item of items) {
    const modifiers = (item.modifiers ?? [])
      .map((m) => m.label.trim())
      .filter((label) => label.length > 0)
    const notes = clean(item.notes)
    const key = JSON.stringify([item.station_id, item.menu_item_id, item.prep_status])
    let group = open.get(key)
    if (!group) {
      group = {
        line: {
          id: item.id,
          itemIds: [],
          menuItemId: item.menu_item_id,
          name: item.name,
          quantity: 0,
          modifiers: [],
          notes: null,
          variants: [],
          stationId: item.station_id,
          status: item.prep_status,
          categoryId: item.category_id ?? null,
          category: clean(item.category),
          priority: item.priority === true,
          fresh: false,
        },
        specs: new Map(),
      }
      open.set(key, group)
      order.push(group)
    }
    group.line.itemIds.push(item.id)
    group.line.quantity += item.quantity
    const spec = specKey(modifiers, notes)
    const variant = group.specs.get(spec)
    if (variant) variant.quantity += item.quantity
    else group.specs.set(spec, { quantity: item.quantity, modifiers, notes })
  }
  return order.map(({ line, specs }) => {
    const variants = [...specs.values()]
    const only = variants.length === 1 ? variants[0] : undefined
    if (only) return { ...line, modifiers: only.modifiers, notes: only.notes }
    const plain = (variant: LineVariant) => variant.modifiers.length === 0 && !variant.notes
    return {
      ...line,
      variants: [...variants.filter((v) => !plain(v)), ...variants.filter(plain)],
    }
  })
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

/** El lugar del rubro en la carta; lo que no tiene rubro va al final. */
function categoryRank(item: Pick<LineSource, 'category_id' | 'category_order'>): number {
  if (!item.category_id) return Number.MAX_SAFE_INTEGER
  return typeof item.category_order === 'number' && Number.isFinite(item.category_order)
    ? item.category_order
    : Number.MAX_SAFE_INTEGER - 1
}

/**
 * Los bloques de una comanda.
 *
 * Con rubros (la cola los trae): primero lo que sale primero, después un bloque por rubro, en el
 * orden de la carta. Sin rubros: como siempre, juntos por estación si la comanda mezcla más de una.
 */
function blocksOf(lines: readonly CardLine[], stations: StationIndex, mixed: boolean): LineGroup[] {
  const structured = lines.some((line) => line.categoryId !== null || line.priority)
  const groups: LineGroup[] = []
  if (!structured) {
    for (const line of lines) {
      const last = groups[groups.length - 1]
      if (last && last.stationId === line.stationId) {
        last.lines.push(line)
        continue
      }
      const label = mixed
        ? line.stationId === null
          ? 'Sin estación'
          : (stations.get(line.stationId)?.name ?? 'Otra estación')
        : null
      groups.push({
        key: `estacion:${line.stationId ?? 'ninguna'}:${groups.length}`,
        stationId: line.stationId,
        label,
        priority: false,
        lines: [line],
      })
    }
    return groups
  }

  const first = lines.filter((line) => line.priority)
  if (first.length > 0) {
    groups.push({
      key: 'primero',
      stationId: null,
      label: PRIORITY_LABEL,
      priority: true,
      lines: first,
    })
  }
  const byCategory = new Map<string, LineGroup>()
  for (const line of lines) {
    if (line.priority) continue
    const key = `rubro:${line.categoryId ?? 'ninguno'}`
    const group = byCategory.get(key)
    if (group) {
      group.lines.push(line)
      continue
    }
    const created: LineGroup = {
      key,
      stationId: null,
      label: line.category ?? NO_CATEGORY_LABEL,
      priority: false,
      lines: [line],
    }
    byCategory.set(key, created)
    groups.push(created)
  }
  // Un solo bloque común no necesita rótulo: sería un título para una lista de un rubro.
  const only = groups.length === 1 ? groups[0] : undefined
  if (only && !only.priority) return [{ ...only, label: null }]
  return groups
}

type Sourced = { item: KitchenItem; ticket: KitchenTicket; index: number }

/**
 * Una comanda con las tandas que se le pasen: una sola (el papel) o todas las de la mesa (la tele).
 * `tickets` viene de la más vieja a la más nueva.
 */
function assembleCard(
  id: string,
  tickets: readonly KitchenTicket[],
  filter: readonly string[],
  stations: StationIndex,
  byTable: boolean,
): KitchenCard | null {
  const head = tickets[0]
  if (!head) return null

  const mine: Sourced[] = []
  const theirs: KitchenItem[] = []
  let index = 0
  for (const ticket of tickets) {
    for (const item of ticket.items) {
      if (showsStation(filter, item.station_id)) mine.push({ item, ticket, index: index++ })
      else theirs.push(item)
    }
  }
  // Una tanda de la que ya se llevaron todo no vuelve a la comanda de la mesa: solo cuentan las vivas.
  const liveIds = new Set(
    mine.filter(({ item }) => item.prep_status !== 'served').map(({ ticket }) => ticket.id),
  )
  // Nada de esto es de esta pantalla, o ya se llevaron todo: no hay comanda que mostrar.
  if (liveIds.size === 0) return null
  const shown = mine.filter(({ ticket }) => liveIds.has(ticket.id))
  const pending = shown.filter(({ item }) => item.prep_status !== 'served')
  const live = tickets.filter((ticket) => liveIds.has(ticket.id))

  const rank = RANK[slowest(pending.map(({ item }) => item.prep_status))]
  const status = BY_RANK[Math.min(rank, 2)] ?? 'queued'
  // Se sumó algo a una comanda en marcha: hay renglones sin empezar entre los que ya arrancaron.
  const grew = status === 'queued' && pending.some(({ item }) => item.prep_status !== 'queued')

  let doneMs: number | null = null
  if (status === 'ready') {
    for (const { item } of pending) {
      const at = time(item.ready_at)
      if (at !== null && (doneMs === null || at > doneMs)) doneMs = at
    }
    for (const ticket of live) {
      if (doneMs !== null) break
      doneMs = time(ticket.ready_at)
    }
  }

  // El orden de los renglones: lo que sale primero, después el rubro (como está en la carta), la
  // estación si la comanda mezcla varias, y al final como se cargaron.
  const order = (stationId: string | null) =>
    stationId === null ? Number.MAX_SAFE_INTEGER : (stations.get(stationId)?.index ?? 9999)
  const distinct = new Set(shown.map(({ item }) => item.station_id))
  const mixed = distinct.size > 1
  const sorted = [...shown].sort(
    (a, b) =>
      Number(b.item.priority === true) - Number(a.item.priority === true) ||
      categoryRank(a.item) - categoryRank(b.item) ||
      (mixed ? order(a.item.station_id) - order(b.item.station_id) : 0) ||
      a.index - b.index,
  )
  const lines = groupSameProducts(sorted.map(({ item }) => item)).map((line) =>
    grew && line.status === 'queued' ? { ...line, fresh: true } : line,
  )
  const groups = blocksOf(lines, stations, mixed)

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

  // El reloj corre desde la tanda más vieja que todavía tiene algo sin terminar (si ya está todo
  // listo, desde la más vieja que sigue en la comanda).
  const unfinished = new Set(
    pending
      .filter(({ item }) => item.prep_status === 'queued' || item.prep_status === 'preparing')
      .map(({ ticket }) => ticket.id),
  )
  const clock = live.find((ticket) => unfinished.has(ticket.id)) ?? live[0] ?? head

  const named = nameIt(head)
  // En el papel, dos tandas de la misma mesa pueden estar a la vez en la cola: al nombrarlas hay que
  // distinguirlas. En la tele la mesa es una sola comanda.
  const course = byTable ? 1 : head.course > 0 ? head.course : 1
  const spoken =
    course > 1
      ? `la tanda ${course} ${named.spoken.startsWith('el ') ? `del ${named.spoken.slice(3)}` : `de ${named.spoken}`}`
      : named.spoken
  const firedMs = time(clock.fired_at) ?? 0
  const unseenIds = live
    .filter((ticket) => ticket.kitchen_seen_at === null || ticket.kitchen_seen_at === undefined)
    .map((ticket) => ticket.id)
  const card = {
    id,
    sessionId: head.session_id,
    ticketIds: live.map((ticket) => ticket.id),
    unseenIds,
    grew,
    title: named.title,
    titleFit: named.titleFit,
    spoken,
    where: named.where,
    alias: named.alias,
    partySize: head.party_size && head.party_size > 0 ? head.party_size : null,
    course,
    event: clean(head.event),
    isPractice: live.some((ticket) => ticket.is_practice === true),
    alerts: kitchenAlerts(head.alerts),
    firedAt: clock.fired_at,
    firedMs,
    status,
    doneMs,
    seen: unseenIds.length === 0,
    lines,
    groups,
    others,
  }
  // Lo que no se dibuja queda afuera, para que «cocina lo vio» no vuelva a pintar la comanda.
  const { seen: _seen, sessionId: _session, unseenIds: _unseen, ...drawn } = card
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
    labels: card.groups.filter((group) => group.label !== null).length,
    footer: card.others.length > 0,
    lines: card.lines,
  }
}

/** Orden de llegada: cuándo salió a cocina, y el id para desempatar igual que la base. */
export function byArrival(a: KitchenCard, b: KitchenCard): number {
  return a.firedMs - b.firedMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function stationIndex(queue: KitchenQueue): StationIndex {
  return new Map(queue.stations.map((station, index) => [station.id, { ...station, index }]))
}

function byFired(a: KitchenTicket, b: KitchenTicket): number {
  return (
    (time(a.fired_at) ?? 0) - (time(b.fired_at) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/**
 * Una comanda por TANDA, en orden de llegada: lo que se imprime. A un papel no se le puede sumar
 * nada después, así que cada tanda que sale a cocina tiene su tique.
 */
export function buildCards(queue: KitchenQueue, filter: readonly string[]): KitchenCard[] {
  const stations = stationIndex(queue)
  const cards: KitchenCard[] = []
  for (const ticket of queue.tickets) {
    const card = assembleCard(ticket.id, [ticket], filter, stations, false)
    if (card) cards.push(card)
  }
  return cards.sort(byArrival)
}

/**
 * Una comanda por MESA, en orden de llegada: lo que muestra la tele. Todas las tandas vivas de la
 * mesa van en la misma tarjeta. El orden no depende del estado: avanzar una comanda nunca la cambia
 * de lugar (cuenta desde la tanda más vieja que le falta terminar).
 */
export function buildTableCards(queue: KitchenQueue, filter: readonly string[]): KitchenCard[] {
  const stations = stationIndex(queue)
  const bySession = new Map<string, KitchenTicket[]>()
  for (const ticket of queue.tickets) {
    const list = bySession.get(ticket.session_id)
    if (list) list.push(ticket)
    else bySession.set(ticket.session_id, [ticket])
  }
  const cards: KitchenCard[] = []
  for (const [sessionId, tickets] of bySession) {
    const card = assembleCard(sessionId, [...tickets].sort(byFired), filter, stations, true)
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

/**
 * Qué tandas hay que mover para avanzar (o deshacer) la comanda de una mesa en esta pantalla.
 *
 * La base avanza de a una tanda. Al avanzar se mueven las que tienen algo atrasado respecto del paso
 * pedido; las que ya estaban más adelante no se tocan (lo que ya está listo no vuelve a «en
 * preparación» porque la mesa sumó una gaseosa). Al deshacer, vuelven un paso las que están en el
 * paso de la comanda.
 */
export function ticketsToMove(
  queue: KitchenQueue,
  card: Pick<KitchenCard, 'ticketIds' | 'status'>,
  to: AdvanceTo,
  filter: readonly string[],
): string[] {
  const forward = RANK[to] > RANK[card.status]
  const wanted = new Set(card.ticketIds)
  const out: string[] = []
  for (const ticket of queue.tickets) {
    if (!wanted.has(ticket.id)) continue
    const mine = ticket.items.filter(
      (item) => item.prep_status !== 'served' && showsStation(filter, item.station_id),
    )
    const moves = forward
      ? mine.some((item) => RANK[item.prep_status] < RANK[to])
      : mine.some((item) => item.prep_status === card.status)
    if (moves) out.push(ticket.id)
  }
  return out
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
 * Las comandas que recibieron algo desde la última vez que se miró: suenan y se destacan. Se mira por
 * TANDA (`before` son las tandas que ya se conocían): una mesa que ya tenía su comanda y pide algo más
 * también avisa. La primera lectura (`before` vacío) no cuenta: al prender la tele no entró nada, ya
 * estaba. Lo que aparece ya listo tampoco.
 */
export function newArrivals(
  before: ReadonlySet<string> | null,
  cards: readonly KitchenCard[],
): string[] {
  if (before === null) return []
  return cards
    .filter((card) => card.status !== 'ready' && card.ticketIds.some((id) => !before.has(id)))
    .map((card) => card.id)
}

/** Las tandas que hay en pantalla: lo que `newArrivals` compara la próxima vez. */
export function knownTickets(cards: readonly KitchenCard[]): Set<string> {
  return new Set(cards.flatMap((card) => card.ticketIds))
}

/** «Cocina lo vio»: las tandas que esta pantalla muestra por primera vez y nadie avisó todavía. */
export function unseenTickets(
  cards: readonly KitchenCard[],
  reported: ReadonlySet<string>,
): string[] {
  return cards.flatMap((card) => card.unseenIds).filter((id) => !reported.has(id))
}
