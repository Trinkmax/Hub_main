/**
 * «Completar con Mercado Pago» del cierre del día (Ventas › Cierre del día): de
 * un reporte que baja la persona, lo cobrado con QR y por transferencia en UN
 * día, para precargar esos dos medios. Puro: corre en el navegador (el archivo
 * no se sube ni se guarda) y en los tests.
 *
 * Dos reportes (`mercadopago.md` §1.1–§1.3):
 * - «Liquidaciones» (`release_report`): se lee con `parseReleaseReport`. El día
 *   de cada cobro es el de la VENTA (`TRANSACTION_APPROVAL_DATE`, su
 *   `businessDate`), no el de la liberación. Solo trae lo ya liberado: con
 *   liberación diferida, un cobro del día puede no estar todavía (se avisa si
 *   el archivo muestra cobros con QR liberados días después).
 * - «Todas las transacciones» (`settlement_report`): cada movimiento aprobado,
 *   liberado o no. `TRANSACTION_TYPE = SETTLEMENT` es un cobro; el día sale de
 *   `TRANSACTION_DATE` (o `SETTLEMENT_DATE` si falta) y el importe, de
 *   `TRANSACTION_AMOUNT`.
 *
 * Qué se suma (§1.6, §1.9):
 * - Solo cobros (`payment` / `SETTLEMENT`) con importe positivo del día del
 *   cierre, con el mismo corte de día que el importador (`cutoffHour`).
 * - El canal, con `paymentChannel` (el clasificador del importador): `qr` va al
 *   medio de QR; `transfer_in`, al de transferencias, salvo las que vienen de la
 *   CUIT de la SAS (plata propia, no una venta). Point, link y lo que no se sabe
 *   clasificar no se suman (lo que no se supo, se cuenta para avisar).
 * - Importe bruto (lo que pagó el cliente): la comisión y los impuestos se
 *   descuentan después, cuando se importa la acreditación.
 * - Devoluciones y contracargos: se RESTAN solo si son del mismo día y de un
 *   cobro con QR o transferencia de ese mismo día que está en el archivo (mismo
 *   `SOURCE_ID`): cobro y devolución se anulan, como en el cierre de caja. La
 *   devolución de un cobro de otro día no es venta de este: se avisa y no se
 *   resta (va por la importación de Mercado Pago).
 * - Propinas por QR (`tip`, solo en Liquidaciones): no son ventas; se avisan.
 *
 * Datos personales: quién pagó (`PAYER_ID_NUMBER`) se compara EN MEMORIA con la
 * CUIT de la SAS y no sale de acá; nombres y tarjetas no se leen.
 */

import { addDays, formatDateTime, formatDayMonth, formatRange } from '@/lib/dates'
import { formatCents } from '@/lib/money'
import { type DecimalMark, detectDecimalMark, parseAmount } from '../amounts'
import { isBlankRow } from '../csv'
import { instantToCordobaDay, toUtcInstant } from '../dates'
import { findHeaderRow, type HeaderRule } from '../headers'
import type { Cell, Cents, IsoDate, MpChannel, MpSignalKey } from '../types'
import { count } from '../ui/progress'
import {
  isMpReleaseHeader,
  isMpSettlementHeader,
  MP_HEADER_RULES,
  parseReleaseReport,
  paymentChannel,
  rejoinSplitJson,
} from './release'

// ─── Qué medio del cierre es QR y cuál transferencia ─────────────────────────

/** Los dos cobros de Mercado Pago que completa el cierre. */
export type MpCloseChannel = 'qr' | 'transfer_in'

export type MpCloseMethod = {
  id: string
  kind: string
  systemKey: string | null
  partyId: string | null
  treasuryAccountId: string | null
}

export type MpCloseTargets = Readonly<Record<MpCloseChannel, string | null>>

/** Los medios que no llevan un importe suelto (cuenta corriente por cliente, seña). */
const NOT_A_TARGET = new Set(['customer_account', 'advance'])

/**
 * El medio del cierre donde va cada cobro, por sus datos y nunca por el nombre:
 * 1. lo elegido en Importar › Mercado Pago (`acc_mp_connections.channel_methods`);
 * 2. si no, el medio de fábrica: `qr_mp` para QR y `transfer` para
 *    transferencias, este solo si va a Mercado Pago (su partícipe o su caja son
 *    los de Mercado Pago; si va al banco, no es el de estas transferencias).
 * `methods` son los medios activos del cierre; lo que no está ahí no se usa.
 */
export function mpCloseTargets(input: {
  methods: readonly MpCloseMethod[]
  configured: Readonly<Partial<Record<string, string>>>
  mpPartyId: string | null
  mpTreasuryIds: readonly string[]
}): MpCloseTargets {
  const usable = input.methods.filter((m) => !NOT_A_TARGET.has(m.kind))
  const byId = new Map(usable.map((m) => [m.id, m]))
  const wallets = new Set(input.mpTreasuryIds)
  const goesToMp = (m: MpCloseMethod) =>
    (input.mpPartyId !== null && m.partyId === input.mpPartyId) ||
    (m.treasuryAccountId !== null && wallets.has(m.treasuryAccountId))
  const pick = (channel: MpCloseChannel, systemKey: string, needsMp: boolean): string | null => {
    const configured = input.configured[channel]
    if (configured && byId.has(configured)) return configured
    const found = usable.find((m) => m.systemKey === systemKey && (!needsMp || goesToMp(m)))
    return found?.id ?? null
  }
  return { qr: pick('qr', 'qr_mp', false), transfer_in: pick('transfer_in', 'transfer', true) }
}

// ─── «Todas las transacciones» ───────────────────────────────────────────────

const SETTLEMENT_COLUMNS = [
  'SOURCE_ID',
  'TRANSACTION_TYPE',
  'TRANSACTION_AMOUNT',
  'TRANSACTION_DATE',
  'SETTLEMENT_DATE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'OPERATION_TAGS',
  'BUSINESS_UNIT',
  'SUB_UNIT',
  'POS_ID',
  'STORE_ID',
  'POI_ID',
  'PAYER_ID_TYPE',
  'PAYER_ID_NUMBER',
] as const

type SettlementColumn = (typeof SETTLEMENT_COLUMNS)[number]

/** Encabezados en inglés, como los de Liquidaciones (los títulos en castellano están A CONFIRMAR). */
const SETTLEMENT_RULES: readonly HeaderRule<SettlementColumn>[] = SETTLEMENT_COLUMNS.map((key) => [
  new RegExp(`^${key.toLowerCase().replace(/_/g, ' ')}$`),
  key,
])

function isSettlementHeader(cols: Partial<Record<SettlementColumn, number>>): boolean {
  return (
    cols.TRANSACTION_TYPE !== undefined &&
    cols.TRANSACTION_AMOUNT !== undefined &&
    (cols.TRANSACTION_DATE !== undefined || cols.SETTLEMENT_DATE !== undefined)
  )
}

const REVERSAL_TYPES = new Set(['REFUND', 'CHARGEBACK', 'DISPUTE'])

// ─── Resultado ───────────────────────────────────────────────────────────────

export type MpDayReport = 'release' | 'settlement'

export type MpDayTotals = {
  /** Cobros del día (las devoluciones no restan cantidad). */
  readonly count: number
  /** Lo cobrado, bruto. */
  readonly grossCents: Cents
  /** Devoluciones y contracargos del mismo día, de cobros de ese día. */
  readonly refundCount: number
  readonly refundCents: Cents
  /** Lo que va al cierre: bruto − esas devoluciones (nunca negativo). */
  readonly netCents: Cents
}

export type MpDayTally = { readonly count: number; readonly cents: Cents }

export type MpDayOk = {
  readonly ok: true
  readonly report: MpDayReport
  readonly date: IsoDate
  readonly cutoffHour: number
  readonly qr: MpDayTotals
  readonly transfer: MpDayTotals
  /** Transferencias desde la CUIT de la SAS: plata propia, no se suman. */
  readonly ownTransfers: MpDayTally
  /** Transferencias sumadas sin saber quién las mandó (sin la columna o sin la CUIT de la SAS). */
  readonly uncheckedTransfers: number
  /** Cobros del día sin canal reconocible: no se suman. */
  readonly unclassified: MpDayTally
  /** Devoluciones o contracargos del día de cobros de otro día: no se restan. */
  readonly otherRefunds: MpDayTally
  /** Propinas por QR del día (Liquidaciones): no son ventas. */
  readonly tips: MpDayTally
  /** Filas que no se pudieron leer (fecha o importe ilegibles). */
  readonly unreadableRows: number
  /** Liquidaciones con cobros con QR liberados días después de la venta. */
  readonly deferredRelease: boolean
  /** El reporte empieza después de que arranca el día (instante UTC del saldo inicial). */
  readonly startsLate: string | null
  /** El reporte termina antes de que termine el día (instante UTC de la fila `total`). */
  readonly endsEarly: string | null
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null
}

export type MpDayFailure = {
  readonly ok: false
  /**
   * - `not_mp`: no es un reporte de Mercado Pago que conozcamos.
   * - `unreadable`: es «Todas las transacciones» pero faltan columnas o no se pudo leer ninguna fila.
   * - `empty`: no trae movimientos.
   * - `other_dates`: trae movimientos, pero no del día del cierre.
   */
  readonly reason: 'not_mp' | 'unreadable' | 'empty' | 'other_dates'
  readonly report: MpDayReport | null
  readonly date: IsoDate
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null
}

export type MpDayResult = MpDayOk | MpDayFailure

export type MpDayContext = {
  /** El día del cierre (`yyyy-MM-dd`). */
  date: IsoDate
  /** Corte del día (0 a 8): el de Importar › Mercado Pago. */
  cutoffHour: number
  /** CUIT de la SAS: una transferencia desde ella no es una venta. */
  sasCuit: string | null
}

/** Un movimiento que importa para el cierre, ya normalizado (sin datos personales). */
type DayMove =
  | {
      kind: 'payment'
      day: IsoDate
      sourceId: string | null
      cents: Cents
      channel: MpChannel | null
      fromOwnCuit: boolean | null
    }
  | { kind: 'reversal' | 'tip'; day: IsoDate; sourceId: string | null; cents: Cents }

type Coverage = { startsAtMs: number | null; endsAtMs: number | null }

type Period = { from: IsoDate; to: IsoDate }

function cellText(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '')
}

/** Las 0 h del día `date` en Córdoba (UTC−3 fijo) más `hour`, en milisegundos UTC. */
function cordobaHourMs(date: IsoDate, hour: number): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour + 3)
}

function widen(period: Period | null, day: IsoDate): Period {
  if (!period) return { from: day, to: day }
  return { from: day < period.from ? day : period.from, to: day > period.to ? day : period.to }
}

// ─── Liquidaciones → movimientos ─────────────────────────────────────────────

type Collected = {
  report: MpDayReport
  moves: DayMove[]
  period: Period | null
  unreadableRows: number
  deferredRelease: boolean
  coverage: Coverage
}

/** El saldo inicial y la fila `total` de Liquidaciones marcan desde y hasta cuándo es el reporte. */
function releaseCoverage(rows: readonly (readonly Cell[])[]): Coverage {
  const header = findHeaderRow(rows, MP_HEADER_RULES, isMpReleaseHeader, 15)
  const dateCol = header?.columns.DATE
  const typeCol = header?.columns.RECORD_TYPE
  if (!header || dateCol === undefined || typeCol === undefined) {
    return { startsAtMs: null, endsAtMs: null }
  }
  const width = (rows[header.index] ?? []).length
  let startsAtMs: number | null = null
  let endsAtMs: number | null = null
  for (const raw of rows.slice(header.index + 1)) {
    const row = rejoinSplitJson(raw, width)
    const type = cellText(row[typeCol]).toLowerCase()
    if (type !== 'initial_available_balance' && type !== 'total') continue
    const at = toUtcInstant(cellText(row[dateCol]))
    if (at === null) continue
    if (type === 'initial_available_balance') startsAtMs = Date.parse(at)
    else endsAtMs = Date.parse(at)
  }
  return { startsAtMs, endsAtMs }
}

function fromRelease(rows: readonly (readonly Cell[])[], ctx: MpDayContext): Collected | null {
  const parsed = parseReleaseReport(rows, { sasCuit: ctx.sasCuit, cutoffHour: ctx.cutoffHour })
  if (!parsed.ok) return null
  const moves: DayMove[] = []
  const seen = new Set<string>()
  let deferredRelease = false
  for (const { item } of parsed.items) {
    // Una fila repetida en el mismo archivo no se suma dos veces.
    if (seen.has(item.rowKey)) continue
    seen.add(item.rowKey)
    const description = item.description.toLowerCase()
    if (description === 'payment') {
      if (item.gross <= 0) continue // pagos que hizo el bar con su saldo
      moves.push({
        kind: 'payment',
        day: item.businessDate,
        sourceId: item.sourceId,
        cents: item.gross,
        channel: item.channel === 'other' ? null : item.channel,
        fromOwnCuit: item.fromOwnCuit,
      })
      if (item.channel === 'qr' && item.approvedAt !== null) {
        const sold = instantToCordobaDay(item.approvedAt, 0)
        if (sold !== null && item.releaseDate > addDays(sold, 1)) deferredRelease = true
      }
    } else if (item.channel === 'refund' || item.channel === 'chargeback') {
      // El día de la devolución es el de su movimiento (no el de la venta original).
      const day = instantToCordobaDay(item.releasedAt, ctx.cutoffHour) ?? item.releaseDate
      const cents = item.gross < 0 ? -item.gross : item.netDebit - item.netCredit
      if (cents > 0) moves.push({ kind: 'reversal', day, sourceId: item.sourceId, cents })
    } else if (item.channel === 'tip' && item.gross > 0) {
      moves.push({
        kind: 'tip',
        day: item.businessDate,
        sourceId: item.sourceId,
        cents: item.gross,
      })
    }
  }
  const unreadableRows = new Set(parsed.rowErrors.map((e) => e.row)).size
  return {
    report: 'release',
    moves,
    period: parsed.period ? { ...parsed.period } : null,
    unreadableRows,
    deferredRelease,
    coverage: releaseCoverage(rows),
  }
}

// ─── Todas las transacciones → movimientos ───────────────────────────────────

function fromSettlement(
  rows: readonly (readonly Cell[])[],
  ctx: MpDayContext,
): Collected | 'unreadable' | null {
  const header = findHeaderRow(rows, SETTLEMENT_RULES, isSettlementHeader, 15)
  if (!header) {
    // Lo reconocemos (`TRANSACTION_TYPE` + `SETTLEMENT_NET_AMOUNT`) pero faltan columnas.
    return rows.slice(0, 15).some((r) => isMpSettlementHeader(r)) ? 'unreadable' : null
  }
  const cols = header.columns
  const width = (rows[header.index] ?? []).length
  const dataRows = rows.slice(header.index + 1).map((r) => rejoinSplitJson(r, width))
  const amountCol = cols.TRANSACTION_AMOUNT
  const decimal: DecimalMark =
    detectDecimalMark(
      dataRows.slice(0, 500).map((r) => (amountCol === undefined ? null : (r[amountCol] ?? null))),
    ) ?? '.'
  const sasCuit = digitsOnly(ctx.sasCuit ?? '')
  const hasPayer = cols.PAYER_ID_NUMBER !== undefined

  const moves: DayMove[] = []
  const seen = new Set<string>()
  let period: Period | null = null
  let unreadableRows = 0
  for (const row of dataRows) {
    if (isBlankRow(row)) continue
    const get = (k: SettlementColumn): string => {
      const j = cols[k]
      return j === undefined ? '' : cellText(row[j])
    }
    const type = get('TRANSACTION_TYPE').toUpperCase()
    const rawDate = get('TRANSACTION_DATE') || get('SETTLEMENT_DATE')
    const day = instantToCordobaDay(rawDate, ctx.cutoffHour)
    const amount = parseAmount(amountCol === undefined ? null : (row[amountCol] ?? null), decimal)
    if (type === '' || day === null || !amount.ok) {
      unreadableRows++
      continue
    }
    period = widen(period, day)
    const sourceId = get('SOURCE_ID') || null
    if (sourceId !== null) {
      const key = `${type}|${sourceId}|${rawDate}|${amount.cents}`
      if (seen.has(key)) continue
      seen.add(key)
    }
    if (type === 'SETTLEMENT') {
      if (amount.cents <= 0) continue
      const signals: Partial<Record<MpSignalKey, string>> = {}
      const signal = (key: MpSignalKey, col: SettlementColumn) => {
        const v = get(col)
        if (v !== '') signals[key] = v.slice(0, 80)
      }
      signal('operationTags', 'OPERATION_TAGS')
      signal('subUnit', 'SUB_UNIT')
      signal('businessUnit', 'BUSINESS_UNIT')
      signal('poiId', 'POI_ID')
      signal('posId', 'POS_ID')
      signal('storeId', 'STORE_ID')
      signal('paymentMethodType', 'PAYMENT_METHOD_TYPE')
      signal('paymentMethod', 'PAYMENT_METHOD')
      let fromOwnCuit: boolean | null = null
      if (hasPayer) {
        const payer = digitsOnly(get('PAYER_ID_NUMBER'))
        const payerType = get('PAYER_ID_TYPE').toUpperCase()
        fromOwnCuit = sasCuit !== '' && payer !== '' && payer === sasCuit && payerType !== 'DNI'
      }
      moves.push({
        kind: 'payment',
        day,
        sourceId,
        cents: amount.cents,
        channel: paymentChannel(signals),
        fromOwnCuit,
      })
    } else if (REVERSAL_TYPES.has(type)) {
      const cents = Math.abs(amount.cents)
      if (cents > 0) moves.push({ kind: 'reversal', day, sourceId, cents })
    }
  }
  if (period === null && unreadableRows > 0) return 'unreadable'
  return {
    report: 'settlement',
    moves,
    period,
    unreadableRows,
    deferredRelease: false,
    coverage: { startsAtMs: null, endsAtMs: null },
  }
}

// ─── El día ──────────────────────────────────────────────────────────────────

type Bucket = { count: number; gross: Cents; refundCount: number; refundCents: Cents }

const emptyBucket = (): Bucket => ({ count: 0, gross: 0, refundCount: 0, refundCents: 0 })

function totals(b: Bucket): MpDayTotals {
  return {
    count: b.count,
    grossCents: b.gross,
    refundCount: b.refundCount,
    refundCents: b.refundCents,
    netCents: Math.max(0, b.gross - b.refundCents),
  }
}

/**
 * Lee las filas del reporte (Liquidaciones o Todas las transacciones) y suma lo
 * cobrado con QR y por transferencia el día del cierre. Nunca tira.
 */
export function readMpDay(rows: readonly (readonly Cell[])[], ctx: MpDayContext): MpDayResult {
  const cutoffHour = Math.max(0, Math.min(8, Math.trunc(ctx.cutoffHour)))
  const c = { ...ctx, cutoffHour }
  const fail = (
    reason: MpDayFailure['reason'],
    report: MpDayReport | null,
    period: Period | null = null,
  ): MpDayFailure => ({ ok: false, reason, report, date: ctx.date, period })

  const release = fromRelease(rows, c)
  const collected = release ?? fromSettlement(rows, c)
  if (collected === null) return fail('not_mp', null)
  if (collected === 'unreadable') return fail('unreadable', 'settlement')
  if (collected.period === null) return fail('empty', collected.report)
  const { period } = collected
  const date = ctx.date
  if (date < period.from || date > period.to) return fail('other_dates', collected.report, period)

  const qr = emptyBucket()
  const transfer = emptyBucket()
  const own = { count: 0, cents: 0 }
  const unclassified = { count: 0, cents: 0 }
  const otherRefunds = { count: 0, cents: 0 }
  const tips = { count: 0, cents: 0 }
  let uncheckedTransfers = 0
  const counted = new Map<string, Bucket>()
  const paidToday = new Set<string>()
  const ownCuitKnown = digitsOnly(ctx.sasCuit ?? '').length === 11

  for (const m of collected.moves) {
    if (m.day !== date || m.kind !== 'payment') continue
    if (m.sourceId !== null) paidToday.add(m.sourceId)
    let bucket: Bucket | null = null
    if (m.channel === 'qr') bucket = qr
    else if (m.channel === 'transfer_in') {
      if (m.fromOwnCuit === true) {
        own.count++
        own.cents += m.cents
        continue
      }
      if (!ownCuitKnown || m.fromOwnCuit === null) uncheckedTransfers++
      bucket = transfer
    } else if (m.channel === null) {
      unclassified.count++
      unclassified.cents += m.cents
    }
    if (bucket === null) continue
    bucket.count++
    bucket.gross += m.cents
    if (m.sourceId !== null) counted.set(m.sourceId, bucket)
  }
  for (const m of collected.moves) {
    if (m.day !== date) continue
    if (m.kind === 'tip') {
      tips.count++
      tips.cents += m.cents
      continue
    }
    if (m.kind !== 'reversal') continue
    const bucket = m.sourceId !== null ? counted.get(m.sourceId) : undefined
    if (bucket) {
      bucket.refundCount++
      bucket.refundCents += m.cents
    } else if (m.sourceId === null || !paidToday.has(m.sourceId)) {
      // De un cobro de otro día (o que no está en el archivo). Las de un cobro de
      // hoy con Point, link o de la propia SAS no tocan QR ni transferencias.
      otherRefunds.count++
      otherRefunds.cents += m.cents
    }
  }

  const dayStart = cordobaHourMs(date, cutoffHour)
  const dayEnd = cordobaHourMs(addDays(date, 1), cutoffHour)
  const { startsAtMs, endsAtMs } = collected.coverage
  return {
    ok: true,
    report: collected.report,
    date,
    cutoffHour,
    qr: totals(qr),
    transfer: totals(transfer),
    ownTransfers: own,
    uncheckedTransfers,
    unclassified,
    otherRefunds,
    tips,
    unreadableRows: collected.unreadableRows,
    deferredRelease: collected.deferredRelease,
    startsLate:
      startsAtMs !== null && startsAtMs > dayStart ? new Date(startsAtMs).toISOString() : null,
    // Un minuto de gracia: los reportes cierran a las 23:59:59.
    endsEarly:
      endsAtMs !== null && endsAtMs < dayEnd - 60_000 ? new Date(endsAtMs).toISOString() : null,
    period,
  }
}

// ─── Qué se completa ─────────────────────────────────────────────────────────

export type MpDayFill = {
  /** Importe por medio del cierre (`null` = vacío: todo devuelto). */
  readonly fills: Readonly<Record<string, number | null>>
  /** Cobros que hubo pero el cierre no tiene dónde ponerlos. */
  readonly missing: readonly MpCloseChannel[]
}

/** Lo que va a cada medio. Un canal sin cobros no toca su medio; dos canales al mismo medio se suman. */
export function mpDayFills(result: MpDayOk, targets: MpCloseTargets): MpDayFill {
  const sums = new Map<string, number>()
  const missing: MpCloseChannel[] = []
  const put = (channel: MpCloseChannel, t: MpDayTotals) => {
    if (t.count === 0) return
    const id = targets[channel]
    if (id === null) {
      missing.push(channel)
      return
    }
    sums.set(id, (sums.get(id) ?? 0) + t.netCents)
  }
  put('qr', result.qr)
  put('transfer_in', result.transfer)
  const fills: Record<string, number | null> = {}
  for (const [id, cents] of sums) fills[id] = cents === 0 ? null : cents
  return { fills, missing }
}

// ─── Lo que se le dice a la persona ──────────────────────────────────────────

/** Plata para una frase: sin centavos si es redonda. */
function money(cents: Cents): string {
  return formatCents(cents, { decimals: cents % 100 === 0 ? 0 : 2 })
}

const CHANNEL_WORDS: Readonly<Record<MpCloseChannel, string>> = {
  qr: 'los cobros con QR',
  transfer_in: 'las transferencias',
}

/** Por qué no se pudo usar el archivo, en palabras simples. */
export function mpDayFailureText(result: MpDayFailure): string {
  const day = formatDayMonth(result.date)
  switch (result.reason) {
    case 'not_mp':
      return 'Este archivo no es un reporte de Mercado Pago. Bajá el de «Liquidaciones» (o el de «Todas las transacciones») desde Mercado Pago, sin abrirlo con Excel.'
    case 'unreadable':
      return 'Es el reporte «Todas las transacciones», pero no encontramos la fecha, el tipo o el importe de cada movimiento. Bajá el de «Liquidaciones».'
    case 'empty':
      return `El reporte no trae movimientos. Bajá uno que incluya el ${day}.`
    case 'other_dates':
      return result.period
        ? `El archivo es del ${formatRange(result.period.from, result.period.to)}: no trae el ${day}. Bajá uno que incluya ese día.`
        : `El archivo no trae el ${day}. Bajá uno que incluya ese día.`
  }
}

export type MpDaySummary = {
  /** «Del archivo: 23 cobros con QR por $ X y 5 transferencias por $ Y del 07/10…». */
  readonly headline: string
  /** Lo que conviene mirar (devoluciones, plata propia, lo que no se sumó…). */
  readonly notes: readonly string[]
  /** `false`: el archivo no trae QR ni transferencias de ese día (no se completa nada). */
  readonly fillsSomething: boolean
}

/** El resumen chico que queda en el formulario. Nunca nombra a quien pagó. */
export function describeMpDay(result: MpDayOk, fill: MpDayFill): MpDaySummary {
  const day = formatDayMonth(result.date)
  const { qr, transfer } = result
  const notes: string[] = []

  for (const channel of fill.missing) {
    notes.push(
      `Tu cierre no tiene un medio para ${CHANNEL_WORDS[channel]} de Mercado Pago: no los completamos.`,
    )
  }
  const refunds = qr.refundCount + transfer.refundCount
  if (refunds > 0) {
    notes.push(
      `Ya restamos ${count(refunds, 'devolución', 'devoluciones')} de cobros del mismo día (${money(qr.refundCents + transfer.refundCents)}).`,
    )
  }
  if (result.otherRefunds.count > 0) {
    notes.push(
      result.otherRefunds.count === 1
        ? `Hubo una devolución de un cobro de otro día (${money(result.otherRefunds.cents)}): no la restamos.`
        : `Hubo ${count(result.otherRefunds.count, 'devolución', 'devoluciones')} de cobros de otros días (${money(result.otherRefunds.cents)}): no las restamos.`,
    )
  }
  if (result.ownTransfers.count > 0) {
    notes.push(
      `No sumamos ${count(result.ownTransfers.count, 'transferencia', 'transferencias')} desde la CUIT de la SAS (${money(result.ownTransfers.cents)}): es plata tuya, no una venta.`,
    )
  }
  if (result.uncheckedTransfers > 0) {
    notes.push(
      result.uncheckedTransfers === 1
        ? 'No pudimos revisar si la transferencia viene de la propia SAS: si es así, no es una venta y hay que restarla.'
        : `No pudimos revisar si alguna de las ${count(result.uncheckedTransfers, 'transferencia', 'transferencias')} viene de la propia SAS: si es así, no es una venta y hay que restarla.`,
    )
  }
  if (result.unclassified.count > 0) {
    notes.push(
      `${count(result.unclassified.count, 'cobro', 'cobros')} del día (${money(result.unclassified.cents)}) no ${result.unclassified.count === 1 ? 'sabemos si es' : 'sabemos si son'} QR, Point o transferencia: no ${result.unclassified.count === 1 ? 'lo' : 'los'} sumamos.`,
    )
  }
  if (result.tips.count > 0) {
    notes.push(
      result.tips.count === 1
        ? `Hubo una propina por QR (${money(result.tips.cents)}): no la sumamos porque no es una venta.`
        : `Hubo ${count(result.tips.count, 'propina', 'propinas')} por QR (${money(result.tips.cents)}): no las sumamos porque no son ventas.`,
    )
  }
  if (result.startsLate) {
    notes.push(
      `El reporte empieza el ${formatDateTime(result.startsLate)}: lo cobrado antes no está.`,
    )
  }
  if (result.endsEarly) {
    notes.push(
      result.cutoffHour > 0
        ? `El reporte llega hasta el ${formatDateTime(result.endsEarly)} y el día del cierre sigue hasta las ${result.cutoffHour} a. m.: lo cobrado después no está.`
        : `El reporte llega hasta el ${formatDateTime(result.endsEarly)}: lo cobrado después no está.`,
    )
  }
  if (result.deferredRelease) {
    notes.push(
      'Mercado Pago te libera algunos cobros con QR días después: los del día que todavía no se liberaron no están en «Liquidaciones». Para tenerlos todos, usá «Todas las transacciones».',
    )
  }
  if (result.unreadableRows > 0) {
    notes.push(
      `${count(result.unreadableRows, 'fila del archivo no se pudo leer', 'filas del archivo no se pudieron leer')}.`,
    )
  }

  if (qr.count === 0 && transfer.count === 0) {
    return {
      headline: `El archivo no trae cobros con QR ni transferencias del ${day}: no cambiamos nada.`,
      notes,
      fillsSomething: false,
    }
  }
  const qrText =
    qr.count > 0
      ? `${count(qr.count, 'cobro con QR', 'cobros con QR')} por ${money(qr.netCents)}`
      : 'ningún cobro con QR'
  const transferText =
    transfer.count > 0
      ? `${count(transfer.count, 'transferencia', 'transferencias')} por ${money(transfer.netCents)}`
      : 'ninguna transferencia'
  return {
    headline: `Del archivo: ${qrText} y ${transferText} del ${day}. Revisalos antes de guardar.`,
    notes,
    fillsSomething: Object.keys(fill.fills).length > 0,
  }
}
