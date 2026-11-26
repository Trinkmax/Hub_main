/**
 * El tablero de la cocina: una pantalla por estación — PURO y testeado (`tests/lib/pos-kitchen-board.test.ts`).
 *
 * Cada estación (cocina, barra, pizzeros) tiene su muro de comandas. Una pantalla muestra una sola
 * (el monitor de la barra) o varias a la vez: «el pase», la tele del encargado, con una estación
 * grande y las demás más chicas al costado, todas a la vista y todas manejables desde ahí.
 *
 * Una comanda sigue siendo una mesa (`buildTableCards`): en la pantalla de la barra están sus bebidas,
 * en la de la cocina su comida, y al pie de cada una lo que la mesa espera de las otras estaciones.
 */
import type { KitchenItem, KitchenQueue, MenuStation } from '../types'
import { buildTableCards, byArrival, hasExpired, type KitchenCard } from './cards'

/** Qué estaciones muestra una pantalla, en orden (la primera es la grande). Vacío = todas: el pase. */
export type BoardView = readonly string[]

export type PaneCounts = {
  /** Comandas sin terminar. */
  open: number
  /** De esas, las que nadie empezó. */
  queued: number
  /** Listas, esperando que las retiren. */
  ready: number
}

export type BoardPane = {
  station: MenuStation
  /** La estación grande de la pantalla (la que maneja el teclado al arrancar). */
  main: boolean
  /** Sin terminar, por orden de llegada: lo que va en el muro. */
  wall: KitchenCard[]
  /** Listas (para retirar), la que más espera primero. */
  done: KitchenCard[]
  counts: PaneCounts
}

/** La estación que recibe lo que no tiene estación (o va a una apagada): la primera del bar. */
export function homeStationId(stations: readonly MenuStation[]): string | null {
  return stations[0]?.id ?? null
}

/**
 * La cola con cada renglón en una estación que existe. Un producto sin estación (o de una estación que
 * el bar apagó con pedidos en vuelo) no puede quedar fuera de todas las pantallas ni repetido en todas:
 * va a la primera. Un bar sin estaciones queda como está (una sola pantalla con todo).
 */
export function withHomeStation(queue: KitchenQueue): KitchenQueue {
  const home = homeStationId(queue.stations)
  if (home === null) return queue
  const known = new Set(queue.stations.map((station) => station.id))
  let touched = false
  const tickets = queue.tickets.map((ticket) => {
    let mine = false
    const items = ticket.items.map((item): KitchenItem => {
      if (item.station_id !== null && known.has(item.station_id)) return item
      mine = true
      return { ...item, station_id: home }
    })
    if (!mine) return ticket
    touched = true
    return { ...ticket, items }
  })
  return touched ? { ...queue, tickets } : queue
}

/** La pantalla de un bar sin estaciones: una sola, con todo. */
export const SINGLE_STATION: MenuStation = {
  id: '',
  name: 'Cocina',
  color: '#b45309',
  kind: 'food',
}

/**
 * Las estaciones de una pantalla, en el orden pedido. Las que ya no existen se descartan; si no queda
 * ninguna (o no se pidió ninguna), son todas, en el orden del bar.
 */
export function viewStations(
  view: BoardView,
  stations: readonly MenuStation[],
): readonly MenuStation[] {
  if (stations.length === 0) return [SINGLE_STATION]
  const byId = new Map(stations.map((station) => [station.id, station]))
  const picked: MenuStation[] = []
  for (const id of view) {
    const station = byId.get(id)
    if (station && !picked.includes(station)) picked.push(station)
  }
  return picked.length > 0 ? picked : stations
}

/** Deja la lista como se guarda: solo estaciones que existen; «todas en su orden» es la lista vacía. */
export function normalizeView(view: BoardView, stations: readonly MenuStation[]): string[] {
  const known = new Set(stations.map((station) => station.id))
  const picked = [...new Set(view)].filter((id) => known.has(id))
  if (picked.length === 0) return []
  const all = stations.map((station) => station.id)
  return picked.length === all.length && picked.every((id, at) => id === all[at]) ? [] : picked
}

/** Poner una estación como la grande: pasa adelante y las demás quedan como estaban. */
export function promoteStation(
  view: BoardView,
  stationId: string,
  stations: readonly MenuStation[],
): string[] {
  const shown = viewStations(view, stations).map((station) => station.id)
  if (!shown.includes(stationId)) return normalizeView(view, stations)
  return normalizeView([stationId, ...shown.filter((id) => id !== stationId)], stations)
}

function byWaiting(a: KitchenCard, b: KitchenCard): number {
  return (a.doneMs ?? a.firedMs) - (b.doneMs ?? b.firedMs) || byArrival(a, b)
}

/**
 * El tablero: un panel por estación de la pantalla. `queue` ya viene con lo recién tocado aplicado.
 * Una comanda lista deja de mostrarse a los diez minutos (igual que antes).
 */
export function buildBoard(queue: KitchenQueue, view: BoardView, nowMs: number): BoardPane[] {
  const normal = withHomeStation(queue)
  const shown = viewStations(view, normal.stations)
  return shown.map((station, at) => {
    const filter = station.id === '' ? [] : [station.id]
    const cards = buildTableCards(normal, filter).filter((card) => !hasExpired(card, nowMs))
    const wall = cards.filter((card) => card.status !== 'ready')
    const done = cards.filter((card) => card.status === 'ready').sort(byWaiting)
    return {
      station,
      main: at === 0,
      wall,
      done,
      counts: {
        open: wall.length,
        queued: wall.filter((card) => card.status === 'queued').length,
        ready: done.length,
      },
    }
  })
}

/** Una comanda en un panel: la misma mesa está en varios, cada una con lo suyo. */
export function cardKey(stationId: string, cardId: string): string {
  return `${stationId}:${cardId}`
}

// ─── El número que se teclea ────────────────────────────────────────────────

/** El número de mesa sirve de código si son hasta tres cifras y no arranca en cero. */
function tableCode(title: string): string | null {
  return /^[1-9]\d{0,2}$/.test(title) ? title : null
}

/**
 * El número con el que se llama a cada comanda desde el teclado: su número de mesa. Lo que no tiene
 * número (un pedido de mostrador, una mesa con nombre) o lo repite (una mesa que se cobró y se volvió
 * a abrir, con lo anterior todavía en «Listos») recibe uno propio que empieza en cero («01», «02»…) y
 * lo conserva mientras siga en pantalla: nunca choca con una mesa de verdad.
 *
 * `cards` viene en el orden que manda: primero el muro, después las listas.
 */
export function assignCodes(
  previous: ReadonlyMap<string, string>,
  cards: readonly Pick<KitchenCard, 'id' | 'title'>[],
): Map<string, string> {
  const codes = new Map<string, string>()
  const taken = new Set<string>()
  const pending: string[] = []
  for (const card of cards) {
    const own = tableCode(card.title)
    if (own !== null && !taken.has(own)) {
      codes.set(card.id, own)
      taken.add(own)
    } else {
      pending.push(card.id)
    }
  }
  // Las que ya tenían un código propio lo conservan.
  const fresh: string[] = []
  for (const id of pending) {
    const kept = previous.get(id)
    if (kept?.startsWith('0') && !taken.has(kept)) {
      codes.set(id, kept)
      taken.add(kept)
    } else {
      fresh.push(id)
    }
  }
  let next = 1
  for (const id of fresh) {
    while (taken.has(`0${next}`)) next += 1
    const code = `0${next}`
    codes.set(id, code)
    taken.add(code)
  }
  return codes
}

/** La comanda que responde a lo tecleado, o `null`. */
export function cardForCode(codes: ReadonlyMap<string, string>, typed: string): string | null {
  if (typed === '') return null
  for (const [id, code] of codes) if (code === typed) return id
  return null
}

// ─── Colgar las comandas en el muro ─────────────────────────────────────────

/** Una comanda para colgar: cuánto mide (ya dibujada a su ancho) y cuántas columnas ocupa. */
export type WallItem = { id: string; height: number | null; span: 1 | 2 }
export type WallPlace = { id: string; column: number; top: number; span: 1 | 2 }

/**
 * Dónde cuelga cada comanda. Van en orden de llegada, y cada una baja a la columna donde hay más
 * lugar: la fila de arriba, de izquierda a derecha, es lo próximo que tiene que salir, y no queda
 * media columna vacía porque la que seguía era larga.
 *
 * El orden no se saltea: cuando una no entra (o todavía no se midió), esa y todas las que vienen
 * después esperan en «En cola». Siempre se cuelga al menos una, aunque no entre entera.
 */
export function packWall(
  items: readonly WallItem[],
  columns: number,
  room: number,
  gap: number,
): {
  placed: WallPlace[]
  fits: number
  /** Cuánto lugar le quedaba a la primera que no entró (`null` si entraron todas o falta medirla). */
  nextRoom: number | null
} {
  const count = Math.max(1, Math.floor(columns))
  const heights = new Array<number>(count).fill(0)
  const placed: WallPlace[] = []
  let nextRoom: number | null = null
  for (const item of items) {
    if (item.height === null) break
    const span = Math.min(item.span, count) as 1 | 2
    let column = 0
    let top = Number.POSITIVE_INFINITY
    for (let at = 0; at + span <= count; at++) {
      let level = 0
      for (let k = at; k < at + span; k++) level = Math.max(level, heights[k] ?? 0)
      if (level < top - 0.5) {
        top = level
        column = at
      }
    }
    if (placed.length > 0 && top + item.height > room + 0.5) {
      nextRoom = Math.max(0, room - top)
      break
    }
    placed.push({ id: item.id, column, top, span })
    for (let k = column; k < column + span; k++) heights[k] = top + item.height + gap
  }
  return { placed, fits: placed.length, nextRoom }
}

// ─── Moverse por el muro con las flechas ────────────────────────────────────

export type WallRect = { id: string; left: number; top: number; width: number; height: number }

/**
 * A dónde va el marco con una flecha: a la comanda más cercana en esa dirección. Arriba y abajo se
 * quedan en la columna; izquierda y derecha saltan a la columna de al lado, a la que queda a la misma
 * altura. Si de ese lado no hay nada, el marco no se mueve.
 */
export function wallNeighbor(
  rects: readonly WallRect[],
  current: string | null,
  direction: 'up' | 'down' | 'left' | 'right',
): string | null {
  if (rects.length === 0) return null
  const from = current === null ? undefined : rects.find((rect) => rect.id === current)
  if (!from) return rects[0]?.id ?? null
  const centerX = from.left + from.width / 2
  const centerY = from.top + from.height / 2
  let pick = from.id
  let best = Number.POSITIVE_INFINITY
  for (const rect of rects) {
    if (rect.id === from.id) continue
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    let score: number
    if (direction === 'up' || direction === 'down') {
      // En la misma columna: que se pisen a lo ancho.
      if (rect.left >= from.left + from.width - 1 || rect.left + rect.width <= from.left + 1)
        continue
      const ahead = direction === 'down' ? y - centerY : centerY - y
      if (ahead <= 1) continue
      score = ahead
    } else {
      const ahead = direction === 'right' ? x - centerX : centerX - x
      if (ahead <= from.width / 2) continue
      // Primero la columna más cercana; dentro de ella, la que queda a la misma altura.
      score = Math.round(ahead / Math.max(1, from.width)) * 100_000 + Math.abs(y - centerY)
    }
    if (score < best) {
      best = score
      pick = rect.id
    }
  }
  return pick
}
