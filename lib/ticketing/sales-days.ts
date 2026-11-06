import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { DEFAULT_TZ, formatDayMonth, formatLongDate } from './dates'
import { orderAmountCents } from './order-view'
import { formatPesos } from './pricing'
import type { OrderStatus } from './types'

/**
 * Ventas online, día por día.
 *
 * Pedido de Nacho (audio del 06/11/2026): que la anfitriona vea las ventas aparte de Marketing,
 * que confirme las transferencias y que se puedan «seguir viendo todos los días, por día, todos
 * los que te pagaron». Antes la lista eran las últimas 60 compras: en HUB llegaba apenas al 04/11
 * y lo anterior no se veía en ningún lado.
 *
 * Cada página es una semana de compras que termina en `hasta`. El día es el de la COMPRA en el
 * reloj del bar, no el de la función: es lo que se cruza con la cuenta cuando alguien avisa que
 * transfirió. «Ver días anteriores» salta a la semana de la venta anterior más nueva, así que nunca
 * abre una página vacía aunque haya semanas sin ventas en el medio. Una semana entra siempre en una
 * sola consulta: la API corta en 1.000 filas y un bar no vende eso en siete días.
 *
 * Puro: sin DB ni React (lo usan la página, Tex y los tests).
 */

export const SALES_PAGE_DAYS = 7

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** El mismo día calendario corrido `days` días (sin husos: es una fecha, no un instante). */
export function shiftDay(isoDay: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = isoDay.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** «2026-02-30» tiene la forma pero no existe: corrido cero días ya no da lo mismo. */
function isRealDay(value: string): boolean {
  return ISO_DAY.test(value) && shiftDay(value, 0) === value
}

export type SalesPage = {
  /** Primer día de la página, el más viejo. */
  from: string
  /** Último día, el más nuevo (inclusive). */
  to: string
  /** Hoy, en el reloj del bar. */
  today: string
  /** La página termina hoy: no hay nada más nuevo para ver. */
  latest: boolean
}

/**
 * La página que pide la URL (`?hasta=AAAA-MM-DD`). Sin fecha, con una que no existe o con una
 * futura: la semana que termina hoy.
 */
export function salesPage(
  raw: string | string[] | undefined,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): SalesPage {
  const today = formatInTimeZone(now, tz, 'yyyy-MM-dd')
  const value = Array.isArray(raw) ? raw[0] : raw
  const to = value && isRealDay(value) && value < today ? value : today
  return { from: shiftDay(to, -(SALES_PAGE_DAYS - 1)), to, today, latest: to === today }
}

/** El instante en que empieza ese día en el bar, para comparar con `created_at`. */
export function dayStartIso(isoDay: string, tz: string = DEFAULT_TZ): string {
  return fromZonedTime(`${isoDay}T00:00:00`, tz).toISOString()
}

/** Lo que filtra la consulta: desde el primer día a la medianoche hasta el día después del último. */
export function salesPageRange(
  page: Pick<SalesPage, 'from' | 'to'>,
  tz: string = DEFAULT_TZ,
): { fromIso: string; toIso: string } {
  return { fromIso: dayStartIso(page.from, tz), toIso: dayStartIso(shiftDay(page.to, 1), tz) }
}

/** El día del bar en que entró la compra. */
export function purchaseDay(createdAt: string, tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(createdAt), tz, 'yyyy-MM-dd')
}

/**
 * «Ver días anteriores»: la página que termina el día de la venta anterior más nueva. `null` si no
 * hay ventas más viejas (o si la fecha no se puede leer: mejor sin botón que con uno que falla).
 */
export function previousPageEnd(
  olderCreatedAt: string | null,
  tz: string = DEFAULT_TZ,
): string | null {
  if (!olderCreatedAt || Number.isNaN(Date.parse(olderCreatedAt))) return null
  return purchaseDay(olderCreatedAt, tz)
}

type DayOrder = {
  created_at: string
  status: OrderStatus
  paid_cents: number | null
  total_cents: number
}

export type SalesDay<T extends DayOrder> = {
  day: string
  /** En el orden en que llegaron (de la más nueva a la más vieja). */
  orders: T[]
  /** Pagadas, por Mercado Pago o con la transferencia confirmada. Las devueltas no cuentan. */
  paid: number
  /** Lo cobrado por esas compras, en centavos. */
  paidCents: number
  /** Las que no se pagaron (todavía o nunca): entre esas está la transferencia por confirmar. */
  unpaid: number
}

/** Las compras en tandas por día, del día más nuevo al más viejo. */
export function groupSalesByDay<T extends DayOrder>(
  orders: readonly T[],
  tz: string = DEFAULT_TZ,
): SalesDay<T>[] {
  const days = new Map<string, SalesDay<T>>()
  for (const order of orders) {
    const day = purchaseDay(order.created_at, tz)
    let group = days.get(day)
    if (!group) {
      group = { day, orders: [], paid: 0, paidCents: 0, unpaid: 0 }
      days.set(day, group)
    }
    group.orders.push(order)
    if (order.status === 'approved') {
      group.paid += 1
      group.paidCents += orderAmountCents(order)
    } else if (order.status === 'pending' || order.status === 'rejected') {
      group.unpaid += 1
    }
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day))
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/**
 * El título de la tanda: «Hoy» o «Ayer» con la fecha al lado, y si no, la fecha sola
 * («Martes 4 de noviembre»). El año, solo si no es este.
 */
export function salesDayTitle(day: string, today: string): { title: string; date: string | null } {
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` de ${day.slice(0, 4)}`
  const long = `${formatLongDate(day)}${year}`
  if (day === today) return { title: 'Hoy', date: long }
  if (day === shiftDay(today, -1)) return { title: 'Ayer', date: long }
  return { title: capitalize(long), date: null }
}

/** «3 pagadas · $ 120.000» (o «Ninguna pagada») y, aparte, «2 sin pagar». */
export function salesDaySummary(group: Pick<SalesDay<DayOrder>, 'paid' | 'paidCents' | 'unpaid'>): {
  paid: string
  unpaid: string | null
} {
  const paid =
    group.paid === 0
      ? 'Ninguna pagada'
      : `${group.paid === 1 ? '1 pagada' : `${group.paid} pagadas`} · ${formatPesos(group.paidCents)}`
  return { paid, unpaid: group.unpaid > 0 ? `${group.unpaid} sin pagar` : null }
}

/** «Del 29/10 al 04/11»: para la página que no es la de esta semana. */
export function salesPageLabel(page: Pick<SalesPage, 'from' | 'to'>): string {
  return `Del ${formatDayMonth(page.from)} al ${formatDayMonth(page.to)}`
}
