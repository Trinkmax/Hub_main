/**
 * Lo que salió sin venderse en un día — PURO.
 *
 * Se arma con lo que el salón ya cargó: las cuentas cerradas, sus descuentos y los renglones de las
 * comandas. Separa tres cosas que no son lo mismo:
 *
 *   · **Salió y no se vendió**: una mesa que no se cobró (consumo de socios, invitación) y la baja de
 *     algo que ya estaba hecho. Son productos que dejaron la cocina o la barra. Se valúan al precio
 *     de la carta.
 *   · **No llegó a salir**: la baja de algo que todavía no se había hecho. No se perdió nada.
 *   · **Descuentos**: plata que se dejó de cobrar en una mesa que sí pagó. No son productos.
 */
import { readVoidReason, reasonGroup } from './reasons'

export type UnsoldBill = {
  sessionId: string
  branchId: string
  tableLabel: string | null
  subtotalCents: number
  discountCents: number
  depositCents: number
  dueCents: number
  closedAt: string
}

export type UnsoldDiscount = {
  id: string
  sessionId: string
  kind: 'percent' | 'amount'
  /** Porcentaje en puntos básicos (1000 = 10 %) o monto en centavos. */
  value: number
  reason: string
  byName: string | null
  approvedByName: string | null
  createdAt: string
}

export type UnsoldLine = {
  sessionId: string
  branchId: string
  tableLabel: string | null
  name: string
  quantity: number
  totalCents: number
  cancelledAt: string | null
  cancellationReason: string | null
  /** La cocina ya lo había empezado cuando se dio de baja. */
  started: boolean
}

export type UnsoldKind = 'comp' | 'void_made' | 'void_not_made' | 'discount'

export type UnsoldItem = { name: string; quantity: number; cents: number }

export type UnsoldEntry = {
  key: string
  kind: UnsoldKind
  /** El motivo como se muestra («Consumo de socios · Nacho», «Mal comandado»). */
  reason: string
  /** El motivo para agrupar («Consumo de socios»). */
  group: string
  cents: number
  /** Unidades de producto (0 en un descuento). */
  units: number
  at: string
  branchId: string
  tableLabel: string | null
  byName: string | null
  /** Qué productos fueron (en una mesa que no se cobró, todos; en una baja, el suyo). */
  items: UnsoldItem[]
}

export type UnsoldReason = { reason: string; cents: number; units: number; count: number }

export type UnsoldReport = {
  /** Lo que salió sin venderse: mesas que no se cobraron + bajas de algo ya hecho. */
  leftCents: number
  leftUnits: number
  leftByReason: UnsoldReason[]
  /** Bajas de algo que no llegó a hacerse. */
  notMadeCents: number
  notMadeLines: number
  /** Descuentos de mesas que sí pagaron. */
  discountCents: number
  discountByReason: UnsoldReason[]
  /** Todo, de lo más nuevo a lo más viejo. */
  entries: UnsoldEntry[]
}

/** Lo que vale un descuento sobre una cuenta: igual que la base (el porcentaje, redondeado al peso). */
export function discountAmountCents(
  discount: Pick<UnsoldDiscount, 'kind' | 'value'>,
  subtotalCents: number,
): number {
  if (discount.kind === 'amount') return discount.value
  return Math.floor((subtotalCents * Math.min(discount.value, 10_000) + 500_000) / 1_000_000) * 100
}

/**
 * Una mesa que cerró sin que entrara plata: ni cobros, ni seña, y la bonificación cubrió todo el
 * consumo. Todo lo que consumió salió sin venderse.
 */
export function isComp(
  bill: Pick<UnsoldBill, 'subtotalCents' | 'discountCents' | 'depositCents' | 'dueCents'>,
): boolean {
  return (
    bill.subtotalCents > 0 &&
    bill.dueCents === 0 &&
    bill.depositCents === 0 &&
    bill.discountCents >= bill.subtotalCents
  )
}

/** Lo mismo, con los números de una cuenta como los devuelve la base. */
export function billNotCharged(numbers: {
  subtotal_cents: number
  discount_cents: number
  deposit_cents: number
  due_cents: number
}): boolean {
  return isComp({
    subtotalCents: numbers.subtotal_cents,
    discountCents: numbers.discount_cents,
    depositCents: numbers.deposit_cents,
    dueCents: numbers.due_cents,
  })
}

function addTo(map: Map<string, UnsoldReason>, entry: UnsoldEntry): void {
  const row = map.get(entry.group) ?? { reason: entry.group, cents: 0, units: 0, count: 0 }
  row.cents += entry.cents
  row.units += entry.units
  row.count += 1
  map.set(entry.group, row)
}

function sorted(map: Map<string, UnsoldReason>): UnsoldReason[] {
  return [...map.values()].sort(
    (a, b) => b.cents - a.cents || a.reason.localeCompare(b.reason, 'es'),
  )
}

function mergeItems(lines: readonly UnsoldLine[]): UnsoldItem[] {
  const byName = new Map<string, UnsoldItem>()
  for (const line of lines) {
    const item = byName.get(line.name) ?? { name: line.name, quantity: 0, cents: 0 }
    item.quantity += line.quantity
    item.cents += line.totalCents
    byName.set(line.name, item)
  }
  return [...byName.values()].sort(
    (a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'es'),
  )
}

export function buildUnsold(input: {
  bills: readonly UnsoldBill[]
  discounts: readonly UnsoldDiscount[]
  lines: readonly UnsoldLine[]
}): UnsoldReport {
  const entries: UnsoldEntry[] = []
  const discountsBySession = new Map<string, UnsoldDiscount[]>()
  for (const discount of input.discounts) {
    const list = discountsBySession.get(discount.sessionId) ?? []
    list.push(discount)
    discountsBySession.set(discount.sessionId, list)
  }
  const liveBySession = new Map<string, UnsoldLine[]>()
  for (const line of input.lines) {
    if (line.cancelledAt !== null) continue
    const list = liveBySession.get(line.sessionId) ?? []
    list.push(line)
    liveBySession.set(line.sessionId, list)
  }

  for (const bill of input.bills) {
    const discounts = (discountsBySession.get(bill.sessionId) ?? [])
      .map((discount) => ({
        discount,
        cents: discountAmountCents(discount, bill.subtotalCents),
      }))
      .sort((a, b) => b.cents - a.cents || a.discount.createdAt.localeCompare(b.discount.createdAt))
    if (discounts.length === 0) continue

    if (isComp(bill)) {
      // El motivo de la mesa es el del descuento que más pesó (el que la dejó en cero).
      const main = discounts[0]?.discount
      if (!main) continue
      const live = liveBySession.get(bill.sessionId) ?? []
      entries.push({
        key: `comp-${bill.sessionId}`,
        kind: 'comp',
        reason: main.reason.trim(),
        group: reasonGroup(main.reason),
        cents: bill.subtotalCents,
        units: live.reduce((sum, line) => sum + line.quantity, 0),
        at: bill.closedAt,
        branchId: bill.branchId,
        tableLabel: bill.tableLabel,
        byName: main.approvedByName ?? main.byName,
        items: mergeItems(live),
      })
      continue
    }

    // Una mesa que pagó: cada descuento cuenta lo suyo, sin pasar de lo que la cuenta descontó.
    let left = bill.discountCents
    for (const { discount, cents } of discounts) {
      const amount = Math.max(0, Math.min(cents, left))
      left -= amount
      if (amount === 0) continue
      entries.push({
        key: `desc-${discount.id}`,
        kind: 'discount',
        reason: discount.reason.trim(),
        group: reasonGroup(discount.reason),
        cents: amount,
        units: 0,
        at: discount.createdAt,
        branchId: bill.branchId,
        tableLabel: bill.tableLabel,
        byName: discount.approvedByName ?? discount.byName,
        items: [],
      })
    }
  }

  input.lines.forEach((line, index) => {
    if (line.cancelledAt === null) return
    const read = readVoidReason(line.cancellationReason, line.started)
    entries.push({
      key: `baja-${line.sessionId}-${index}`,
      kind: read.made ? 'void_made' : 'void_not_made',
      reason: read.label,
      group: read.label,
      cents: line.totalCents,
      units: line.quantity,
      at: line.cancelledAt,
      branchId: line.branchId,
      tableLabel: line.tableLabel,
      byName: null,
      items: [{ name: line.name, quantity: line.quantity, cents: line.totalCents }],
    })
  })

  entries.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))

  const left = new Map<string, UnsoldReason>()
  const discounts = new Map<string, UnsoldReason>()
  let leftCents = 0
  let leftUnits = 0
  let notMadeCents = 0
  let notMadeLines = 0
  let discountCents = 0
  for (const entry of entries) {
    if (entry.kind === 'comp' || entry.kind === 'void_made') {
      leftCents += entry.cents
      leftUnits += entry.units
      addTo(left, entry)
    } else if (entry.kind === 'void_not_made') {
      notMadeCents += entry.cents
      notMadeLines += 1
    } else {
      discountCents += entry.cents
      addTo(discounts, entry)
    }
  }

  return {
    leftCents,
    leftUnits,
    leftByReason: sorted(left),
    notMadeCents,
    notMadeLines,
    discountCents,
    discountByReason: sorted(discounts),
    entries,
  }
}

/** El informe de una sola sucursal (o de todas, con `null`). */
export function unsoldOfBranch(
  input: Parameters<typeof buildUnsold>[0],
  branchId: string | null,
): UnsoldReport {
  if (branchId === null) return buildUnsold(input)
  const bills = input.bills.filter((bill) => bill.branchId === branchId)
  const sessions = new Set(bills.map((bill) => bill.sessionId))
  return buildUnsold({
    bills,
    discounts: input.discounts.filter((discount) => sessions.has(discount.sessionId)),
    lines: input.lines.filter((line) => line.branchId === branchId),
  })
}
