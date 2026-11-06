/**
 * El pedido sugerido. Puro: lo usan el resumen de la cocina (antes de enviar) y el servidor (al enviar).
 *
 *   A pedir = objetivo + eventos − contado − en camino, redondeado hacia arriba a la presentación.
 *
 * - Lo que no se contó no se pide, salvo lo que pide un evento: eso se pide completo.
 * - Alcanza = hay el objetivo. No hay = 0. Poco sin número = una fracción del objetivo (la mitad).
 * - Sin objetivo y con «No hay» o «Poco», la cantidad la define quien compra («a definir»).
 * - Lo que ya está pedido y no llegó (en camino) se descuenta, para no pedirlo dos veces.
 */
import { monthOf } from '@/lib/dates'
import { nextDeliveryDate } from './dates'
import type { EventNeed } from './events'
import type { CountState, PurCountLine, PurItem, PurSupplier, PurZone } from './types'
import { packsFor, roundQty } from './units'

const EPSILON = 1e-6

/** Qué productos aparecen en un conteo. */
export function itemsForCount(input: {
  items: readonly PurItem[]
  needs: ReadonlyMap<string, EventNeed>
  /** Último día en que se contó cada insumo (en un conteo enviado). */
  lastCounted: ReadonlyMap<string, string>
  countDate: string
}): PurItem[] {
  const month = monthOf(input.countDate)
  return input.items.filter((item) => {
    if (!item.active) return false
    if (input.needs.has(item.id)) return true
    if (item.frequency === 'frequent') return true
    if (item.frequency === 'secondary') {
      const last = input.lastCounted.get(item.id)
      return !last || monthOf(last) !== month
    }
    return false
  })
}

/** Lo que se toma como «hay», en la unidad del insumo. `null` = no se puede decir (Poco sin objetivo). */
export function countedQty(
  line: Pick<PurCountLine, 'state' | 'quantity'>,
  targetQty: number | null,
  lowFraction: number,
): number | null {
  switch (line.state) {
    case 'none':
      return 0
    case 'enough':
      return targetQty
    case 'low':
      return line.quantity ?? (targetQty == null ? null : roundQty(targetQty * lowFraction))
    case 'exact':
      return line.quantity
  }
}

/** Para las barras del resumen: un número exacto también cae en alcanza / poco / no hay. */
export function stockLevel(
  line: Pick<PurCountLine, 'state' | 'quantity'>,
  targetQty: number | null,
  eventQty = 0,
): 'enough' | 'low' | 'none' {
  if (line.state === 'enough') return 'enough'
  if (line.state === 'none') return 'none'
  if (line.state === 'low') return 'low'
  const q = line.quantity ?? 0
  if (q <= EPSILON) return 'none'
  const needed = (targetQty ?? 0) + eventQty
  return q + EPSILON >= needed ? 'enough' : 'low'
}

export type SuggestedLine = {
  item: PurItem
  countedQty: number | null
  countState: CountState | null
  targetQty: number | null
  eventQty: number
  eventNames: string[]
  inTransitQty: number
  /** En la unidad del insumo. `null` si es «a definir». */
  needQty: number | null
  /** En presentaciones. `null` = a definir (no tiene objetivo). */
  suggestedPacks: number | null
}

export function suggestLine(input: {
  item: PurItem
  line: Pick<PurCountLine, 'state' | 'quantity'> | undefined
  need: EventNeed | undefined
  inTransitQty: number
  lowFraction: number
}): SuggestedLine | null {
  const { item, line, need } = input
  const eventQty = need?.qty ?? 0
  const inTransit = Math.max(0, input.inTransitQty)
  const base = {
    item,
    countState: line?.state ?? null,
    targetQty: item.targetQty,
    eventQty,
    eventNames: need?.events ?? [],
    inTransitQty: inTransit,
  }

  if (!line) {
    if (eventQty <= EPSILON) return null
    const needQty = roundQty(eventQty - inTransit)
    if (needQty <= EPSILON) return null
    return {
      ...base,
      countedQty: null,
      needQty,
      suggestedPacks: packsFor(needQty, item.packSize, item.unit),
    }
  }

  const counted = countedQty(line, item.targetQty, input.lowFraction)

  if (item.targetQty == null && eventQty <= EPSILON) {
    // Sin objetivo no hay cuenta posible: si falta, lo decide quien compra.
    if (line.state === 'none' || line.state === 'low') {
      return { ...base, countedQty: counted, needQty: null, suggestedPacks: null }
    }
    return null
  }

  const needQty = roundQty((item.targetQty ?? 0) + eventQty - (counted ?? 0) - inTransit)
  if (needQty <= EPSILON) return null
  return {
    ...base,
    countedQty: counted,
    needQty,
    suggestedPacks: packsFor(needQty, item.packSize, item.unit),
  }
}

export type SuggestedOrder = {
  supplier: PurSupplier | null
  expectedDate: string | null
  lines: SuggestedLine[]
}

/** Ordena como se recorre la cocina: por zona y, adentro, por nombre. */
export function routeComparator(zones: readonly PurZone[]) {
  const rank = new Map(zones.map((z) => [z.id, z.sortOrder]))
  return (a: PurItem, b: PurItem) => {
    const ra = a.zoneId ? (rank.get(a.zoneId) ?? 1e6) : 1e7
    const rb = b.zoneId ? (rank.get(b.zoneId) ?? 1e6) : 1e7
    return ra - rb || a.name.localeCompare(b.name, 'es')
  }
}

export function buildSuggestion(input: {
  items: readonly PurItem[]
  lines: ReadonlyMap<string, Pick<PurCountLine, 'state' | 'quantity'>>
  needs: ReadonlyMap<string, EventNeed>
  inTransit: ReadonlyMap<string, number>
  suppliers: readonly PurSupplier[]
  zones: readonly PurZone[]
  lowFraction: number
  today: string
}): SuggestedOrder[] {
  const suppliers = new Map(input.suppliers.map((s) => [s.id, s]))
  const byRoute = routeComparator(input.zones)
  const groups = new Map<string, SuggestedLine[]>()

  for (const item of [...input.items].sort(byRoute)) {
    const line = suggestLine({
      item,
      line: input.lines.get(item.id),
      need: input.needs.get(item.id),
      inTransitQty: input.inTransit.get(item.id) ?? 0,
      lowFraction: input.lowFraction,
    })
    if (!line) continue
    const key = item.supplierId && suppliers.has(item.supplierId) ? item.supplierId : ''
    const list = groups.get(key) ?? []
    list.push(line)
    groups.set(key, list)
  }

  const orders: SuggestedOrder[] = []
  for (const [key, lines] of groups) {
    const supplier = key ? (suppliers.get(key) ?? null) : null
    orders.push({
      supplier,
      expectedDate: supplier
        ? nextDeliveryDate(input.today, supplier.deliveryWeekdays, supplier.leadDays)
        : null,
      lines,
    })
  }
  // Por proveedor, en orden alfabético; lo que no tiene proveedor, al final.
  return orders.sort((a, b) => {
    if (!a.supplier) return 1
    if (!b.supplier) return -1
    return a.supplier.name.localeCompare(b.supplier.name, 'es')
  })
}

/** Lo que va a la RPC `pur_submit_count`. */
export function toSubmitPayload(orders: readonly SuggestedOrder[]) {
  return orders.map((o) => ({
    supplier_id: o.supplier?.id ?? null,
    expected_date: o.expectedDate,
    lines: o.lines.map((l) => ({
      item_id: l.item.id,
      name: l.item.name,
      unit: l.item.unit,
      pack_label: l.item.packLabel,
      pack_size: l.item.packSize,
      counted_qty: l.countedQty,
      count_state: l.countState,
      target_qty: l.targetQty,
      event_qty: l.eventQty,
      event_names: l.eventNames,
      in_transit_qty: l.inTransitQty,
      suggested_packs: l.suggestedPacks,
      ordered_packs: l.suggestedPacks,
    })),
  }))
}

export type ZoneStock = {
  zoneId: string | null
  enough: number
  low: number
  none: number
  pending: number
}

/** El resumen de la cocina: cómo quedó cada zona y qué falta contar. */
export function countSummary(input: {
  items: readonly PurItem[]
  lines: ReadonlyMap<string, Pick<PurCountLine, 'state' | 'quantity'>>
  needs: ReadonlyMap<string, EventNeed>
}) {
  const zones = new Map<string, ZoneStock>()
  let counted = 0
  let none = 0
  const pending: PurItem[] = []
  for (const item of input.items) {
    const key = item.zoneId ?? ''
    const z = zones.get(key) ?? { zoneId: item.zoneId, enough: 0, low: 0, none: 0, pending: 0 }
    const line = input.lines.get(item.id)
    if (!line) {
      z.pending += 1
      pending.push(item)
    } else {
      counted += 1
      const level = stockLevel(line, item.targetQty, input.needs.get(item.id)?.qty ?? 0)
      z[level] += 1
      if (level === 'none') none += 1
    }
    zones.set(key, z)
  }
  return { counted, none, pending, zones }
}
