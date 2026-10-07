/**
 * Vencimientos, antigüedad de saldos y semáforo (Sprint 1, F.7; kit §3.6
 * DueStatus y §3.8 AgingBar). Espejo de la SQL de `acc_report_party_balances`.
 *
 * Todo es civil (`'yyyy-MM-dd'`) y entero: los días se cuentan con
 * `daysBetween` de `@/lib/dates` (sin `Date`, sin zona). `S` = `due_soon_days`
 * del bar (7 por defecto).
 *
 * Tramos de la deuda abierta (F.7):
 *
 * | Tramo             | Regla                              |
 * |-------------------|------------------------------------|
 * | `no_due`          | sin vencimiento                    |
 * | `not_due`         | vence después de hoy + S           |
 * | `due_soon`        | vence entre hoy y hoy + S          |
 * | `overdue_1_30`    | vencida hace 1 a 30 días           |
 * | `overdue_31_60`   | vencida hace 31 a 60 días          |
 * | `overdue_60_plus` | vencida hace más de 60 días        |
 */

import { daysBetween } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import type { Cents, IsoDate } from './types'

export { daysBetween } from '@/lib/dates'

/** `due_soon_days` por defecto (`acc_settings.due_soon_days`). */
export const DEFAULT_SOON_DAYS = 7

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** «$ 120.000» si es redondo, «$ 1.240,50» si tiene centavos (como los textos de H.7). */
function moneyShort(cents: Cents): string {
  return formatCents(cents, { decimals: cents % 100 === 0 ? 0 : 2 })
}

// ─── Una partida (DueStatus del kit) ─────────────────────────────────────────

export type DueBucket = 'settled' | 'no-due' | 'current' | 'soon' | 'today' | 'overdue'

/**
 * Estado de una partida para `DueStatus`: pagada, sin vencimiento, al día,
 * vence pronto, vence hoy o vencida. Mismos cortes que los tramos de F.7
 * (`today` + `soon` = `due_soon`).
 */
export function dueBucket(
  due: IsoDate | null,
  today: IsoDate,
  soonDays: number = DEFAULT_SOON_DAYS,
  settled = false,
): DueBucket {
  if (settled) return 'settled'
  if (due === null) return 'no-due'
  const days = daysBetween(today, due)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= soonDays ? 'soon' : 'current'
}

/** Días hasta el vencimiento (negativo si ya venció); `null` sin vencimiento. */
export function daysUntilDue(due: IsoDate | null, today: IsoDate): number | null {
  return due === null ? null : daysBetween(today, due)
}

/**
 * El texto de `DueStatus` (siempre punto + palabras): «Vence hoy», «Vence en
 * 5 días», «Vencida hace 3 días», «Al día», «Sin vencimiento», «Pagada».
 * `group: 'receivables'` lo lee del lado de los cobros («Cobrada»).
 */
export function dueLabel(
  due: IsoDate | null,
  today: IsoDate,
  opts: { soonDays?: number; settled?: boolean; group?: 'payables' | 'receivables' } = {},
): string {
  const bucket = dueBucket(due, today, opts.soonDays ?? DEFAULT_SOON_DAYS, opts.settled ?? false)
  const days = daysUntilDue(due, today) ?? 0
  switch (bucket) {
    case 'settled':
      return opts.group === 'receivables' ? 'Cobrada' : 'Pagada'
    case 'no-due':
      return 'Sin vencimiento'
    case 'today':
      return 'Vence hoy'
    case 'soon':
      return `Vence en ${plural(days, 'día', 'días')}`
    case 'current':
      return 'Al día'
    case 'overdue':
      return `Vencida hace ${plural(-days, 'día', 'días')}`
  }
}

// ─── Tramos de antigüedad (F.7) ──────────────────────────────────────────────

export const AGING_TRAMOS = [
  'not_due',
  'due_soon',
  'overdue_1_30',
  'overdue_31_60',
  'overdue_60_plus',
  'no_due',
] as const
export type AgingTramo = (typeof AGING_TRAMOS)[number]

/** Las etiquetas de las columnas del CSV de saldos con antigüedad (F.7). */
export const AGING_TRAMO_LABELS: Readonly<Record<AgingTramo, string>> = {
  not_due: 'Al día',
  due_soon: 'Vence en 7 días',
  overdue_1_30: 'Vencido 1-30',
  overdue_31_60: 'Vencido 31-60',
  overdue_60_plus: 'Vencido +60',
  no_due: 'Sin vencimiento',
}

/** El tramo de una partida de deuda abierta al día `asOf`. */
export function agingTramo(
  dueDate: IsoDate | null,
  asOf: IsoDate,
  soonDays: number = DEFAULT_SOON_DAYS,
): AgingTramo {
  if (dueDate === null) return 'no_due'
  const overdue = daysBetween(dueDate, asOf)
  if (overdue <= 0) return -overdue <= soonDays ? 'due_soon' : 'not_due'
  if (overdue <= 30) return 'overdue_1_30'
  if (overdue <= 60) return 'overdue_31_60'
  return 'overdue_60_plus'
}

export type AgingItem = { dueDate: IsoDate | null; openCents: Cents }

export type AgingSummary = {
  totals: Record<AgingTramo, Cents>
  counts: Record<AgingTramo, number>
  /** Σ abierto de todas las partidas. */
  totalCents: Cents
  /** Σ de los tres tramos vencidos. */
  overdueCents: Cents
  /** El vencimiento más viejo entre las partidas vencidas. */
  oldestDueDate: IsoDate | null
  /** El próximo vencimiento (hoy o después). */
  nextDueDate: IsoDate | null
}

function emptyTramos(): Record<AgingTramo, number> {
  return {
    not_due: 0,
    due_soon: 0,
    overdue_1_30: 0,
    overdue_31_60: 0,
    overdue_60_plus: 0,
    no_due: 0,
  }
}

/** Las columnas de F.7 de un partícipe (partidas con abierto > 0). */
export function agingSummary(
  items: readonly AgingItem[],
  asOf: IsoDate,
  soonDays: number = DEFAULT_SOON_DAYS,
): AgingSummary {
  const totals = emptyTramos()
  const counts = emptyTramos()
  let totalCents = 0
  let oldestDueDate: IsoDate | null = null
  let nextDueDate: IsoDate | null = null
  for (const item of items) {
    if (item.openCents <= 0) continue
    const tramo = agingTramo(item.dueDate, asOf, soonDays)
    totals[tramo] += item.openCents
    counts[tramo] += 1
    totalCents += item.openCents
    if (item.dueDate !== null) {
      if (item.dueDate < asOf) {
        if (oldestDueDate === null || item.dueDate < oldestDueDate) oldestDueDate = item.dueDate
      } else if (nextDueDate === null || item.dueDate < nextDueDate) {
        nextDueDate = item.dueDate
      }
    }
  }
  return {
    totals,
    counts,
    totalCents,
    overdueCents: totals.overdue_1_30 + totals.overdue_31_60 + totals.overdue_60_plus,
    oldestDueDate,
    nextDueDate,
  }
}

/** Los cinco tramos de `AgingBar` (kit §3.8); las partidas sin vencimiento no van en la barra. */
export const AGING_BUCKETS = [
  'current',
  'soon',
  'overdue-1-30',
  'overdue-31-60',
  'overdue-60-plus',
] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

const TRAMO_TO_BUCKET: Readonly<Record<Exclude<AgingTramo, 'no_due'>, AgingBucket>> = {
  not_due: 'current',
  due_soon: 'soon',
  overdue_1_30: 'overdue-1-30',
  overdue_31_60: 'overdue-31-60',
  overdue_60_plus: 'overdue-60-plus',
}

/**
 * Lo que dibuja `AgingBar`: los cinco tramos en orden (con cero si no hay
 * nada), importe y cantidad de partidas. Lo sin vencimiento queda afuera de la
 * barra; para el total completo está `agingSummary`.
 */
export function agingBuckets(
  items: readonly AgingItem[],
  today: IsoDate,
  soonDays: number = DEFAULT_SOON_DAYS,
): Array<{ bucket: AgingBucket; cents: Cents; count: number }> {
  const summary = agingSummary(items, today, soonDays)
  return (Object.keys(TRAMO_TO_BUCKET) as Array<keyof typeof TRAMO_TO_BUCKET>).map((tramo) => ({
    bucket: TRAMO_TO_BUCKET[tramo],
    cents: summary.totals[tramo],
    count: summary.counts[tramo],
  }))
}

// ─── Semáforo de un partícipe (F.7) ──────────────────────────────────────────

export type TrafficLight = 'red' | 'yellow' | 'green' | 'none'

export type TrafficLightResult = {
  light: TrafficLight
  /** Punto + texto, nunca solo color. */
  text: string
  reason: 'overdue' | 'covered_by_credit' | 'due_soon' | 'current' | 'no_debt'
  /** Días de atraso (rojo) o hasta el próximo vencimiento (amarillo). */
  days: number | null
}

export type TrafficLightInput = {
  /** Partidas de deuda abiertas (Haber en pagables, Debe en cobrables). */
  items: readonly AgingItem[]
  /** Σ abierto del lado contrario: NC, anticipos, pagos a cuenta, «le debemos». */
  creditCents: Cents
  asOf: IsoDate
  soonDays?: number
  /** Las cobrables se leen al revés: «está atrasada», «se acredita». */
  group?: 'payables' | 'receivables'
  /** Para «PedidosYa está atrasada 5 días». */
  partyName?: string
}

/**
 * - `red`: hay algo vencido que el saldo a favor no cubre → «Vencida hace N
 *   días» (la más vieja).
 * - `yellow`: nada vencido sin cubrir y algo vence en S días → «Vence en N
 *   días» / «Vence hoy»; o lo vencido queda cubierto por un saldo a favor sin
 *   aplicar → «Tenés $ X a favor sin aplicar».
 * - `green`: hay deuda y nada vence en S días → «Al día».
 * - `none`: sin deuda → «Sin deuda» (+ «A favor $ X» si corresponde).
 */
export function trafficLight(input: TrafficLightInput): TrafficLightResult {
  const soonDays = input.soonDays ?? DEFAULT_SOON_DAYS
  const receivables = input.group === 'receivables'
  const summary = agingSummary(input.items, input.asOf, soonDays)
  const credit = Math.max(0, input.creditCents)

  if (summary.totalCents <= 0) {
    const favor = credit > 0 ? ` · A favor ${moneyShort(credit)}` : ''
    return { light: 'none', text: `Sin deuda${favor}`, reason: 'no_debt', days: null }
  }

  if (summary.overdueCents > 0) {
    if (summary.overdueCents > credit) {
      const days = summary.oldestDueDate ? daysBetween(summary.oldestDueDate, input.asOf) : 0
      const late = plural(days, 'día', 'días')
      const text = receivables
        ? input.partyName
          ? `${input.partyName} está atrasada ${late}`
          : `Atrasada ${late}`
        : `Vencida hace ${late}`
      return { light: 'red', text, reason: 'overdue', days }
    }
    const favorText = moneyShort(credit)
    return {
      light: 'yellow',
      text: receivables
        ? `Hay ${favorText} a favor sin aplicar`
        : `Tenés ${favorText} a favor sin aplicar`,
      reason: 'covered_by_credit',
      days: null,
    }
  }

  if (summary.totals.due_soon > 0 && summary.nextDueDate !== null) {
    const days = daysBetween(input.asOf, summary.nextDueDate)
    const text =
      days === 0
        ? receivables
          ? 'Se acredita hoy'
          : 'Vence hoy'
        : receivables
          ? `Se acredita en ${plural(days, 'día', 'días')}`
          : `Vence en ${plural(days, 'día', 'días')}`
    return { light: 'yellow', text, reason: 'due_soon', days }
  }

  return { light: 'green', text: 'Al día', reason: 'current', days: null }
}

// ─── Abierto de una partida «al día X» (acc_open_amount) ─────────────────────

export type AllocationSpan = {
  amountCents: Cents
  /** Desde cuándo cuenta la imputación. */
  appliedOn: IsoDate
  /** Desaplicada desde (no se borra): vale en `[appliedOn, voidedOn)`. */
  voidedOn: IsoDate | null
}

/**
 * Espejo de `public.acc_open_amount`: importe − Σ imputaciones vigentes al día
 * `asOf`. Una imputación vale en `[applied_on, voided_on)`, así el estado de
 * cuenta de un mes cerrado da siempre lo mismo aunque después se desaplique un
 * pago. Sin `asOf` (hoy): cuentan las que no están desaplicadas.
 */
export function openAmountAsOf(
  amountCents: Cents,
  allocations: readonly AllocationSpan[],
  asOf: IsoDate | null = null,
): Cents {
  let applied = 0
  for (const a of allocations) {
    if (asOf === null) {
      if (a.voidedOn === null) applied += a.amountCents
      continue
    }
    if (a.appliedOn <= asOf && (a.voidedOn === null || a.voidedOn > asOf)) applied += a.amountCents
  }
  return amountCents - applied
}
