/**
 * La caja — PURO y testeado.
 *
 * Los números del turno a partir de la lista de cobros y movimientos (los
 * mismos que arma `private.pos_shift_summary` en la base), el conteo billete
 * por billete, y la parte que ninguna caja registradora hace: cuando el arqueo
 * no cierra, proponer QUÉ pudo haber pasado mirando lo que se cargó esa noche.
 *
 * Regla del efectivo que tiene que haber:
 *   cambio inicial + cobros en efectivo + ingresos − retiros.
 * El vuelto ya está descontado (el monto de un cobro es lo que quedó) y la
 * propina no entra: va aparte. Nunca cuentan los cobros anulados.
 */
import { formatCentsShort } from '@/lib/money'
import {
  type CountBreakdown,
  METHOD_LABEL,
  type MethodTotal,
  PAY_METHODS,
  type PayMethod,
} from './types'

const PESO = 100

/** Lo que hace falta de un cobro para las cuentas de la caja. */
export type ShiftPayment = {
  id: string
  method: PayMethod
  amount_cents: number
  surcharge_cents: number
  tip_cents: number
  change_cents: number
  invoice: boolean
  status: 'ok' | 'voided'
  table_label?: string | null
}

/** Lo que hace falta de un movimiento de caja. */
export type ShiftMovement = {
  id: string
  kind: 'in' | 'out'
  amount_cents: number
  reason: string
  voided_at: string | null
}

export type LiveTotals = {
  by_method: MethodTotal[]
  payments_count: number
  sales_cents: number
  surcharge_cents: number
  tip_cents: number
  collected_cents: number
  invoiced_cents: number
  not_invoiced_cents: number
  cash_sales_cents: number
  cash_tips_cents: number
  cash_in_cents: number
  cash_out_cents: number
  expected_cash_cents: number
}

/** Cuánto entró por cada medio y cuánto efectivo tiene que haber, ahora. */
export function liveTotals(
  payments: ReadonlyArray<ShiftPayment>,
  movements: ReadonlyArray<ShiftMovement>,
  openingFloatCents: number,
): LiveTotals {
  const rows = new Map<PayMethod, MethodTotal>()
  let invoiced = 0
  for (const payment of payments) {
    if (payment.status !== 'ok') continue
    const row = rows.get(payment.method) ?? {
      method: payment.method,
      count: 0,
      amount_cents: 0,
      surcharge_cents: 0,
      tip_cents: 0,
      total_cents: 0,
    }
    row.count += 1
    row.amount_cents += payment.amount_cents
    row.surcharge_cents += payment.surcharge_cents
    row.tip_cents += payment.tip_cents
    row.total_cents += payment.amount_cents + payment.surcharge_cents + payment.tip_cents
    rows.set(payment.method, row)
    if (payment.invoice) invoiced += payment.amount_cents + payment.surcharge_cents
  }
  const byMethod = PAY_METHODS.flatMap((method) => {
    const row = rows.get(method)
    return row ? [row] : []
  })

  let cashIn = 0
  let cashOut = 0
  for (const movement of movements) {
    if (movement.voided_at) continue
    if (movement.kind === 'in') cashIn += movement.amount_cents
    else cashOut += movement.amount_cents
  }

  const sum = (pick: (row: MethodTotal) => number) =>
    byMethod.reduce((total, row) => total + pick(row), 0)
  const sales = sum((row) => row.amount_cents)
  const surcharge = sum((row) => row.surcharge_cents)
  const tips = sum((row) => row.tip_cents)
  const cash = rows.get('cash')
  const cashSales = cash?.amount_cents ?? 0

  return {
    by_method: byMethod,
    payments_count: sum((row) => row.count),
    sales_cents: sales,
    surcharge_cents: surcharge,
    tip_cents: tips,
    collected_cents: sales + surcharge + tips,
    invoiced_cents: invoiced,
    not_invoiced_cents: sales + surcharge - invoiced,
    cash_sales_cents: cashSales,
    cash_tips_cents: cash?.tip_cents ?? 0,
    cash_in_cents: cashIn,
    cash_out_cents: cashOut,
    expected_cash_cents: openingFloatCents + cashSales + cashIn - cashOut,
  }
}

/** El efectivo que tiene que haber en el cajón. */
export function expectedCash(
  openingFloatCents: number,
  payments: ReadonlyArray<ShiftPayment>,
  movements: ReadonlyArray<ShiftMovement>,
): number {
  return liveTotals(payments, movements, openingFloatCents).expected_cash_cents
}

/** Un conteo en blanco con los billetes del bar, de mayor a menor. */
export function emptyCount(denominations: ReadonlyArray<number>): CountBreakdown {
  const bills = [...new Set(denominations)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => b - a)
    .map((value) => ({ value, count: 0 }))
  return { bills, other_cents: 0 }
}

/** Lo contado, en centavos. La base exige que este número sea el que se manda al cerrar. */
export function countTotal(breakdown: CountBreakdown): number {
  const bills = breakdown.bills.reduce(
    (total, bill) => total + Math.max(0, bill.value) * PESO * Math.max(0, Math.floor(bill.count)),
    0,
  )
  return bills + Math.max(0, breakdown.other_cents ?? 0)
}

export type MistakeKind =
  /** Un cobro cargado con el medio equivocado. */
  | 'method_mixup'
  /** Un retiro o un ingreso anotado que no pasó (o no pasó por ese monto). */
  | 'movement_not_real'
  /** Un cobro en efectivo anulado, pero la plata quedó. */
  | 'voided_cash_kept'
  /** Las propinas en efectivo quedaron en el cajón. */
  | 'cash_tips_in_drawer'
  /** Las propinas de tarjeta se pagaron del cajón sin anotar el retiro. */
  | 'card_tips_paid_out'
  /** Un vuelto que no se entregó. */
  | 'change_not_given'
  /** Un billete contado de más o de menos. */
  | 'bill_miscount'
  /** Un monto con un cero de más o de menos. */
  | 'missing_zero'
  /** Un monto con dos cifras cambiadas de lugar. */
  | 'transposed'
  /** Plata que entró o salió y nadie anotó. */
  | 'unrecorded_movement'
  /** Menos que el billete más chico. */
  | 'rounding'

export type ProbableMistake = {
  kind: MistakeKind
  /** De 0 a 100: qué tan bien explica la diferencia. La lista viene ordenada por esto. */
  score: number
  /** Una pregunta que se pueda contestar mirando el cajón. */
  message: string
  paymentId?: string
  movementId?: string
}

const NON_CASH_NOUN: Readonly<Record<Exclude<PayMethod, 'cash'>, string>> = {
  transfer: 'una transferencia',
  qr: 'un cobro con QR',
  debit: 'un cobro con débito',
  credit: 'un cobro con crédito',
  other: 'un cobro con otro medio',
}

function tableOf(payment: ShiftPayment): string {
  return payment.table_label ? ` (mesa ${payment.table_label})` : ''
}

/** `4500` y `5400`: los mismos dígitos con dos vecinos cambiados de lugar. */
export function isTransposition(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0) return false
  const x = String(a)
  const y = String(b)
  if (x.length !== y.length) return false
  const diff: number[] = []
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) diff.push(i)
  }
  if (diff.length !== 2) return false
  const [i, j] = diff as [number, number]
  return j === i + 1 && x[i] === y[j] && x[j] === y[i]
}

/**
 * Cuando lo contado no coincide con lo que tenía que haber: qué pudo haber
 * pasado, de lo más probable a lo menos. `differenceCents` = contado − esperado
 * (positivo sobra, negativo falta). `denominations` en pesos.
 *
 * No acusa a nadie ni corrige nada: propone preguntas («Hay una transferencia
 * de $ 12.000 justos: ¿era efectivo?») para que quien cierra mire primero donde
 * más probablemente está el error.
 */
export function probableMistakes(
  differenceCents: number,
  payments: ReadonlyArray<ShiftPayment>,
  movements: ReadonlyArray<ShiftMovement>,
  denominations: ReadonlyArray<number>,
  limit = 5,
): ProbableMistake[] {
  if (!Number.isFinite(differenceCents) || differenceCents === 0) return []
  const surplus = differenceCents > 0
  const abs = Math.abs(differenceCents)
  const money = formatCentsShort(abs)
  const out: ProbableMistake[] = []
  const live = payments.filter((payment) => payment.status === 'ok')
  const liveMovements = movements.filter((movement) => !movement.voided_at)

  // 1. Un cobro por ese monto exacto con el medio cruzado: lo más común de todo.
  for (const payment of live) {
    if (payment.amount_cents !== abs) continue
    if (surplus && payment.method !== 'cash') {
      out.push({
        kind: 'method_mixup',
        score: 100,
        message: `Hay ${NON_CASH_NOUN[payment.method]} de ${money} justos${tableOf(payment)}: ¿era efectivo?`,
        paymentId: payment.id,
      })
    }
    if (!surplus && payment.method === 'cash') {
      out.push({
        kind: 'method_mixup',
        score: 100,
        message: `Hay un cobro en efectivo de ${money} justos${tableOf(payment)}: ¿era transferencia o tarjeta?`,
        paymentId: payment.id,
      })
    }
  }

  // 2. Un movimiento por ese monto que se anotó y no pasó.
  for (const movement of liveMovements) {
    if (movement.amount_cents !== abs) continue
    if (surplus && movement.kind === 'out') {
      out.push({
        kind: 'movement_not_real',
        score: 90,
        message: `Hay un retiro de ${money} («${movement.reason}»): ¿salió de verdad esa plata?`,
        movementId: movement.id,
      })
    }
    if (!surplus && movement.kind === 'in') {
      out.push({
        kind: 'movement_not_real',
        score: 90,
        message: `Hay un ingreso de ${money} («${movement.reason}»): ¿entró de verdad esa plata?`,
        movementId: movement.id,
      })
    }
  }

  if (surplus) {
    // 3. Un cobro en efectivo anulado cuya plata nadie devolvió.
    for (const payment of payments) {
      if (
        payment.status === 'voided' &&
        payment.method === 'cash' &&
        payment.amount_cents === abs
      ) {
        out.push({
          kind: 'voided_cash_kept',
          score: 85,
          message: `Se anuló un cobro en efectivo de ${money}${tableOf(payment)}: ¿la plata quedó en el cajón?`,
          paymentId: payment.id,
        })
      }
    }
    // 4. Las propinas en efectivo, que van aparte, quedaron adentro.
    const cashTips = live
      .filter((payment) => payment.method === 'cash')
      .reduce((total, payment) => total + payment.tip_cents, 0)
    if (cashTips > 0 && cashTips === abs) {
      out.push({
        kind: 'cash_tips_in_drawer',
        score: 80,
        message: `Sobra justo lo que hay de propinas en efectivo (${money}): ¿quedaron en el cajón?`,
      })
    }
    // 5. Un vuelto que no se dio.
    for (const payment of live) {
      if (payment.method === 'cash' && payment.change_cents > 0 && payment.change_cents === abs) {
        out.push({
          kind: 'change_not_given',
          score: 70,
          message: `El vuelto${tableOf(payment)} era de ${money}: ¿se entregó?`,
          paymentId: payment.id,
        })
      }
    }
  } else {
    // 3'. Las propinas de tarjeta se le pagaron al equipo con plata del cajón.
    const cardTips = live
      .filter((payment) => payment.method !== 'cash')
      .reduce((total, payment) => total + payment.tip_cents, 0)
    if (cardTips > 0 && cardTips === abs) {
      out.push({
        kind: 'card_tips_paid_out',
        score: 85,
        message: `Falta justo lo que hay de propinas con tarjeta y transferencia (${money}): ¿se pagaron del cajón sin anotar el retiro?`,
      })
    }
  }

  // 6. Un billete contado de más o de menos (hasta tres del mismo).
  const bills = [...new Set(denominations)]
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => b - a)
  for (const value of bills) {
    const bill = value * PESO
    const count = abs / bill
    if (!Number.isInteger(count) || count < 1 || count > 3) continue
    const what =
      count === 1
        ? `un billete de ${formatCentsShort(bill)}`
        : `${count} billetes de ${formatCentsShort(bill)}`
    out.push({
      kind: 'bill_miscount',
      score: count === 1 ? 75 : 55,
      message: `Es justo ${what}: ¿se ${count === 1 ? 'contó' : 'contaron'} de ${surplus ? 'más' : 'menos'}?`,
    })
    break
  }

  // 7. Un monto mal tipeado: un cero de más o de menos, o dos cifras cambiadas de lugar. El monto
  //    «de verdad» que explicaría la diferencia sale de despejarla: un retiro de más resta, un
  //    ingreso o un cobro en efectivo de más suma.
  type Typed = {
    cents: number
    real: number
    label: string
    paymentId?: string
    movementId?: string
  }
  const typed: Typed[] = []
  for (const movement of liveMovements) {
    typed.push({
      cents: movement.amount_cents,
      real:
        movement.kind === 'out'
          ? movement.amount_cents - differenceCents
          : movement.amount_cents + differenceCents,
      label: `${movement.kind === 'out' ? 'el retiro' : 'el ingreso'} de ${formatCentsShort(movement.amount_cents)} («${movement.reason}»)`,
      movementId: movement.id,
    })
  }
  for (const payment of live) {
    if (payment.method !== 'cash') continue
    typed.push({
      cents: payment.amount_cents,
      real: payment.amount_cents + differenceCents,
      label: `el cobro en efectivo de ${formatCentsShort(payment.amount_cents)}${tableOf(payment)}`,
      paymentId: payment.id,
    })
  }
  // Con un sospechoso concreto no hace falta el aviso general del múltiplo de 9.
  let concrete = false
  for (const item of typed) {
    if (item.real <= 0) continue
    const ref = { paymentId: item.paymentId, movementId: item.movementId }
    if (item.real === item.cents * 10) {
      concrete = true
      out.push({
        kind: 'missing_zero',
        score: 65,
        message: `¿${capitalize(item.label)} era de ${formatCentsShort(item.real)}? Con un cero más da justo la diferencia.`,
        ...ref,
      })
    } else if (item.real * 10 === item.cents) {
      concrete = true
      out.push({
        kind: 'missing_zero',
        score: 65,
        message: `¿${capitalize(item.label)} era de ${formatCentsShort(item.real)}? Con un cero menos da justo la diferencia.`,
        ...ref,
      })
    } else if (
      item.cents % PESO === 0 &&
      item.real % PESO === 0 &&
      isTransposition(item.cents / PESO, item.real / PESO)
    ) {
      concrete = true
      out.push({
        kind: 'transposed',
        score: 60,
        message: `¿${capitalize(item.label)} era de ${formatCentsShort(item.real)}? Son las mismas cifras con dos cambiadas de lugar.`,
        ...ref,
      })
    }
  }
  if (!concrete && abs % PESO === 0 && (abs / PESO) % 9 === 0) {
    out.push({
      kind: 'transposed',
      score: 35,
      message: `${money} es múltiplo de 9: suele ser un monto con dos cifras cambiadas de lugar (4.500 por 5.400). Revisá el conteo y los movimientos.`,
    })
  }

  // 8. Menos que el billete más chico: redondeo de vueltos.
  const smallest = bills.at(-1)
  if (smallest !== undefined && abs < smallest * PESO) {
    out.push({
      kind: 'rounding',
      score: 45,
      message: `Es menos que el billete más chico (${formatCentsShort(smallest * PESO)}): suele ser vuelto redondeado.`,
    })
  }

  // 9. Lo que nunca se puede descartar: plata que se movió y nadie anotó.
  out.push({
    kind: 'unrecorded_movement',
    score: 20,
    message: surplus
      ? '¿Entró plata que no se anotó? (cambio que trajo alguien, una seña en efectivo)'
      : '¿Se sacó plata para pagar algo y no se anotó el retiro?',
  })

  return out.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit))
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «Transferencia → Efectivo»: una corrección de medio, como se lee en el historial. */
export function methodChangeLabel(oldValue: string, newValue: string): string {
  const label = (value: string) => METHOD_LABEL[value as PayMethod] ?? value
  return `${label(oldValue)} → ${label(newValue)}`
}
