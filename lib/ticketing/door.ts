import { z } from 'zod'
import { formatLongDate } from './dates'
import type { OrderEntry } from './types'

/**
 * La puerta: qué hacer con una entrada cuando la escanean. Puro y testeable. La
 * base vuelve a controlar todo al dejar pasar (`ticket_door_admit`): esto es lo
 * que se le muestra a quien recibe.
 *
 * La llegada NO se guarda aparte: es la misma de la reserva (`arrived`,
 * `actual_guests`). Así da igual si la marcaron con el QR o a mano en la lista:
 * hay una sola verdad, y lo que ve la gente en su entrada coincide con el tablero.
 */

const reservationStatus = z.enum(['pending', 'arrived', 'seated', 'closed', 'no_show', 'cancelled'])

export const doorTicketSchema = z.object({
  order_id: z.string(),
  short_code: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'refunded']),
  title: z.string(),
  poster_url: z.string().nullable(),
  accent_hex: z.string().nullable(),
  guest_name: z.string(),
  party_size: z.number().int(),
  payment_option: z.enum(['deposit', 'full']),
  unit_price_cents: z.number(),
  full_price_cents: z.number(),
  paid_cents: z.number().nullable(),
  balance_cash_only: z.boolean(),
  event_date: z.string(),
  event_time: z.string(),
  service_day: z.string(),
  reservation: z
    .object({
      id: z.string(),
      status: reservationStatus,
      date: z.string(),
      time: z.string(),
      estimated_guests: z.number().int(),
      actual_guests: z.number().int().nullable(),
      /** «21:04», en el huso del bar. */
      arrived_at_label: z.string().nullable(),
      arrived_by_name: z.string().nullable(),
    })
    .nullable(),
  room: z.object({ inside: z.number().int(), expected: z.number().int() }).nullable(),
})

export type DoorTicket = z.infer<typeof doorTicketSchema>

export const doorFunctionSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  time: z.string(),
  inside: z.number().int(),
  expected: z.number().int(),
  /** La sucursal de la función (la base la manda desde las sucursales, 18/11/2026). */
  branch_id: z.string().nullish(),
})

/** Una función de hoy: el cartel arriba de la cámara. */
export type DoorFunction = z.infer<typeof doorFunctionSchema>

/**
 * La entrada es de otra sucursal que la de este equipo: dónde es, para decírselo a quien recibe
 * en vez de dejar pasar. La base no lo controla (las funciones de la puerta son de antes de las
 * sucursales): lo mira la acción antes de dejar pasar.
 */
export type DoorElsewhere = {
  /** El nombre de la sucursal de la entrada. `null` = no se pudo leer. */
  branch: string | null
  /** La sucursal de este equipo, para que quien recibe vea si el equipo quedó en otra. */
  here: string | null
}

export type DoorVerdict =
  /** Pasan: `left` de `total` todavía no entraron. */
  | { kind: 'admit'; left: number; inside: number; total: number }
  /** Ya entraron todos. */
  | { kind: 'used'; total: number; at: string | null; by: string | null }
  /** Es para otro día. */
  | { kind: 'other_day'; when: 'future' | 'past'; date: string; time: string }
  /** Es para otra sucursal: acá no pasa (la reserva es de allá). */
  | {
      kind: 'other_branch'
      branch: string | null
      here: string | null
      date: string
      time: string
      /** La función es hoy (allá). */
      today: boolean
    }
  | { kind: 'not_paid' }
  | { kind: 'refunded' }
  | { kind: 'cancelled' }
  /** Pagó, pero no quedó reserva (la función ya no existe o se llenó). */
  | { kind: 'no_reservation' }

const IN_THE_ROOM = new Set(['arrived', 'seated', 'closed'])

/** Quiénes ya entraron de una reserva. Marcada a mano sin contar: cuentan todos. */
export function guestsInside(reservation: NonNullable<DoorTicket['reservation']>): number {
  if (!IN_THE_ROOM.has(reservation.status)) return 0
  return reservation.actual_guests ?? reservation.estimated_guests
}

/**
 * El orden importa: primero lo que invalida la entrada, después dónde, el día y el cupo. Una
 * entrada que ya se usó dice «Ya entraron» aunque sea de otra sucursal: es lo más útil de saber.
 */
export function doorVerdict(
  ticket: DoorTicket,
  elsewhere: DoorElsewhere | null = null,
): DoorVerdict {
  if (ticket.status === 'refunded') return { kind: 'refunded' }
  if (ticket.status !== 'approved') return { kind: 'not_paid' }
  const reservation = ticket.reservation
  if (!reservation) return { kind: 'no_reservation' }
  if (reservation.status === 'cancelled') return { kind: 'cancelled' }

  // La reserva sigue al evento: si lo movieron, vale la fecha nueva.
  const total = Math.max(ticket.party_size, reservation.estimated_guests)
  const inside = guestsInside(reservation)
  if (inside >= total) {
    return {
      kind: 'used',
      total,
      at: reservation.arrived_at_label,
      by: reservation.arrived_by_name,
    }
  }
  if (elsewhere) {
    return {
      kind: 'other_branch',
      branch: elsewhere.branch,
      here: elsewhere.here,
      date: reservation.date,
      time: reservation.time,
      today: reservation.date === ticket.service_day,
    }
  }
  if (reservation.date !== ticket.service_day) {
    return {
      kind: 'other_day',
      when: reservation.date > ticket.service_day ? 'future' : 'past',
      date: reservation.date,
      time: reservation.time,
    }
  }
  return { kind: 'admit', left: total - inside, inside, total }
}

/** ¿La entrada es de otra sucursal? Solo si se saben las dos: sin datos, la puerta no frena a nadie. */
export function isOtherBranch(
  ticketBranchId: string | null | undefined,
  doorBranchId: string | null | undefined,
): boolean {
  return Boolean(ticketBranchId && doorBranchId && ticketBranchId !== doorBranchId)
}

/**
 * Lo que se le dice a quien recibe: «Esta entrada es para Shrek 2 de hoy a las 21:00 hs en Cerro.
 * Este equipo está en Alta Córdoba.»
 */
export function otherBranchNote(
  title: string,
  verdict: Extract<DoorVerdict, { kind: 'other_branch' }>,
): string {
  const where = verdict.branch ?? 'otra sucursal'
  const when = verdict.today
    ? `de hoy a las ${verdict.time} hs`
    : `del ${formatLongDate(verdict.date)}, ${verdict.time} hs,`
  const here = verdict.here ? ` Este equipo está en ${verdict.here}.` : ''
  return `Esta entrada es para ${title} ${when} en ${where}.${here}`
}

/**
 * ¿Entró aunque se haya perdido la respuesta? Se mira cómo quedó la reserva antes
 * de ofrecer reintentar. Si alguien más los dejó pasar en el medio, también están
 * adentro, que es lo que importa.
 */
export function admitLanded(insideBefore: number, guests: number, fresh: DoorTicket): boolean {
  return fresh.reservation ? guestsInside(fresh.reservation) >= insideBefore + guests : false
}

/** Lo que falta cobrar en el local, en centavos. Con la entrada paga, 0. */
export function doorBalanceCents(
  ticket: Pick<
    DoorTicket,
    'payment_option' | 'full_price_cents' | 'unit_price_cents' | 'party_size'
  >,
): number {
  if (ticket.payment_option !== 'deposit') return 0
  return Math.max(0, (ticket.full_price_cents - ticket.unit_price_cents) * ticket.party_size)
}

/** Lo que el token de un escaneo dice ser: el código del QR o el número de la entrada. */
export type DoorToken = { entryCode: string } | { shortCode: string }

const ENTRY_CODE_RE = /^[A-Za-z0-9_-]{22}$/
const SHORT_CODE_RE = /^[0-9a-f]{8}$/i

export function parseDoorToken(token: string): DoorToken | null {
  const clean = token.trim()
  if (ENTRY_CODE_RE.test(clean)) return { entryCode: clean }
  const code = clean.replace(/[\s#-]/g, '')
  return SHORT_CODE_RE.test(code) ? { shortCode: code.toUpperCase() } : null
}

/** «A1B2C3D4» → «A1B2 C3D4», como se dicta. */
export function formatShortCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`
}

/** La llegada que ve la gente en su entrada, a partir de la reserva. */
export function orderEntryFrom(
  reservation: {
    status: string
    estimated_guests: number
    actual_guests: number | null
    arrived_at: string | null
  } | null,
  partySize: number,
  formatTime: (iso: string) => string,
): OrderEntry {
  const total = Math.max(partySize, reservation?.estimated_guests ?? 0)
  if (!reservation) return { inside: 0, total, atLabel: null, cancelled: false }
  const inside = IN_THE_ROOM.has(reservation.status)
    ? (reservation.actual_guests ?? reservation.estimated_guests)
    : 0
  return {
    inside,
    total,
    atLabel: inside > 0 && reservation.arrived_at ? formatTime(reservation.arrived_at) : null,
    cancelled: reservation.status === 'cancelled',
  }
}
