/**
 * La compu que tiene la comandera — PURO.
 *
 * Las comandas las imprime la compu que tiene la impresora enchufada, no el celular del mozo: queda
 * con el punto de venta abierto y, cuando entra un pedido, lo imprime sola. Qué imprime y cómo es
 * cosa de CADA compu (la de adentro puede imprimir solo la plancha; la de afuera, la barra), así que
 * se guarda en el dispositivo y no en el bar.
 *
 * Para no repetir ni saltear: se imprime lo que salió a cocina desde que esta compu empezó a imprimir
 * y todavía no imprimió. La lista de lo impreso queda en el dispositivo; sobrevive a recargar la
 * página y a que la compu se apague un rato (al volver imprime lo que entró mientras tanto).
 */
import { buildCards, byArrival, type KitchenCard } from '@/lib/pos/kitchen/cards'
import type { KitchenQueue, SessionDetail } from '@/lib/pos/types'
import { comandaDoc } from './comanda'
import { isPaperWidth, type PaperWidth, type PrintDoc } from './doc'

export type PrinterSettings = {
  /** Esta compu imprime sola las comandas que entran. */
  auto: boolean
  paper: PaperWidth
  /** Las estaciones que imprime (ids). Vacío = todas. */
  stations: string[]
  /** Un tique aparte por estación, para cortar y repartir. */
  splitByStation: boolean
  copies: 1 | 2
  /** Desde cuándo imprime sola (ms). Lo que salió antes no se imprime. */
  since: number | null
  /** Al cobrar en esta compu, sale el tique del cobro para el cliente. */
  receiptOnCharge: boolean
}

export const DEFAULT_PRINTER: PrinterSettings = {
  auto: false,
  paper: 80,
  stations: [],
  splitByStation: false,
  copies: 1,
  since: null,
  receiptOnCharge: false,
}

/** Dónde se guarda en el dispositivo, por sucursal. */
export const printerKey = (branchId: string) => `hub:pos:printer:${branchId}`
export const printedKey = (branchId: string) => `hub:pos:printed:${branchId}`

/** Lo guardado en el dispositivo, leído sin confiar en su forma. */
export function parsePrinter(raw: unknown): PrinterSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_PRINTER
  const value = raw as Record<string, unknown>
  const stations = Array.isArray(value.stations)
    ? [...new Set(value.stations.filter((id): id is string => typeof id === 'string' && id !== ''))]
    : []
  const since =
    typeof value.since === 'number' && Number.isFinite(value.since) && value.since > 0
      ? value.since
      : null
  const auto = value.auto === true
  return {
    auto,
    paper: isPaperWidth(value.paper) ? value.paper : DEFAULT_PRINTER.paper,
    stations,
    splitByStation: value.splitByStation === true,
    copies: value.copies === 2 ? 2 : 1,
    // Prendida sin fecha no puede quedar: imprimiría todo lo que haya en la cola.
    since: auto ? since : null,
    receiptOnCharge: value.receiptOnCharge === true,
  }
}

/** Prender o apagar: al prender se anota desde cuándo, así no sale la cola que ya estaba. */
export function setAuto(settings: PrinterSettings, on: boolean, nowMs: number): PrinterSettings {
  if (on === settings.auto) return settings
  return { ...settings, auto: on, since: on ? nowMs : null }
}

/** Qué se imprimió y cuándo (ms): `tanda` o `tanda:estación`. */
export type PrintedLog = Record<string, number>

export function parsePrinted(raw: unknown): PrintedLog {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: PrintedLog = {}
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[key] = at
  }
  return out
}

/** Cuánto se recuerda lo impreso: más que un día de servicio, y nunca más de mil tandas. */
export const PRINTED_KEEP_MS = 36 * 60 * 60_000
export const PRINTED_KEEP_MAX = 1000

/** Anota lo impreso y olvida lo viejo. */
export function rememberPrinted(
  log: PrintedLog,
  keys: readonly string[],
  nowMs: number,
): PrintedLog {
  const next: PrintedLog = {}
  for (const [key, at] of Object.entries(log)) {
    if (nowMs - at <= PRINTED_KEEP_MS) next[key] = at
  }
  for (const key of keys) next[key] = nowMs
  const entries = Object.entries(next)
  if (entries.length <= PRINTED_KEEP_MAX) return next
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, PRINTED_KEEP_MAX))
}

export type DuePrint = {
  /** La clave con la que queda anotado como impreso. */
  key: string
  card: KitchenCard
  /** El rótulo de arriba: la estación, si este tique es de una sola. */
  stationLabel: string | null
}

function stationName(queue: KitchenQueue, id: string): string | null {
  return queue.stations.find((station) => station.id === id)?.name ?? null
}

/** Las comandas de esta comandera, como las va a imprimir: enteras, o una por estación. */
export function printCards(queue: KitchenQueue, settings: PrinterSettings): DuePrint[] {
  const known = new Set(queue.stations.map((station) => station.id))
  // Una estación que ya no existe no puede dejar a la comandera sin imprimir nada.
  const filter = settings.stations.filter((id) => known.has(id))
  const whole = buildCards(queue, filter)
  const label =
    filter.length === 0
      ? null
      : filter
          .map((id) => stationName(queue, id))
          .filter(Boolean)
          .join(' + ') || null
  if (!settings.splitByStation) {
    return whole.map((card) => ({ key: card.id, card, stationLabel: label }))
  }
  const out: DuePrint[] = []
  for (const card of whole) {
    const stations = [...new Set(card.lines.map((line) => line.stationId))]
    if (stations.length <= 1) {
      const only = stations[0] ?? null
      out.push({
        key: only ? `${card.id}:${only}` : card.id,
        card,
        stationLabel: only ? stationName(queue, only) : label,
      })
      continue
    }
    for (const stationId of stations) {
      if (stationId === null) continue
      const [part] = buildCards(
        { ...queue, tickets: queue.tickets.filter((ticket) => ticket.id === card.id) },
        [stationId],
      )
      if (part) {
        out.push({
          key: `${card.id}:${stationId}`,
          card: part,
          stationLabel: stationName(queue, stationId),
        })
      }
    }
  }
  return out
}

/**
 * Lo que falta imprimir, en orden de llegada: salió a cocina desde que esta compu imprime y todavía
 * no lo imprimió. Con la impresión automática apagada no hay nada.
 */
export function duePrints(
  queue: KitchenQueue,
  settings: PrinterSettings,
  log: PrintedLog,
): DuePrint[] {
  if (!settings.auto || settings.since === null) return []
  const since = settings.since
  return printCards(queue, settings)
    .filter((due) => due.card.firedMs >= since && !(due.key in log))
    .sort((a, b) => byArrival(a.card, b.card) || a.key.localeCompare(b.key))
}

/** Los tiques de un trabajo: cada comanda, tantas veces como copias se pidan. */
export function comandaDocs(
  due: readonly DuePrint[],
  context: { branch: string; timeZone: string; copies?: number; reprint?: boolean },
): PrintDoc[] {
  const copies = context.copies === 2 ? 2 : 1
  const docs: PrintDoc[] = []
  for (const { card, stationLabel } of due) {
    const doc = comandaDoc(card, {
      branch: context.branch,
      timeZone: context.timeZone,
      stationLabel,
      reprint: context.reprint,
    })
    for (let copy = 0; copy < copies; copy++) docs.push(doc)
  }
  return docs
}

/**
 * La comanda de UNA tanda, armada con lo que ve el mozo en su pantalla, para volver a imprimirla
 * (se trabó el papel, se perdió el tique). Va entera, sin separar por estación, y lo que ya se dio de
 * baja no figura. `null` si la tanda no existe, no salió a cocina o no le queda nada.
 */
export function reprintCard(detail: SessionDetail, ticketId: string): KitchenCard | null {
  const ticket = detail.tickets.find((candidate) => candidate.id === ticketId)
  if (!ticket || ticket.fired_at === null) return null
  const items = ticket.items.filter((item) => item.cancelled_at === null)
  if (items.length === 0) return null
  // En el papel no importa qué se entregó ya: la comanda sale como se pidió.
  const everythingServed = items.every((item) => item.prep_status === 'served')
  const queue: KitchenQueue = {
    now: detail.now,
    branch: { id: detail.session.branch_id, name: '', color: '#000000' },
    settings: null,
    stations: [],
    tickets: [
      {
        id: ticket.id,
        session_id: detail.session.id,
        status: ticket.status,
        course: ticket.course,
        fired_at: ticket.fired_at,
        ready_at: ticket.ready_at,
        kitchen_seen_at: ticket.kitchen_seen_at,
        is_practice: detail.session.is_practice,
        table_label: detail.table?.label ?? null,
        area: detail.table?.area ?? null,
        alias: detail.session.alias,
        party_size: detail.session.party_size,
        kind: detail.session.kind,
        event: detail.reservation?.event ?? null,
        alerts: detail.reservation?.alerts ?? null,
        items: items.map((item) => ({
          id: item.id,
          menu_item_id: item.menu_item_id,
          name: item.name,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: item.modifiers,
          station_id: null,
          prep_status: everythingServed ? 'queued' : item.prep_status,
          started_at: null,
          ready_at: item.ready_at,
        })),
      },
    ],
  }
  return buildCards(queue, [])[0] ?? null
}
