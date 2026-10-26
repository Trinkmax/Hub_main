import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, formatShortDate, formatTime } from '@/lib/ticketing/dates'
import type { OrderAttention, OrderStatus, PaymentOption } from '@/lib/ticketing/types'

/**
 * Las ventas online del panel: cómo se dice el estado de cada compra.
 *
 * «Vencido» no es un estado de la base: es un pedido pending/rejected con el
 * lugar ya liberado (`hold_expires_at` en el pasado). Mismo criterio que
 * `isOrderExpired` de lib/ticketing/queries.ts, que no se puede importar acá
 * porque ese archivo es solo del server.
 *
 * Puro: sin DB ni React (lo usan la lista de ventas y los tests).
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
  order: { status: OrderStatus; hold_expires_at: string },
  now: Date = new Date(),
): OrderStatusView {
  switch (order.status) {
    case 'approved':
      return {
        label: 'Pagado',
        tone: 'paid',
        hint: 'Mercado Pago confirmó el pago y la reserva se cargó sola.',
      }
    case 'refunded':
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
