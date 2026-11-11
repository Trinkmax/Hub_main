/**
 * Cuándo hay que pedir lo de cada evento. Puro.
 *
 * La regla de HUB (Tomás, 11/11/2026): la mercadería tiene que entrar N días antes del evento (N = 2, en los
 * Ajustes de Compras). Para cada fecha que suma insumos y cada proveedor que trae algo de su receta:
 *
 *   tiene que llegar hasta = la fecha − N
 *   llega                  = el último día de entrega del proveedor que no pasa de eso
 *   pedir hasta            = ese día − la anticipación del proveedor
 *
 * Después se fija si ya está pedido (un pedido con ese evento en sus renglones), si lo vio un conteo ya mandado,
 * si lo trae a tiempo un conteo que viene (el primero cuya ventana llega a la fecha, si se hace antes de «pedir
 * hasta») o si hay que pedirlo aparte: más adelante, hoy o, si ya es tarde, cuándo llegaría pidiéndolo hoy.
 */
import { addDays, isoDayInCordoba, weekdayOf } from '@/lib/dates'
import {
  type CountSchedule,
  defaultEventsUntil,
  effectiveDeliveryDate,
  latestDeliveryOnOrBefore,
  nextDeliveryDate,
} from './dates'
import type { PlannedEvent } from './events'
import {
  expectedPacks,
  type PurItem,
  type PurOrder,
  type PurOrderLine,
  type PurSupplier,
} from './types'

export type DeadlineStatus =
  /** Va en un pedido mandado o confirmado que llega a tiempo (o ya llegó). */
  | 'ordered'
  /** Va en un pedido mandado o confirmado, pero llega (o llegó) después de lo que hacía falta. */
  | 'ordered_late'
  /** Está en un pedido para revisar: llega a tiempo si se manda hasta «pedir hasta». */
  | 'draft'
  /** Está en un pedido para revisar, pero mandándolo hoy ya no llega a tiempo. */
  | 'draft_late'
  /** Lo vio un conteo ya mandado y no hizo falta pedirlo: alcanzaba con lo que había. */
  | 'counted'
  /** Lo suma un conteo que viene, a tiempo: no hay que hacer nada. */
  | 'count'
  /** Ningún conteo llega a tiempo: hay que pedirlo aparte, hasta «pedir hasta». */
  | 'todo'
  /** Hay que pedirlo hoy. */
  | 'today'
  /** Ya es tarde: pedido hoy, llega `arrives`. */
  | 'late'
  /** Insumos sin proveedor: no se sabe a quién pedírselos ni cuándo. */
  | 'no_supplier'

export type SupplierDeadline = {
  /** `null`: los insumos que no tienen proveedor. */
  supplier: PurSupplier | null
  /** Lo que trae para este evento (los insumos de la receta). */
  items: PurItem[]
  /** Todo tiene que llegar hasta ese día: la fecha del evento − N. */
  mustArriveBy: string
  /**
   * El último día de entrega que llega a tiempo. Sin días de entrega cargados, la cuenta supone que lo trae
   * cualquier día (`noDays`). `null` sin proveedor.
   */
  deliveryDay: string | null
  /** Hasta cuándo pedirle para que llegue ese día. `null` sin proveedor. */
  orderBy: string | null
  /** El proveedor no tiene días de entrega: la fecha es una suposición. */
  noDays: boolean
  status: DeadlineStatus
  /**
   * Cuándo llega: la del pedido donde está (o cuando llegó), la del conteo que lo va a traer o, si ya es tarde,
   * pidiéndolo hoy. `null` cuando no se sabe (proveedor sin días de entrega).
   */
  arrives: string | null
  /** El conteo que lo va a traer (`count`) o el que lo vio (`counted`). */
  countDate: string | null
  /** El pedido donde está (`ordered`, `ordered_late`, `draft`, `draft_late`). */
  orderId: string | null
  /** Ya llegó: la cocina lo recibió (`arrives` es ese día). */
  received: boolean
}

export type EventDeadline = {
  planned: PlannedEvent
  /** La fecha del evento − N. */
  mustArriveBy: string
  /** Un renglón por proveedor, el que hay que pedir primero arriba. Vacío si la fecha no suma insumos. */
  suppliers: SupplierDeadline[]
}

/** Un conteo que viene, con hasta qué día cubre los eventos. */
export type UpcomingCount = { date: string; until: string; open: boolean }

/** Un conteo ya mandado, con su ventana de eventos. */
export type SentCount = { id: string; countDate: string; eventsUntil: string }

/**
 * Los conteos de los próximos días: el que está abierto (si lo hay) y los de los días de conteo. Si hoy es día
 * de conteo y ya se mandó uno hoy, el de hoy ya pasó.
 */
export function upcomingCounts(input: {
  today: string
  schedule: CountSchedule
  openCount: { countDate: string; eventsUntil: string } | null
  lastSentCountDate: string | null
  days?: number
}): UpcomingCount[] {
  const out: UpcomingCount[] = []
  let from = input.today
  if (input.openCount) {
    out.push({ date: input.openCount.countDate, until: input.openCount.eventsUntil, open: true })
    from = addDays(
      input.openCount.countDate > input.today ? input.openCount.countDate : input.today,
      1,
    )
  } else if (input.lastSentCountDate && input.lastSentCountDate >= input.today) {
    from = addDays(input.today, 1)
  }
  const days = input.days ?? 21
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i)
    if (!input.schedule.countWeekdays.includes(weekdayOf(date))) continue
    out.push({ date, until: defaultEventsUntil(date, input.schedule), open: false })
  }
  return out
}

/** Los renglones de un pedido que llevan algo para ese evento. */
function linesForEvent(order: PurOrder, label: string): PurOrderLine[] {
  return order.lines.filter((l) => {
    if (!l.eventNames.includes(label)) return false
    if (order.status === 'draft') return (l.orderedPacks ?? 1) > 0
    if (order.status === 'completed' || order.status === 'with_differences') {
      return l.receivedState !== 'missing'
    }
    return expectedPacks(l) > 0
  })
}

const BY_NAME = (a: PurItem, b: PurItem) => a.name.localeCompare(b.name, 'es')

function supplierDeadline(input: {
  planned: PlannedEvent
  supplier: PurSupplier | null
  items: PurItem[]
  mustArriveBy: string
  orders: readonly PurOrder[]
  sentCounts: readonly SentCount[]
  counts: readonly UpcomingCount[]
  today: string
}): SupplierDeadline {
  const { planned, supplier, mustArriveBy, today } = input
  const items = [...input.items].sort(BY_NAME)
  const base = {
    supplier,
    items,
    mustArriveBy,
    deliveryDay: null,
    orderBy: null,
    noDays: false,
    arrives: null,
    countDate: null,
    orderId: null,
    received: false,
  }
  if (!supplier) return { ...base, status: 'no_supplier' }

  const date = planned.event.date
  const label = planned.label
  const noDays = supplier.deliveryWeekdays.length === 0
  const deliveryDay = noDays
    ? mustArriveBy
    : (latestDeliveryOnOrBefore(mustArriveBy, supplier.deliveryWeekdays) ?? mustArriveBy)
  const orderBy = addDays(deliveryDay, -supplier.leadDays)
  const timed = { ...base, deliveryDay, orderBy, noDays }

  // ¿Ya está en un pedido? Primero lo mandado (o recibido), después lo que está para revisar.
  const mine = input.orders.filter((o) => o.supplierId === supplier.id && o.status !== 'discarded')
  const placed = mine.find((o) => o.status !== 'draft' && linesForEvent(o, label).length > 0)
  if (placed) {
    const arrives = placed.receivedAt ? isoDayInCordoba(placed.receivedAt) : placed.expectedDate
    return {
      ...timed,
      status: arrives && arrives > mustArriveBy ? 'ordered_late' : 'ordered',
      arrives,
      orderId: placed.id,
      received: placed.receivedAt != null,
    }
  }
  const draft = mine.find((o) => o.status === 'draft' && linesForEvent(o, label).length > 0)
  if (draft) {
    const arrives = effectiveDeliveryDate(draft.expectedDate, supplier, today)
    return {
      ...timed,
      status: arrives && arrives > mustArriveBy ? 'draft_late' : 'draft',
      arrives,
      orderId: draft.id,
    }
  }

  // ¿Lo vio un conteo ya mandado? Si no quedó en ningún pedido, alcanzaba con lo que había (salvo que el
  // pedido de ese conteo se haya descartado con «Hoy no pido»).
  const seen = [...input.sentCounts]
    .sort((a, b) => (a.countDate < b.countDate ? 1 : -1))
    .find((c) => c.countDate <= date && date <= c.eventsUntil)
  if (seen) {
    const skipped = input.orders.some(
      (o) =>
        o.countId === seen.id &&
        o.supplierId === supplier.id &&
        o.status === 'discarded' &&
        o.discardReason === 'skipped',
    )
    if (!skipped) return { ...timed, status: 'counted', countDate: seen.countDate }
  }

  // Todavía no se pidió: ¿lo trae a tiempo un conteo que viene?
  const count = input.counts.find((c) => c.date <= date && date <= c.until)
  if (count) {
    const sendsOn = count.date > today ? count.date : today
    if (sendsOn <= orderBy) {
      return {
        ...timed,
        status: 'count',
        countDate: count.date,
        arrives: noDays
          ? null
          : nextDeliveryDate(sendsOn, supplier.deliveryWeekdays, supplier.leadDays),
      }
    }
  }
  if (orderBy < today) {
    return {
      ...timed,
      status: 'late',
      arrives: noDays
        ? null
        : nextDeliveryDate(today, supplier.deliveryWeekdays, supplier.leadDays),
    }
  }
  return { ...timed, status: orderBy === today ? 'today' : 'todo' }
}

/** Para cada fecha, cuándo hay que pedirle a cada proveedor lo de su receta y si ya está pedido. */
export function eventDeadlines(input: {
  events: readonly PlannedEvent[]
  items: ReadonlyMap<string, PurItem>
  suppliers: ReadonlyMap<string, PurSupplier>
  /** Los pedidos de los últimos días, en cualquier estado (los descartados también: «Hoy no pido»). */
  orders: readonly PurOrder[]
  /** Los conteos ya mandados de los últimos días. */
  sentCounts: readonly SentCount[]
  /** Los conteos que vienen (`upcomingCounts`). */
  counts: readonly UpcomingCount[]
  arriveDaysBefore: number
  today: string
}): EventDeadline[] {
  return input.events.map((planned) => {
    const mustArriveBy = addDays(planned.event.date, -input.arriveDaysBefore)
    if (planned.status !== 'sums' || !planned.recipe)
      return { planned, mustArriveBy, suppliers: [] }

    // Lo de la receta que se compra, por proveedor (como arma los pedidos el conteo: un proveedor
    // desactivado cuenta como «sin proveedor»).
    const groups = new Map<string, PurItem[]>()
    for (const line of planned.recipe.lines) {
      if (line.inHouse || !line.itemId || line.quantity == null) continue
      const item = input.items.get(line.itemId)
      if (!item?.active) continue
      const supplier = item.supplierId ? input.suppliers.get(item.supplierId) : undefined
      const key = supplier?.active ? supplier.id : ''
      const list = groups.get(key) ?? []
      if (!list.some((i) => i.id === item.id)) list.push(item)
      groups.set(key, list)
    }

    const suppliers = [...groups].map(([key, items]) =>
      supplierDeadline({
        planned,
        supplier: key ? (input.suppliers.get(key) ?? null) : null,
        items,
        mustArriveBy,
        orders: input.orders,
        sentCounts: input.sentCounts,
        counts: input.counts,
        today: input.today,
      }),
    )
    suppliers.sort((a, b) => {
      if (!a.orderBy || !b.orderBy) return a.orderBy ? -1 : b.orderBy ? 1 : 0
      return (
        a.orderBy.localeCompare(b.orderBy) ||
        (a.supplier?.name ?? '').localeCompare(b.supplier?.name ?? '', 'es')
      )
    })
    return { planned, mustArriveBy, suppliers }
  })
}

/** Lo que pide que quien compra haga algo (hoy o más adelante). */
export function needsAction(row: SupplierDeadline): boolean {
  return (
    row.status === 'todo' ||
    row.status === 'today' ||
    row.status === 'late' ||
    row.status === 'draft_late' ||
    row.status === 'ordered_late' ||
    row.status === 'no_supplier'
  )
}

/** Lo que hay que resolver hoy: pedir hoy, mandar hoy lo que está para revisar, o lo que ya llega tarde. */
export function isUrgent(row: SupplierDeadline, today: string): boolean {
  if (row.status === 'today' || row.status === 'late' || row.status === 'draft_late') return true
  if (row.status === 'ordered_late') return true
  return row.status === 'draft' && row.orderBy != null && row.orderBy <= today
}

/**
 * Lo de la semana: las fechas de los próximos `days` días y, más adelante, las que tienen algo para pedir
 * aparte dentro de esos días (un proveedor que pide con mucha anticipación).
 */
export function weekDeadlines(
  all: readonly EventDeadline[],
  today: string,
  days = 7,
): EventDeadline[] {
  const end = addDays(today, days - 1)
  return all.filter(
    (e) =>
      e.planned.event.date <= end ||
      e.suppliers.some(
        (s) =>
          s.orderBy != null &&
          s.orderBy <= end &&
          (s.status === 'todo' || s.status === 'today' || s.status === 'late'),
      ),
  )
}
