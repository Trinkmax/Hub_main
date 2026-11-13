/**
 * Qué muestra la pantalla de caja — PURO y testeado.
 *
 * La base devuelve la caja entera en una lectura (`ShiftSnapshot`). Acá se decide, sin tocar la
 * base ni el navegador, en qué momento está la caja (sin abrir nunca, cerrada, abierta, abierta
 * desde ayer), qué puede hacer quien mira con cada cobro, qué tan grave es una diferencia de
 * arqueo y cómo se dice cada cosa. Los permisos espejan lo que deciden las RPC `pos_*`: la
 * pantalla solo se adelanta para no ofrecer un botón que la base va a rebotar.
 */
import { formatCentsShort } from '@/lib/money'
import { clockAt } from '@/lib/pos/order/clock'
import { emptyCount } from './shift'
import type {
  CashMovement,
  CountBreakdown,
  DayPayment,
  RegisterRef,
  Shift,
  ShiftSnapshot,
  ShiftSummary,
} from './types'

/** Hasta las 5 de la mañana sigue siendo la noche anterior (igual que `private.pos_service_day`). */
const ROLLOVER_HOUR = 5
const DAY_MS = 86_400_000
const FALLBACK_ZONE = 'America/Argentina/Cordoba'

// ─── Días ────────────────────────────────────────────────────────────────────

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }
    try {
      formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone })
    } catch {
      // Una zona horaria mal cargada no puede tirar la caja: se usa la de Córdoba.
      formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: FALLBACK_ZONE })
    }
    zoneFormatters.set(timeZone, formatter)
  }
  return formatter
}

/** Fecha y hora de un instante en la zona del bar, por partes (nunca la cadena ya armada). */
function zoneParts(
  iso: string,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = zoneFormatter(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') % 24 }
}

/** «2026-11-12»: el día de servicio de un instante. `null` si la fecha no se puede leer. */
export function serviceDayAt(iso: string, timeZone: string): string | null {
  const parts = zoneParts(iso, timeZone)
  if (!parts) return null
  const shift = parts.hour < ROLLOVER_HOUR ? 1 : 0
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day - shift))
    .toISOString()
    .slice(0, 10)
}

function dayToUtc(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return null
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Cuántos días hay de `fromDay` a `toDay` («2026-11-10» → «2026-11-12» = 2). 0 si no se entiende. */
export function daysApart(fromDay: string, toDay: string): number {
  const from = dayToUtc(fromDay)
  const to = dayToUtc(toDay)
  if (from === null || to === null) return 0
  return Math.round((to - from) / DAY_MS)
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const

/** «jue 12/11» o «jueves 12/11». Lo que no es una fecha se devuelve tal cual. */
export function dayLabel(day: string, form: 'short' | 'long' = 'short'): string {
  const utc = dayToUtc(day)
  if (utc === null) return day
  const date = new Date(utc)
  const names = form === 'long' ? WEEKDAYS : WEEKDAYS_SHORT
  const name = names[date.getUTCDay()] ?? ''
  return `${name} ${date.getUTCDate()}/${date.getUTCMonth() + 1}`
}

/**
 * «hoy a las 16:05», «ayer a las 02:10», «el jueves 12/11 a las 20:05»: cuándo pasó algo, dicho
 * desde ahora y por el calendario del bar (a las 2 de la mañana, lo de las 16 fue ayer).
 */
export function whenWords(iso: string, nowIso: string, timeZone: string): string {
  const then = zoneParts(iso, timeZone)
  const now = zoneParts(nowIso, timeZone)
  if (!then || !now) return ''
  const clock = clockAt(iso, timeZone)
  const day = (parts: { year: number; month: number; day: number }) =>
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toISOString().slice(0, 10)
  const apart = daysApart(day(then), day(now))
  if (apart === 0) return `hoy a las ${clock}`
  if (apart === 1) return `ayer a las ${clock}`
  return `el ${dayLabel(day(then), 'long')} a las ${clock}`
}

/** «de ayer», «del martes 10/11»: de cuándo es un turno que quedó abierto. */
export function staleWords(staleDays: number, shiftDay: string): string {
  return staleDays === 1 ? 'de ayer' : `del ${dayLabel(shiftDay, 'long')}`
}

// ─── En qué momento está la caja ─────────────────────────────────────────────

export type LastClosed = NonNullable<RegisterRef['last_closed']>

export type CashPhase =
  /** Esta caja nunca se abrió: se pregunta con cuánto cambio arranca. */
  | { kind: 'first'; register: RegisterRef | null }
  /** No hay turno abierto: se confirma lo que dejó el anterior. */
  | { kind: 'closed'; register: RegisterRef; last: LastClosed }
  /** Turno abierto. `staleDays` > 0: se abrió en un día de servicio anterior y nadie lo cerró. */
  | { kind: 'open'; register: RegisterRef | null; shift: Shift; staleDays: number }
  /** La caja elegida tiene un turno abierto que no es el que trajo la lectura: hay que pedirlo. */
  | { kind: 'loading'; register: RegisterRef; shiftId: string }

/** La caja que se está mirando: la elegida, la del turno que vino, o la primera. */
export function pickRegister(
  snapshot: Pick<ShiftSnapshot, 'registers' | 'shift'>,
  preferredId: string | null,
): RegisterRef | null {
  const { registers, shift } = snapshot
  return (
    (preferredId ? registers.find((register) => register.id === preferredId) : undefined) ??
    (shift ? registers.find((register) => register.id === shift.register_id) : undefined) ??
    registers[0] ??
    null
  )
}

export function cashPhase(
  snapshot: Pick<ShiftSnapshot, 'now' | 'shift'>,
  register: RegisterRef | null,
  timeZone: string,
): CashPhase {
  const { shift } = snapshot
  const openPhase = (open: Shift): CashPhase => {
    const today = serviceDayAt(snapshot.now, timeZone)
    const staleDays = today ? Math.max(0, daysApart(open.service_day, today)) : 0
    return { kind: 'open', register, shift: open, staleDays }
  }
  if (!register) {
    return shift?.status === 'open' ? openPhase(shift) : { kind: 'first', register: null }
  }
  if (register.open_shift_id) {
    if (shift && shift.id === register.open_shift_id) return openPhase(shift)
    return { kind: 'loading', register, shiftId: register.open_shift_id }
  }
  if (register.last_closed) return { kind: 'closed', register, last: register.last_closed }
  return { kind: 'first', register }
}

/** «Noche», «Caja barra · Noche», «Caja barra». Vacío si no hay nada que decir. */
export function shiftTitle(
  shift: Pick<Shift, 'label' | 'register'>,
  registersCount: number,
): string {
  const parts = [registersCount > 1 ? shift.register : null, shift.label].filter(Boolean)
  return parts.join(' · ')
}

/** Los nombres de turno que se ofrecen para tocar. */
export const SHIFT_LABELS = ['Mañana', 'Mediodía', 'Tarde', 'Noche'] as const

/** El nombre que le toca a un turno que se abre a esa hora: nadie escribe lo que se puede saber. */
export function suggestShiftLabel(iso: string, timeZone: string): (typeof SHIFT_LABELS)[number] {
  const hour = zoneParts(iso, timeZone)?.hour ?? 20
  if (hour >= ROLLOVER_HOUR && hour < 11) return 'Mañana'
  if (hour >= 11 && hour < 16) return 'Mediodía'
  if (hour >= 16 && hour < 20) return 'Tarde'
  return 'Noche'
}

// ─── Quién puede qué ─────────────────────────────────────────────────────────

/** Los turnos abiertos de la sucursal (en el carril que se está mirando). */
export function openShiftIds(snapshot: Pick<ShiftSnapshot, 'registers'>): string[] {
  return snapshot.registers.flatMap((register) =>
    register.open_shift_id ? [register.open_shift_id] : [],
  )
}

export type PaymentAccess = {
  /** Cambiar el medio o si se factura. */
  correct: boolean
  /** Anular (solo mientras la mesa sigue abierta). */
  void: boolean
  /** Por qué no se puede todo, dicho para quien mira. `null` si se puede. */
  note: string | null
}

/**
 * Lo mismo que deciden `pos_edit_payment` y `pos_void_payment`: un cobro anulado no se toca; con
 * el turno cerrado solo un dueño; anular, solo mientras la mesa sigue abierta.
 */
export function paymentAccess(
  payment: Pick<DayPayment, 'status' | 'shift_id' | 'table_closed'>,
  role: string,
  openShifts: ReadonlyArray<string>,
): PaymentAccess {
  if (payment.status !== 'ok') {
    return {
      correct: false,
      void: false,
      note: 'Este cobro está anulado. Queda en la cinta, pero no cuenta en ningún número.',
    }
  }
  const shiftClosed = payment.shift_id !== null && !openShifts.includes(payment.shift_id)
  if (shiftClosed && role !== 'owner') {
    return {
      correct: false,
      void: false,
      note: 'El turno de este cobro ya cerró: lo corrige un dueño.',
    }
  }
  if (payment.table_closed) {
    return {
      correct: true,
      void: false,
      note: 'La mesa ya se cerró: el cobro se corrige, no se anula.',
    }
  }
  return { correct: true, void: true, note: null }
}

/** Anular un retiro o un ingreso: con el turno cerrado, solo un dueño (`pos_void_cash_movement`). */
export function movementAccess(
  movement: Pick<CashMovement, 'voided_at'>,
  role: string,
  shiftOpen: boolean,
): { void: boolean; note: string | null } {
  if (movement.voided_at) {
    return { void: false, note: 'Este movimiento está anulado: no cuenta en el cajón.' }
  }
  if (!shiftOpen && role !== 'owner') {
    return { void: false, note: 'El turno ya cerró: esto lo anula un dueño.' }
  }
  return { void: true, note: null }
}

// ─── El arqueo ───────────────────────────────────────────────────────────────

export type DifferenceLevel =
  /** Coincide. */
  | 'exact'
  /** Menos que el billete más chico: vuelto redondeado. */
  | 'rounding'
  /** Hay que mirarlo, pero se puede cerrar. */
  | 'minor'
  /** Es mucho: primero contar de nuevo, y si se cierra igual, con una nota. */
  | 'large'

/** Una diferencia es grande desde el 5 % de lo que tenía que haber. */
const LARGE_SHARE = 0.05

function sortedBills(denominations: ReadonlyArray<number>): number[] {
  return [...new Set(denominations)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => b - a)
}

/**
 * Qué tan grave es una diferencia de arqueo (`differenceCents` = contado − esperado).
 *
 * «Grande» es el 5 % de lo que tenía que haber, con un piso para que en un cajón casi vacío no
 * salte por monedas: el billete del medio de la lista del bar (con los de hoy, $ 1.000).
 */
export function differenceLevel(
  differenceCents: number,
  expectedCents: number,
  denominations: ReadonlyArray<number>,
): DifferenceLevel {
  const abs = Math.abs(differenceCents)
  if (abs === 0) return 'exact'
  const bills = sortedBills(denominations)
  const smallest = bills.at(-1)
  if (smallest !== undefined && abs < smallest * 100) return 'rounding'
  const middle = bills[Math.floor(bills.length / 2)] ?? 1000
  const threshold = Math.max(Math.round(Math.max(0, expectedCents) * LARGE_SHARE), middle * 100)
  return abs >= threshold ? 'large' : 'minor'
}

/** «Cuadra», «Faltan $ 1.000», «Sobran $ 500»: la diferencia dicha en presente o en pasado. */
export function differenceWords(
  differenceCents: number,
  tense: 'present' | 'past' = 'present',
): { kind: 'exact' | 'short' | 'over'; word: string; text: string } {
  const past = tense === 'past'
  if (differenceCents === 0) {
    const word = past ? 'Cuadró' : 'Cuadra'
    return { kind: 'exact', word, text: word }
  }
  const short = differenceCents < 0
  const word = short ? (past ? 'Faltaron' : 'Faltan') : past ? 'Sobraron' : 'Sobran'
  return {
    kind: short ? 'short' : 'over',
    word,
    text: `${word} ${formatCentsShort(Math.abs(differenceCents))}`,
  }
}

/** Lo que se propone dejar de cambio: lo mismo con lo que se abrió, sin pasarse de lo contado. */
export function defaultLeaveFloat(openingFloatCents: number, countedCents: number): number {
  return Math.max(0, Math.min(openingFloatCents, countedCents))
}

/** Tope de billetes de una misma denominación que se pueden anotar (el de la base es 100.000). */
export const MAX_BILL_COUNT = 9999

/** El conteo con la cantidad de un billete cambiada (entre 0 y el tope). */
export function setBillCount(count: CountBreakdown, value: number, units: number): CountBreakdown {
  const clean = Number.isFinite(units)
    ? Math.min(MAX_BILL_COUNT, Math.max(0, Math.floor(units)))
    : 0
  return {
    ...count,
    bills: count.bills.map((bill) => (bill.value === value ? { ...bill, count: clean } : bill)),
  }
}

/** Cuántos billetes se llevan contados. */
export function countedUnits(count: CountBreakdown): number {
  return count.bills.reduce((total, bill) => total + Math.max(0, bill.count), 0)
}

/** El conteo a medio hacer, guardado en el dispositivo para que un toque de más no lo pierda. */
export type CountDraft = { shiftId: string; startedAt: string; count: CountBreakdown }

export function serializeCountDraft(draft: CountDraft): string {
  return JSON.stringify({
    v: 1,
    shiftId: draft.shiftId,
    startedAt: draft.startedAt,
    bills: draft.count.bills.map((bill) => [bill.value, bill.count]),
    other: draft.count.other_cents ?? 0,
  })
}

/**
 * Lee un conteo guardado. Solo vale si es de ESTE turno; las cantidades se vuelcan sobre los
 * billetes que el bar usa hoy (si sacaron una denominación, lo anotado ahí se pierde: mejor que
 * sumar un billete que ya no está en la lista y que el arqueo no muestra).
 */
export function restoreCountDraft(
  raw: string | null | undefined,
  shiftId: string,
  denominations: ReadonlyArray<number>,
): CountDraft | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const stored = data as Record<string, unknown>
  if (stored.v !== 1 || stored.shiftId !== shiftId || typeof stored.startedAt !== 'string') {
    return null
  }
  if (Number.isNaN(Date.parse(stored.startedAt)) || !Array.isArray(stored.bills)) return null

  const byValue = new Map<number, number>()
  for (const entry of stored.bills) {
    if (!Array.isArray(entry)) return null
    const [value, units] = entry as unknown[]
    if (typeof value !== 'number' || typeof units !== 'number') return null
    byValue.set(value, units)
  }
  let count = emptyCount(denominations)
  for (const bill of count.bills) {
    count = setBillCount(count, bill.value, byValue.get(bill.value) ?? 0)
  }
  const other = typeof stored.other === 'number' && stored.other > 0 ? Math.floor(stored.other) : 0
  return { shiftId, startedAt: stored.startedAt, count: { ...count, other_cents: other } }
}

/**
 * Los cobros en efectivo de este turno que entraron después de un instante. Mientras alguien
 * cuenta, un mozo puede cobrar una mesa: esa plata tiene que estar en el cajón, y si falta justo
 * eso, es lo primero que hay que mirar.
 */
export function cashSince(
  payments: ReadonlyArray<DayPayment>,
  shiftId: string,
  sinceIso: string,
): DayPayment[] {
  const since = Date.parse(sinceIso)
  if (Number.isNaN(since)) return []
  return payments.filter(
    (payment) =>
      payment.shift_id === shiftId &&
      payment.status === 'ok' &&
      payment.method === 'cash' &&
      Date.parse(payment.created_at) > since,
  )
}

// ─── Lo que se lee arriba ────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * La oración que explica el número grande de la caja abierta: en cuántos cobros entró y cuánto
 * falta cobrar en el salón.
 */
export function liveSentence(live: Pick<ShiftSummary, 'payments_count' | 'open_tables'>): string {
  const { count, pending_cents: pending } = live.open_tables
  const tables =
    count === 0
      ? 'No queda ninguna mesa abierta.'
      : pending > 0
        ? `Hay ${formatCentsShort(pending)}${live.payments_count > 0 ? ' más' : ''} en ${count} ${plural(count, 'mesa abierta', 'mesas abiertas')}.`
        : `${plural(count, 'Hay 1 mesa abierta', `Hay ${count} mesas abiertas`)}, todavía sin nada para cobrar.`
  if (live.payments_count === 0) return `Todavía no entró ningún cobro. ${tables}`
  const n = live.payments_count
  return `Es lo que entró en ${n} ${plural(n, 'cobro', 'cobros')}. ${tables}`
}

export type DrawerLine = { key: 'float' | 'cash' | 'in' | 'out'; label: string; cents: number }

/**
 * La cuenta del cajón, renglón por renglón: cambio + efectivo + ingresos − retiros. Los renglones
 * en cero no se muestran (salvo el cambio y el efectivo, que siempre están).
 */
export function drawerLines(
  live: Pick<
    ShiftSummary,
    'opening_float_cents' | 'cash_sales_cents' | 'cash_in_cents' | 'cash_out_cents'
  >,
): DrawerLine[] {
  const lines: DrawerLine[] = [
    { key: 'float', label: 'Cambio con el que se abrió', cents: live.opening_float_cents },
    { key: 'cash', label: 'Cobros en efectivo', cents: live.cash_sales_cents },
  ]
  if (live.cash_in_cents > 0) {
    lines.push({ key: 'in', label: 'Entró plata', cents: live.cash_in_cents })
  }
  if (live.cash_out_cents > 0) {
    lines.push({ key: 'out', label: 'Se sacó', cents: -live.cash_out_cents })
  }
  return lines
}

/** «$ 15.000 de cambio + $ 47.000 en efectivo − $ 8.000 que se sacaron». */
export function drawerSentence(
  live: Pick<
    ShiftSummary,
    'opening_float_cents' | 'cash_sales_cents' | 'cash_in_cents' | 'cash_out_cents'
  >,
): string {
  const parts = [
    `${formatCentsShort(live.opening_float_cents)} de cambio`,
    `+ ${formatCentsShort(live.cash_sales_cents)} en efectivo`,
  ]
  if (live.cash_in_cents > 0) parts.push(`+ ${formatCentsShort(live.cash_in_cents)} que entraron`)
  if (live.cash_out_cents > 0)
    parts.push(`− ${formatCentsShort(live.cash_out_cents)} que se sacaron`)
  return parts.join(' ')
}
