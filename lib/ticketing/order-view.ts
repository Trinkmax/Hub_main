import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, formatShortDate, formatTime } from '@/lib/ticketing/dates'
import { isManualTransfer } from '@/lib/ticketing/transfer'
import type { OrderAttention, OrderStatus, PaymentOption } from '@/lib/ticketing/types'

/**
 * Las ventas online del panel: cómo se dice el estado de cada compra.
 *
 * «Vencido» no es un estado de la base: es un pedido pending/rejected con el
 * lugar ya liberado (`hold_expires_at` en el pasado). Mismo criterio que
 * `isOrderExpired` de lib/ticketing/queries.ts, que no se puede importar acá
 * porque ese archivo es solo del server.
 *
 * Puro: sin DB ni React (lo usan Ventas online, Tex y los tests).
 */

export type OrderTone = 'paid' | 'paying' | 'retrying' | 'unpaid' | 'refunded'

export type OrderStatusView = {
  label: string
  tone: OrderTone
  /** Qué significa, para el `title` y el lector de pantalla. */
  hint: string
}

export type AttentionView = {
  label: string
  hint: string
}

/** ¿Ya se liberó el lugar? Una fecha ilegible cuenta como vencida: mejor «Sin pagar» que un «Pagando…» eterno. */
export function holdExpired(holdExpiresAt: string, now: Date): boolean {
  const at = Date.parse(holdExpiresAt)
  return !Number.isFinite(at) || at <= now.getTime()
}

const UNPAID: OrderStatusView = {
  label: 'Sin pagar',
  tone: 'unpaid',
  hint: 'No terminó de pagar a tiempo: el lugar se liberó y no hay reserva.',
}

export function orderStatusView(
  order: { status: OrderStatus; hold_expires_at: string; mp_payment_type?: string | null },
  now: Date = new Date(),
): OrderStatusView {
  const transfer = isManualTransfer(order.mp_payment_type)
  switch (order.status) {
    case 'approved':
      if (transfer) {
        return {
          label: 'Transferencia',
          tone: 'paid',
          hint: 'Alguien del bar confirmó la transferencia y la reserva se cargó sola.',
        }
      }
      return {
        label: 'Pagado',
        tone: 'paid',
        hint: 'Mercado Pago confirmó el pago y la reserva se cargó sola.',
      }
    case 'refunded':
      if (transfer) {
        return {
          label: 'Anulada',
          tone: 'refunded',
          hint: 'Se anuló la transferencia confirmada: la entrada ya no vale.',
        }
      }
      return {
        label: 'Devuelto',
        tone: 'refunded',
        hint: 'Mercado Pago devolvió el pago (o hubo un contracargo).',
      }
    case 'pending':
      return holdExpired(order.hold_expires_at, now)
        ? UNPAID
        : {
            label: 'Pagando…',
            tone: 'paying',
            hint: 'Está pagando en Mercado Pago: el lugar queda guardado hasta que termine.',
          }
    case 'rejected':
      return holdExpired(order.hold_expires_at, now)
        ? UNPAID
        : {
            label: 'Reintentando',
            tone: 'retrying',
            hint: 'Mercado Pago rechazó el pago; todavía puede probar con otra tarjeta.',
          }
  }
  // Un estado que todavía no conocemos (la base sumó uno): se muestra tal cual.
  return { label: String(order.status), tone: 'unpaid', hint: 'Estado desconocido.' }
}

const ATTENTION: Record<OrderAttention, AttentionView> = {
  overbooked: {
    label: 'Sobrecupo',
    hint: 'Pagó cuando ya no quedaba lugar. La reserva se cargó igual: revisá el cupo de esa función.',
  },
  event_missing: {
    label: 'Sin fecha: cargá la reserva a mano',
    hint: 'La fecha ya no está en el calendario, así que la reserva no se pudo crear sola.',
  },
  amount_mismatch: {
    label: 'Monto distinto',
    hint: 'Mercado Pago informa un pago menor al de la compra. Revisalo antes de la función.',
  },
  duplicate_payment: {
    label: 'Pago doble',
    hint: 'Entraron dos pagos aprobados para la misma compra: devolvé uno desde Mercado Pago.',
  },
}

/** Lo que tiene que mirar una persona, o `null` si la compra está en orden. */
export function attentionView(attention: OrderAttention | null | undefined): AttentionView | null {
  if (!attention) return null
  return ATTENTION[attention] ?? null
}

/** «Devolver» solo aparece en una compra pagada: la devuelta ya no tiene plata que devolver. */
export function canRefund(order: { status: OrderStatus }): boolean {
  return order.status === 'approved'
}

/** Lo que se cobró (si pagó) o lo que se iba a cobrar (si no), en centavos. */
export function orderAmountCents(order: {
  status: OrderStatus
  paid_cents: number | null
  total_cents: number
}): number {
  const paid = order.status === 'approved' || order.status === 'refunded'
  if (paid && order.paid_cents !== null) return Number(order.paid_cents)
  return Number(order.total_cents)
}

export function paymentOptionLabel(option: PaymentOption): string {
  return option === 'deposit' ? 'Seña' : 'Total'
}

/** «Mar 01 dic 21:00» */
export function orderFunctionLabel(order: { event_date: string; event_time: string }): string {
  return `${formatShortDate(order.event_date)} ${formatTime(order.event_time)}`
}

/** «2 personas» */
export function peopleLabel(n: number): string {
  return n === 1 ? '1 persona' : `${n} personas`
}

function shiftDay(isoDay: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = isoDay.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Cuándo entró la compra, en el reloj del bar: «Hoy 18:42», «Ayer 23:10»,
 * «24/10 18:42» o, de otro año, «24/10/2025 18:42».
 */
export function formatOrderMoment(iso: string, now: Date = new Date(), tz = DEFAULT_TZ): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  const day = formatInTimeZone(at, tz, 'yyyy-MM-dd')
  const time = formatInTimeZone(at, tz, 'HH:mm')
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd')
  if (day === today) return `Hoy ${time}`
  if (day === shiftDay(today, -1)) return `Ayer ${time}`
  if (day.slice(0, 4) === today.slice(0, 4)) return `${formatInTimeZone(at, tz, 'dd/MM')} ${time}`
  return `${formatInTimeZone(at, tz, 'dd/MM/yyyy')} ${time}`
}

/** La hora de la compra, en el reloj del bar: «18:42». El día ya lo dice el título de la tanda. */
export function formatOrderTime(iso: string, tz = DEFAULT_TZ): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return formatInTimeZone(at, tz, 'HH:mm')
}

/**
 * Si ya entraron, cómo decirlo: «Entraron 2 de 4 · 21:04». Sale de la reserva, así
 * que también cuenta si los marcaron a mano en la lista. `null` si todavía no.
 */
export function orderEntryLabel(
  order: {
    party_size: number
    reservation: {
      status: string
      estimated_guests: number
      actual_guests: number | null
      arrived_at: string | null
    } | null
  },
  tz: string = DEFAULT_TZ,
): string | null {
  const reservation = order.reservation
  if (!reservation || !['arrived', 'seated', 'closed'].includes(reservation.status)) return null
  const total = Math.max(order.party_size, reservation.estimated_guests)
  const inside = reservation.actual_guests ?? reservation.estimated_guests
  const at = reservation.arrived_at
    ? ` · ${formatInTimeZone(new Date(reservation.arrived_at), tz, 'HH:mm')}`
    : ''
  return `${inside >= total ? 'Entraron' : `Entraron ${inside} de ${total}`}${at}`
}

/**
 * El mensaje con el link de la entrada, para mandárselo a quien pagó: los que ya
 * pagaron antes del QR, o quien perdió el link.
 */
export function orderTicketMessage(order: { title: string; guest_name: string }, link: string) {
  const firstName = order.guest_name.trim().split(/\s+/)[0] ?? ''
  return `¡Hola ${firstName}! Esta es tu entrada para ${order.title}, con el QR para la puerta y el comprobante: ${link}`
}

/**
 * Dejaron pasar y lo deshicieron en la puerta: «Deshizo Luz · 21:05». Queda a la
 * vista porque borrar una llegada también puede esconder plata.
 */
export function orderUndoLabel(
  undo: { by: string | null; at: string; from: number; to: number },
  tz: string = DEFAULT_TZ,
): { label: string; hint: string } {
  const at = formatInTimeZone(new Date(undo.at), tz, 'HH:mm')
  return {
    label: `Deshizo ${undo.by ?? 'alguien del equipo'} · ${at}`,
    hint: `En la puerta dejaron pasar y después lo deshicieron: de ${undo.from} a ${undo.to} adentro.`,
  }
}
