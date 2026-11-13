/**
 * La cuenta — PURO y testeado.
 *
 * Todo lo que la pantalla de cobro calcula antes de mandar un cobro: cuánto por
 * persona, cómo se divide, cuánto suma el recargo, cuánto vuelto. La base
 * vuelve a calcular lo que importa (el recargo, lo que falta) y es la que
 * manda; acá las fórmulas son LAS MISMAS que en `private.pos_bill` y `pos_pay`,
 * así lo que se ve antes de cobrar es lo que queda escrito después.
 *
 * Plata en centavos enteros. Todo lo que se cobra se redondea al peso (la mitad
 * hacia arriba): nadie cobra centavos.
 */
import type { BillNumbers, DiscountKind, InvoiceByMethod, PayMethod } from './types'

const PESO = 100

/** Al peso, la mitad hacia arriba (para montos que no son negativos). */
export function roundToPeso(cents: number): number {
  return Math.floor((cents + PESO / 2) / PESO) * PESO
}

/** Lo que le toca a cada uno si se reparte parejo. `null` si no se sabe cuántos son. */
export function perPerson(cents: number, people: number | null | undefined): number | null {
  if (!people || people < 1 || cents < 0) return null
  return roundToPeso(cents / people)
}

/**
 * Partes iguales en pesos enteros. Lo que no entra parejo se reparte de a un
 * peso entre las primeras partes, así la suma da EXACTO el total.
 * `splitEqual(10_000_000, 3)` → `[3_333_400, 3_333_300, 3_333_300]`.
 *
 * Si el total no alcanza para que todos pongan al menos un peso, devuelve menos
 * partes (una parte en cero no se puede cobrar).
 */
export function splitEqual(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1 || !Number.isFinite(totalCents) || totalCents <= 0) {
    return []
  }
  const pesos = Math.floor(totalCents / PESO)
  const loose = totalCents - pesos * PESO // centavos sueltos: casi nunca, pero la suma tiene que dar
  const base = Math.floor(pesos / parts)
  const extra = pesos % parts
  const out: number[] = []
  for (let i = 0; i < parts; i += 1) {
    const cents = (base + (i < extra ? 1 : 0)) * PESO + (i === 0 ? loose : 0)
    if (cents > 0) out.push(cents)
  }
  return out
}

/** «Parte 2 de 4»: el rótulo de un cobro cuando se divide en partes iguales. */
export function partLabel(index: number, parts: number): string {
  return `Parte ${index + 1} de ${parts}`
}

/** Un renglón de la cuenta, con lo que hace falta para dividir por producto. */
export type SplitLine = {
  id: string
  quantity: number
  line_total_cents: number
  paid_units: number
}

/** Qué se lleva cada uno: el renglón y cuántas unidades de ese renglón. */
export type ProductPick = { lineId: string; units: number }

/**
 * Los `item_ids` que viajan con un cobro por producto: el renglón repetido una
 * vez por unidad.
 */
export function picksToItemIds(picks: ReadonlyArray<ProductPick>): string[] {
  return picks.flatMap((pick) =>
    Array.from({ length: Math.max(0, Math.floor(pick.units)) }, () => pick.lineId),
  )
}

/**
 * Cuánto paga quien se hace cargo de esos productos.
 *
 * Sin descuentos ni seña es la suma de lo elegido. Si los hay, cada producto
 * carga su parte: paga la misma proporción de lo que quedó por cobrar que la que
 * sus productos pesan en el consumo (si no, el descuento de toda la mesa se lo
 * quedaría el último que paga). Quien se lleva todo lo que falta paga
 * exactamente lo que falta, sin restos de redondeo.
 */
export function byProductAmount(
  lines: ReadonlyArray<SplitLine>,
  picks: ReadonlyArray<ProductPick>,
  bill: Pick<BillNumbers, 'subtotal_cents' | 'due_cents' | 'remaining_cents'>,
): number {
  const byId = new Map(lines.map((line) => [line.id, line]))
  let picked = 0
  for (const pick of picks) {
    const line = byId.get(pick.lineId)
    if (!line || line.quantity < 1) continue
    const free = Math.max(0, line.quantity - line.paid_units)
    const units = Math.min(Math.max(0, Math.floor(pick.units)), free)
    picked += (line.line_total_cents * units) / line.quantity
  }
  if (picked <= 0 || bill.remaining_cents <= 0) return 0

  let unpaid = 0
  for (const line of lines) {
    if (line.quantity < 1) continue
    unpaid += (line.line_total_cents * Math.max(0, line.quantity - line.paid_units)) / line.quantity
  }
  // Se lleva todo lo que quedaba sin cobrar: paga justo lo que falta.
  if (picked >= unpaid) return bill.remaining_cents

  const share =
    bill.subtotal_cents > 0 && bill.due_cents !== bill.subtotal_cents
      ? (picked * bill.due_cents) / bill.subtotal_cents
      : picked
  return Math.min(roundToPeso(share), bill.remaining_cents)
}

/**
 * El recargo de crédito, solo sobre lo que se paga con crédito. `bp` en puntos
 * básicos (1000 = 10 %). Misma cuenta que la base, en enteros:
 * `((monto × bp + 500000) / 1000000) × 100`.
 */
export function creditSurcharge(amountCents: number, bp: number): number {
  if (amountCents <= 0 || bp <= 0) return 0
  return Math.floor((amountCents * bp + 500_000) / 1_000_000) * PESO
}

/** Lo que se le va a cobrar por ese medio, para mostrarlo ANTES de cobrar. */
export function chargePreview(input: {
  amountCents: number
  method: PayMethod
  surchargeBp: number
  tipCents?: number
}): { surchargeCents: number; tipCents: number; totalCents: number } {
  const surchargeCents =
    input.method === 'credit' ? creditSurcharge(input.amountCents, input.surchargeBp) : 0
  const tipCents = Math.max(0, input.tipCents ?? 0)
  return { surchargeCents, tipCents, totalCents: input.amountCents + surchargeCents + tipCents }
}

/** La propina de un botón de porcentaje, al peso. */
export function tipFromPct(amountCents: number, pct: number): number {
  if (amountCents <= 0 || pct <= 0) return 0
  return roundToPeso((amountCents * pct) / 100)
}

/**
 * El vuelto: lo que entregó menos el monto y la propina. `null` si lo que
 * entregó no alcanza (la pantalla no deja cobrar).
 */
export function cashChange(
  tenderedCents: number,
  amountCents: number,
  tipCents = 0,
): number | null {
  const change = tenderedCents - amountCents - tipCents
  return change < 0 ? null : change
}

/**
 * «Paga con…»: justo, y después el próximo monto redondo que se arma con cada
 * billete del bar, de los billetes grandes a los chicos (es con lo que la gente
 * paga). Un billete que no llega al 5 % del total no redondea nada que alguien
 * vaya a entregar (nadie paga $ 17.600 una cuenta de $ 17.500), salvo los dos
 * más grandes, que siempre se ofrecen.
 *
 * `denominations` en pesos; devuelve centavos, de menor a mayor.
 * `tenderSuggestions(1_750_000, [20000, 10000, 2000, 1000, 500, 200, 100])` →
 * `[1_750_000, 1_800_000, 2_000_000]`.
 */
export function tenderSuggestions(
  totalCents: number,
  denominations: ReadonlyArray<number>,
  max = 5,
): number[] {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return []
  const found = new Set<number>([totalCents])
  const bills = [...new Set(denominations)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)
  bills.forEach((value, index) => {
    if (found.size >= max) return
    const bill = value * PESO
    if (index >= 2 && bill < totalCents / 20) return
    found.add(Math.ceil(totalCents / bill) * bill)
  })
  return [...found].sort((a, b) => a - b)
}

/** Si ese medio se factura cuando nadie dijo nada. El efectivo y «otro», no. */
export function defaultInvoice(method: PayMethod, byMethod: InvoiceByMethod | null): boolean {
  return byMethod?.[method] ?? (method !== 'cash' && method !== 'other')
}

/** «10» o «12,5» (por ciento) → puntos básicos, que es como viaja y se guarda. */
export function percentToBp(percent: number): number {
  return Math.round(percent * 100)
}

/** Cuánto baja un descuento sobre ese consumo. Porcentaje en puntos básicos, monto en centavos. */
export function discountAmount(subtotalCents: number, kind: DiscountKind, value: number): number {
  if (kind === 'amount') return value
  return Math.floor((subtotalCents * value + 500_000) / 1_000_000) * PESO
}

/**
 * La cuenta entera, igual que `private.pos_bill`: para mostrar cómo queda con un
 * descuento antes de pedirlo, o para no esperar la vuelta después de un cobro.
 *
 * `depositAvailableCents`: lo que la reserva tiene de seña sin usar (0 si no hay
 * reserva o la mesa es de práctica).
 */
export function computeBill(input: {
  subtotalCents: number
  discounts: ReadonlyArray<{ kind: DiscountKind; value: number }>
  depositAvailableCents: number
  payments: ReadonlyArray<{
    amount_cents: number
    surcharge_cents: number
    tip_cents: number
    status: 'ok' | 'voided'
  }>
}): BillNumbers {
  const subtotal = Math.max(0, input.subtotalCents)
  let percentBp = 0
  let amountOff = 0
  for (const discount of input.discounts) {
    if (discount.kind === 'percent') percentBp += discount.value
    else amountOff += discount.value
  }
  const discount = Math.min(
    subtotal,
    discountAmount(subtotal, 'percent', Math.min(percentBp, 10_000)) + amountOff,
  )
  const net = subtotal - discount
  const deposit = Math.min(Math.max(0, input.depositAvailableCents), net)
  const due = net - deposit

  let paid = 0
  let surcharge = 0
  let tip = 0
  for (const payment of input.payments) {
    if (payment.status !== 'ok') continue
    paid += payment.amount_cents
    surcharge += payment.surcharge_cents
    tip += payment.tip_cents
  }
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    deposit_cents: deposit,
    due_cents: due,
    paid_cents: paid,
    remaining_cents: Math.max(due - paid, 0),
    overpaid_cents: Math.max(paid - due, 0),
    surcharge_cents: surcharge,
    tip_cents: tip,
  }
}
