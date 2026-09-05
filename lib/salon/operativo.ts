/**
 * La lógica del tablero operativo (`/[slug]/operativo`), sin React.
 *
 * Todo lo que la pantalla decide sobre una lista de reservas ya cargadas vive
 * acá: cómo se busca, en qué orden se lee la noche, qué es "atrasada", cuánto
 * falta para que llegue la gente, qué mesas ya están ocupadas, qué transición
 * está permitida desde cada estado. Es puro cálculo y se testea sin DB.
 *
 * La pantalla se usa con una mano y apurado, así que cada decisión de acá tiene
 * que hacer más rápido o más claro el servicio — no más completo.
 */

import { formatInTimeZone } from 'date-fns-tz'
import { SALON_TZ } from './date-presets'
import { coversOf, occupiesTable } from './services'
import type { ReservationWithJoins, SalonReservationStatus } from './types'

// ──────────────────────────────────────────────────────────
// Tiempo
// ──────────────────────────────────────────────────────────

/** Minutos desde medianoche de un 'HH:MM' o 'HH:MM:SS'. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Minutos en el reloj del SERVICIO: una reserva a las 00:30 es el final de la
 * noche, no el arranque del día (el bar abre a la mañana, pero nadie reserva a
 * las 00:30 para desayunar). Todo lo anterior a las 5 AM cuenta como +24 h, así
 * ordena, se compara con "ahora" y se lee como corresponde.
 */
export function serviceMinutes(time: string): number {
  const minutes = timeToMinutes(time)
  return minutes < SERVICE_DAY_ROLLOVER_HOUR * 60 ? minutes + 24 * 60 : minutes
}

/** Hora actual en el reloj del bar, en minutos desde medianoche. */
export function nowMinutesInCordoba(now: Date = new Date()): number {
  return timeToMinutes(formatInTimeZone(now, SALON_TZ, 'HH:mm'))
}

/** 'HH:mm' del reloj del bar. */
export function nowHHMMInCordoba(now: Date = new Date()): string {
  return formatInTimeZone(now, SALON_TZ, 'HH:mm')
}

/**
 * El "día de servicio" no termina a medianoche. A la 1:30 de la madrugada del
 * domingo la anfitriona sigue cerrando la cena del sábado: el tablero tiene que
 * seguir mostrando el sábado, no un domingo vacío. Hasta las 5 AM "hoy" es ayer.
 */
export const SERVICE_DAY_ROLLOVER_HOUR = 5

export function serviceDayInCordoba(now: Date = new Date()): string {
  const day = formatInTimeZone(now, SALON_TZ, 'yyyy-MM-dd')
  const hour = Number(formatInTimeZone(now, SALON_TZ, 'HH'))
  if (hour >= SERVICE_DAY_ROLLOVER_HOUR) return day
  const [y, m, d] = day.split('-').map(Number)
  const prev = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1))
  return prev.toISOString().slice(0, 10)
}

/**
 * Desde cuándo cuenta "hoy" para un día de servicio: las 5 AM de esa fecha en
 * Córdoba (UTC-3 fijo, sin horario de verano). Sirve para traer lo que pasó en
 * ESTA noche, incluida la madrugada, y no lo de la noche anterior.
 */
export function serviceDayStartIso(date: string): string {
  return new Date(`${date}T0${SERVICE_DAY_ROLLOVER_HOUR}:00:00-03:00`).toISOString()
}

/** Hasta cuándo cuenta "hoy": las 5 AM del día siguiente. */
export function serviceDayEndIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10)
  return serviceDayStartIso(next)
}

/** Si estamos en la madrugada que sigue a `date`: "todavía es esa noche". */
export function isAfterMidnightOf(date: string, now: Date = new Date()): boolean {
  return serviceDayInCordoba(now) === date && formatInTimeZone(now, SALON_TZ, 'yyyy-MM-dd') !== date
}

/**
 * Cuánto falta (positivo) o cuánto se pasó (negativo) respecto de la hora de
 * la reserva, en minutos del reloj del servicio (`boardClockMinutes`): una
 * reserva a las 00:30 con el reloj en 23:50 es "en 40 min", no "hace 23 h".
 */
export function minutesUntil(
  r: Pick<ReservationWithJoins, 'reservation_time_local'>,
  nowMinutes: number,
): number {
  return serviceMinutes(r.reservation_time_local) - nowMinutes
}

/**
 * El reloj del tablero para un día de servicio: si ya pasó la medianoche de
 * `date`, los minutos siguen contando desde 24:00 (la 1:30 son 1530) para que
 * "hace 40 min" y el marcador de "ahora" sigan siendo verdad.
 */
export function boardClockMinutes(date: string, now: Date = new Date()): number | null {
  if (serviceDayInCordoba(now) !== date) return null
  const minutes = nowMinutesInCordoba(now)
  return isAfterMidnightOf(date, now) ? minutes + 24 * 60 : minutes
}

/**
 * Una pendiente pasa a "atrasada" recién a los 15 minutos: en un bar la gente
 * llega tarde, y pintar de rojo todo lo que se pasó un minuto es ruido.
 */
export const LATE_GRACE_MINUTES = 15
/** "Llegando": lo que cae en la próxima hora es lo que hay que tener a mano. */
export const SOON_WINDOW_MINUTES = 60

export type Urgency = 'late' | 'soon' | 'later' | 'inside' | 'done' | 'cancelled'

/**
 * En qué franja está la reserva PARA LA OPERACIÓN (no es el status). Solo tiene
 * sentido para el día de hoy; para otro día todo lo pendiente es `later`.
 */
export function urgencyOf(
  r: Pick<ReservationWithJoins, 'status' | 'reservation_time_local'>,
  nowMinutes: number | null,
): Urgency {
  switch (r.status) {
    case 'arrived':
    case 'seated':
      return 'inside'
    case 'closed':
    case 'no_show':
      return 'done'
    case 'cancelled':
      return 'cancelled'
    default:
      break
  }
  if (nowMinutes === null) return 'later'
  const diff = minutesUntil(r, nowMinutes)
  if (diff < -LATE_GRACE_MINUTES) return 'late'
  if (diff <= SOON_WINDOW_MINUTES) return 'soon'
  return 'later'
}

/**
 * "hace 25 min" / "en 12 min" / "ahora". Para leer al lado de la hora sin
 * hacer la cuenta.
 */
export function relativeTimeLabel(diffMinutes: number): string {
  if (Math.abs(diffMinutes) <= 2) return 'ahora'
  const abs = Math.abs(diffMinutes)
  const text =
    abs < 60
      ? `${abs} min`
      : abs % 60 === 0
        ? `${abs / 60} h`
        : `${Math.floor(abs / 60)} h ${abs % 60}`
  return diffMinutes < 0 ? `hace ${text}` : `en ${text}`
}

// ──────────────────────────────────────────────────────────
// Búsqueda
// ──────────────────────────────────────────────────────────

/** Minúsculas y sin tildes: "García" encuentra "garcia" y al revés. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function digitsOf(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

export type SearchableReservation = Pick<
  ReservationWithJoins,
  'guest_name' | 'guest_phone' | 'table_label' | 'customer' | 'primary_manager'
>

/**
 * Busca en lo que la anfitriona sabe del que tiene adelante: nombre (de la
 * reserva o de la ficha del socio), teléfono (por dígitos: "351" alcanza),
 * mesa asignada ("12") y gestor. Todas las palabras de la consulta tienen que
 * aparecer, en cualquier orden: "adri carranza" y "carranza adri" son lo mismo.
 */
export function matchesQuery(r: SearchableReservation, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true

  const haystack = normalizeText(
    [
      r.guest_name,
      r.customer?.first_name,
      r.customer?.last_name,
      r.table_label ? `mesa ${r.table_label}` : null,
      r.primary_manager?.display_name,
    ]
      .filter(Boolean)
      .join(' '),
  )
  const phoneDigits = `${digitsOf(r.guest_phone)} ${digitsOf(r.customer?.phone)}`

  // Una consulta de solo dígitos es una mesa ("12") o un teléfono pegado
  // entero ("+54 9 351 555 1234"): la mesa se prueba primero, el teléfono se
  // compara por todos sus dígitos juntos, no palabra por palabra.
  if (/^[\d\s+()-]+$/.test(q)) {
    const allDigits = digitsOf(q)
    if (splitTableLabel(r.table_label).includes(allDigits)) return true
    if (allDigits.length >= 3) return phoneDigits.includes(allDigits)
    return false
  }

  return q.split(/\s+/).every((word) => {
    if (haystack.includes(word)) return true
    const wordDigits = digitsOf(word)
    return wordDigits.length >= 3 && phoneDigits.includes(wordDigits)
  })
}

// ──────────────────────────────────────────────────────────
// Filtros y orden
// ──────────────────────────────────────────────────────────

export type BoardFilter = 'all' | 'waiting' | 'inside' | 'done'

export const BOARD_FILTER_LABELS: Record<BoardFilter, string> = {
  all: 'Todas',
  waiting: 'Por llegar',
  inside: 'Adentro',
  done: 'Terminadas',
}

export function matchesFilter(
  r: Pick<ReservationWithJoins, 'status'>,
  filter: BoardFilter,
): boolean {
  switch (filter) {
    case 'waiting':
      return r.status === 'pending'
    case 'inside':
      return r.status === 'arrived' || r.status === 'seated'
    case 'done':
      return r.status === 'closed' || r.status === 'no_show'
    default:
      return true
  }
}

/** Las canceladas no se operan: no están en el tablero (sí en /reservas). */
export function isOperable(r: Pick<ReservationWithJoins, 'status'>): boolean {
  return r.status !== 'cancelled'
}

/**
 * Orden de lectura de la noche: por hora (la madrugada al final) y nombre como
 * desempate. NUNCA por estado: cuando la anfitriona marca "Llegó" la tarjeta se
 * tiene que quedar donde estaba — si saltara de lugar la perdería de vista. El
 * estado se lee por color y por el riel (hora → mesa), no por la posición.
 */
export function sortForBoard<T extends ReservationWithJoins>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = serviceMinutes(a.reservation_time_local)
    const tb = serviceMinutes(b.reservation_time_local)
    if (ta !== tb) return ta - tb
    return a.guest_name.localeCompare(b.guest_name, 'es-AR')
  })
}

/**
 * Qué tan buena es la coincidencia, para que lo más probable quede arriba:
 * "12" es la mesa 12 antes que un teléfono que contiene 12; "gar" es el que
 * se llama García antes que el que tiene "gar" en el medio.
 *   0 = mesa exacta · 1 = el nombre empieza así · 2 = el resto
 */
export function searchRank(r: SearchableReservation, query: string): number {
  const q = normalizeText(query)
  if (!q) return 2
  if (/^\d{1,3}$/.test(q) && splitTableLabel(r.table_label).includes(q)) return 0
  const names = [r.guest_name, r.customer?.first_name, r.customer?.last_name]
    .filter(Boolean)
    .map((n) => normalizeText(String(n)))
  const first = q.split(/\s+/)[0] ?? q
  if (names.some((n) => n.startsWith(first) || n.split(' ').some((w) => w.startsWith(first))))
    return 1
  return 2
}

/**
 * Lo que se ve en el tablero. Con búsqueda activa el filtro de estado se
 * ignora: si escribís "García" querés a García, esté donde esté.
 */
export function filterForBoard<T extends ReservationWithJoins>(
  rows: T[],
  opts: { query: string; filter: BoardFilter },
): T[] {
  const searching = normalizeText(opts.query).length > 0
  const visible = rows.filter(
    (r) =>
      isOperable(r) && (searching ? matchesQuery(r, opts.query) : matchesFilter(r, opts.filter)),
  )
  const sorted = sortForBoard(visible)
  if (!searching) return sorted
  return sorted
    .map((r, i) => ({ r, i, rank: searchRank(r, opts.query) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r)
}

/**
 * Dos "García" la misma noche: se les agrega los últimos 4 dígitos del
 * teléfono para que la anfitriona sepa a cuál marcar.
 */
export function nameDisambiguation(
  rows: ReadonlyArray<Pick<ReservationWithJoins, 'id' | 'guest_name' | 'guest_phone' | 'customer'>>,
): Map<string, string> {
  const byName = new Map<string, string[]>()
  for (const r of rows) {
    const key = normalizeText(r.guest_name)
    byName.set(key, [...(byName.get(key) ?? []), r.id])
  }
  const out = new Map<string, string>()
  for (const r of rows) {
    const ids = byName.get(normalizeText(r.guest_name)) ?? []
    if (ids.length < 2) continue
    const phone = r.guest_phone ?? r.customer?.phone ?? ''
    const digits = phone.replace(/\D/g, '')
    if (digits.length >= 4) out.set(r.id, `…${digits.slice(-4)}`)
  }
  return out
}

export type FilterCounts = Record<BoardFilter, number>

export function countByFilter(
  rows: ReadonlyArray<Pick<ReservationWithJoins, 'status'>>,
): FilterCounts {
  const counts: FilterCounts = { all: 0, waiting: 0, inside: 0, done: 0 }
  for (const r of rows) {
    if (!isOperable(r)) continue
    counts.all++
    if (matchesFilter(r, 'waiting')) counts.waiting++
    else if (matchesFilter(r, 'inside')) counts.inside++
    else if (matchesFilter(r, 'done')) counts.done++
  }
  return counts
}

/**
 * Dónde va el marcador de "ahora" en una lista ya ordenada: antes de la primera
 * reserva cuya hora todavía no llegó. `null` si no es hoy o si la lista está
 * vacía; `rows.length` si ya pasaron todas.
 */
export function nowMarkerIndex(
  rows: ReadonlyArray<Pick<ReservationWithJoins, 'reservation_time_local'>>,
  nowMinutes: number | null,
): number | null {
  if (nowMinutes === null || rows.length === 0) return null
  const idx = rows.findIndex((r) => serviceMinutes(r.reservation_time_local) > nowMinutes)
  return idx === -1 ? rows.length : idx
}

// ──────────────────────────────────────────────────────────
// El pulso de la noche
// ──────────────────────────────────────────────────────────

export type NightPulse = {
  /** Reservas que ocupan mesa (sin canceladas ni no-show). */
  reservations: number
  /** Cubiertos comprometidos del día (los que vinieron si ya se contaron). */
  covers: number
  waiting: number
  waitingCovers: number
  /** Adentro AHORA: llegó + sentada. Las cerradas van aparte. */
  inside: number
  insideCovers: number
  closed: number
  closedCovers: number
  noShow: number
  noShowCovers: number
  late: number
  /** Cubiertos que vinieron (adentro + cerradas) sobre los comprometidos, 0..1. */
  progress: number
}

export function nightPulse(
  rows: ReadonlyArray<
    Pick<
      ReservationWithJoins,
      'status' | 'reservation_time_local' | 'estimated_guests' | 'actual_guests'
    >
  >,
  nowMinutes: number | null,
): NightPulse {
  const pulse: NightPulse = {
    reservations: 0,
    covers: 0,
    waiting: 0,
    waitingCovers: 0,
    inside: 0,
    insideCovers: 0,
    closed: 0,
    closedCovers: 0,
    noShow: 0,
    noShowCovers: 0,
    late: 0,
    progress: 0,
  }
  for (const r of rows) {
    if (r.status === 'cancelled') continue
    const covers = coversOf(r)
    if (r.status === 'no_show') {
      pulse.noShow++
      pulse.noShowCovers += covers
      continue
    }
    if (!occupiesTable(r)) continue
    pulse.reservations++
    pulse.covers += covers
    if (r.status === 'pending') {
      pulse.waiting++
      pulse.waitingCovers += covers
      if (urgencyOf(r, nowMinutes) === 'late') pulse.late++
    } else if (r.status === 'closed') {
      pulse.closed++
      pulse.closedCovers += covers
    } else {
      pulse.inside++
      pulse.insideCovers += covers
    }
  }
  pulse.progress =
    pulse.covers > 0 ? Math.min(1, (pulse.insideCovers + pulse.closedCovers) / pulse.covers) : 0
  return pulse
}

// ──────────────────────────────────────────────────────────
// Mesas
// ──────────────────────────────────────────────────────────

/**
 * Mesas que ya tienen gente sentada (o llegando), para avisar antes de asignar
 * la misma dos veces. "12+13" cuenta como dos mesas. Se ignora la reserva que
 * se está editando.
 */
export function occupiedTables(
  rows: ReadonlyArray<Pick<ReservationWithJoins, 'id' | 'status' | 'table_label' | 'guest_name'>>,
  excludeId?: string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.id === excludeId) continue
    if (r.status !== 'arrived' && r.status !== 'seated') continue
    for (const part of splitTableLabel(r.table_label)) {
      if (!map.has(part)) map.set(part, r.guest_name)
    }
  }
  return map
}

/** "12 + 13" → ['12', '13']; "Barra" → ['barra']. */
export function splitTableLabel(label: string | null | undefined): string[] {
  if (!label) return []
  return label
    .split(/[+,/&]/)
    .map((p) => normalizeText(p))
    .filter(Boolean)
}

/**
 * Suma o saca una mesa de una etiqueta compuesta: tocar "13" con "12" puesto
 * da "12+13"; tocarla de nuevo la saca.
 */
export function toggleTableInLabel(label: string | null, table: string): string {
  const parts = label
    ? label
        .split(/[+,/&]/)
        .map((p) => p.trim())
        .filter(Boolean)
    : []
  const key = normalizeText(table)
  const idx = parts.findIndex((p) => normalizeText(p) === key)
  if (idx >= 0) parts.splice(idx, 1)
  else parts.push(table.trim())
  return parts
    .sort((a, b) => {
      const na = Number(a)
      const nb = Number(b)
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
      return a.localeCompare(b, 'es-AR')
    })
    .join('+')
}

// ──────────────────────────────────────────────────────────
// Máquina de estados (lo que la UI ofrece; la RPC es la que manda)
// ──────────────────────────────────────────────────────────

/** Transiciones "hacia adelante" que se ofrecen desde cada estado. */
export function nextAllowed(status: SalonReservationStatus): SalonReservationStatus[] {
  switch (status) {
    case 'pending':
      return ['arrived', 'no_show']
    case 'arrived':
      return ['seated']
    case 'seated':
      return ['closed']
    case 'no_show':
      return ['arrived']
    default:
      return []
  }
}

/** A dónde vuelve cada estado cuando alguien se equivocó. */
export function reverseTarget(status: SalonReservationStatus): SalonReservationStatus | null {
  switch (status) {
    case 'arrived':
      return 'pending'
    case 'seated':
      return 'arrived'
    case 'closed':
      return 'seated'
    case 'no_show':
      return 'pending'
    default:
      return null
  }
}

export function reversibleHint(status: SalonReservationStatus): string {
  switch (status) {
    case 'arrived':
      return 'Vuelve a "por llegar". Se conserva la hora de llegada original si vuelve a entrar.'
    case 'seated':
      return 'Vuelve a "llegó".'
    case 'closed':
      return 'Reabre la mesa. La comisión se recalcula al volver a cerrar.'
    case 'no_show':
      return 'Vuelve a "por llegar", como si nunca se hubiera marcado.'
    default:
      return 'No reversible.'
  }
}

export function reverseLabel(status: SalonReservationStatus): string {
  switch (status) {
    case 'arrived':
      return 'Me equivoqué, no llegó'
    case 'seated':
      return 'Volver a "llegó"'
    case 'closed':
      return 'Reabrir mesa'
    case 'no_show':
      return 'Apareció, volver a esperar'
    default:
      return 'Revertir'
  }
}

/** Los estados en los que la gente está (o estuvo) en el bar. */
export function isHere(status: SalonReservationStatus): boolean {
  return status === 'arrived' || status === 'seated' || status === 'closed'
}
