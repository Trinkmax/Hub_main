/**
 * Reporte de Liquidaciones de Mercado Pago (`release_report`) → movimientos
 * normalizados (diseño §4.2, `mercadopago.md` §1.2, §1.6, §2.8 y §4.5).
 *
 * El mismo parser sirve para el CSV que sube la persona y para el que baja el
 * cron por API (fase 3). Funciona como un extracto: saldo inicial, cada
 * movimiento con bruto, comisión, impuestos y neto, saldo corrido y total.
 *
 * - Encabezados en inglés (lo que pide la guía); separador `,` (API) o `;`
 *   (panel); decimal `.` (se confirma por archivo).
 * - Fechas con su offset (`-03:00` o el `-04:00` de fábrica): se leen del texto y
 *   se pasan a Córdoba. El día contable usa el corte del bar (`cutoffHour`).
 * - `TAXES_DISAGGREGATED` muchas veces NO es JSON válido
 *   (`[{financial_entity:debitos_creditos,amount:-90.00,…}]`): se lee tolerante
 *   y se controla que sume `TAXES_AMOUNT`.
 * - Controles: por fila `crédito − débito = bruto + comisión + financiación +
 *   envío + impuestos`; del archivo, saldo inicial + movimientos = total, y el
 *   saldo corrido fila a fila. Lo que no cierra va a revisión; nunca se descarta.
 * - Datos personales: `PAYER_ID_NUMBER` se compara EN MEMORIA con la CUIT de la
 *   SAS y queda solo el booleano; de la cuenta destino de un retiro, los últimos
 *   4 dígitos y si es propia. Nombres de quien paga y tarjetas no se leen.
 */

import { type DecimalMark, detectDecimalMark, parseAmount } from '../amounts'
import { isBlankRow } from '../csv'
import { instantToCordobaDay, toUtcInstant } from '../dates'
import { sha256HexSync } from '../hash'
import { findHeaderRow, type HeaderRule, normalizeHeader } from '../headers'
import {
  type Cell,
  type Cents,
  type ImportIssue,
  type ImportIssueCode,
  type ImportRow,
  type IsoDate,
  type IssueLevel,
  issue,
  type MpChannel,
  type MpItem,
  type MpSignalKey,
  type MpTax,
} from '../types'

// ─── Columnas ────────────────────────────────────────────────────────────────

/** Las columnas que usamos (claves del glosario de Argentina, `mercadopago.md` §1.2). */
export const MP_RELEASE_COLUMNS = [
  'DATE',
  'SOURCE_ID',
  'EXTERNAL_REFERENCE',
  'RECORD_TYPE',
  'DESCRIPTION',
  'NET_CREDIT_AMOUNT',
  'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT',
  'BALANCE_AMOUNT',
  'MP_FEE_AMOUNT',
  'FINANCING_FEE_AMOUNT',
  'SHIPPING_FEE_AMOUNT',
  'COUPON_AMOUNT',
  'TAXES_AMOUNT',
  'TAXES_DISAGGREGATED',
  'TRANSACTION_APPROVAL_DATE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'OPERATION_TAGS',
  'BUSINESS_UNIT',
  'SUB_UNIT',
  'POS_ID',
  'STORE_ID',
  'POI_ID',
  'PAYOUT_BANK_ACCOUNT_NUMBER',
  'CURRENCY',
  'PAYER_ID_TYPE',
  'PAYER_ID_NUMBER',
] as const

export type MpColumn = (typeof MP_RELEASE_COLUMNS)[number]

/** `NET_CREDIT_AMOUNT` → `/^net credit amount$/`, como queda normalizado. */
const englishRule = (key: MpColumn): HeaderRule<MpColumn> => [
  new RegExp(`^${key.toLowerCase().replace(/_/g, ' ')}$`),
  key,
]

/**
 * En inglés (lo que pide la guía) y algunos títulos en castellano que son la
 * traducción obvia. Los textos exactos con `report_translation=es` están A
 * CONFIRMAR (`mercadopago.md` §5.8): si no se reconocen, el archivo no se
 * detecta y se pide configurar los encabezados en inglés.
 */
export const MP_HEADER_RULES: readonly HeaderRule<MpColumn>[] = [
  ...MP_RELEASE_COLUMNS.map(englishRule),
  [/^fecha( liberacion)?$/, 'DATE'],
  [/^(id operacion|numero operacion|id origen)( en mercado pago)?$/, 'SOURCE_ID'],
  [/^referencia externa$/, 'EXTERNAL_REFERENCE'],
  [/^tipo registro$/, 'RECORD_TYPE'],
  [/^descripcion$/, 'DESCRIPTION'],
  [/^(monto neto acreditado|credito neto|monto neto credito)$/, 'NET_CREDIT_AMOUNT'],
  [/^(monto neto debitado|debito neto|monto neto debito)$/, 'NET_DEBIT_AMOUNT'],
  [/^(monto bruto|bruto)$/, 'GROSS_AMOUNT'],
  [/^saldo$/, 'BALANCE_AMOUNT'],
]

/** ¿La fila de títulos es la de Liquidaciones? */
export function isMpReleaseHeader(cols: Partial<Record<MpColumn, number>>): boolean {
  return (
    cols.DATE !== undefined &&
    cols.RECORD_TYPE !== undefined &&
    cols.DESCRIPTION !== undefined &&
    cols.NET_CREDIT_AMOUNT !== undefined &&
    cols.NET_DEBIT_AMOUNT !== undefined
  )
}

/** ¿Es el otro reporte, «Todas las transacciones» (`settlement_report`)? Se detecta para avisar. */
export function isMpSettlementHeader(row: readonly Cell[]): boolean {
  const names = new Set(row.map((c) => normalizeHeader(c)))
  return names.has('transaction type') && names.has('settlement net amount')
}

// ─── TAXES_DISAGGREGATED ─────────────────────────────────────────────────────

/**
 * `[{financial_entity:debitos_creditos,amount:-90.00,detail:tax_withholding_collector}]`
 * o el mismo JSON con comillas. Devuelve `null` si no se puede leer.
 */
export function parseTaxesDisaggregated(raw: Cell | undefined): MpTax[] | null {
  if (raw === null || raw === undefined) return []
  const text = String(raw).trim()
  if (text === '' || text === '[]') return []
  type Loose = { entity: string; detail: string; amount: Cell }
  let loose: Loose[] | null = null
  try {
    const parsed: unknown = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    loose = list.map((o) => {
      const rec = (o ?? {}) as Record<string, unknown>
      const amount = rec.amount
      return {
        entity: String(rec.financial_entity ?? rec.entity ?? ''),
        detail: String(rec.detail ?? rec.type ?? ''),
        amount: typeof amount === 'number' || typeof amount === 'string' ? amount : null,
      }
    })
  } catch {
    loose = []
    const re = /\{([^}]*)\}/g
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      const rec: Record<string, string> = {}
      for (const part of (m[1] ?? '').split(',')) {
        const at = part.indexOf(':')
        if (at === -1) continue
        const k = part
          .slice(0, at)
          .trim()
          .replace(/^["']|["']$/g, '')
        rec[k] = part
          .slice(at + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
      }
      loose.push({
        entity: rec.financial_entity ?? rec.entity ?? '',
        detail: rec.detail ?? rec.type ?? '',
        amount: rec.amount ?? null,
      })
    }
    if (loose.length === 0) return null
  }
  const out: MpTax[] = []
  for (const t of loose) {
    // En el JSON los números van con punto aunque el archivo use coma.
    // Adentro del JSON MP escribe siempre con punto; `auto` acepta igual una coma.
    const r = parseAmount(t.amount, typeof t.amount === 'number' ? '.' : 'auto')
    if (!r.ok) return null
    out.push({ entity: t.entity.slice(0, 60), detail: t.detail.slice(0, 80), amount: r.cents })
  }
  return out
}

// ─── Canal ───────────────────────────────────────────────────────────────────

const REVIEW_DESCRIPTIONS = new Set([
  'refund',
  'chargeback',
  'dispute',
  'restriction',
  'tip',
  'credit_payment',
  'fee_release_in_advance',
  'digitalchange_transaction',
  'shipping',
  'shipping_cancel',
  'shipping_return',
  'shipping_refund',
  'withdrawal_cancel',
  'payout_cancel',
])

/** Qué es un movimiento por su `DESCRIPTION` (sin mirar el canal de un cobro). */
function channelOfDescription(description: string): MpChannel | 'payment' | 'payout' | null {
  const d = description.toLowerCase()
  if (d === 'payment') return 'payment'
  if (d === 'payout' || d === 'withdrawal') return 'payout'
  if (d === 'withdrawal_cancel' || d === 'payout_cancel') return 'other'
  if (d.startsWith('reserve_for_') || d === 'reserve') return 'reserve'
  if (d.startsWith('asset_management')) return 'yield'
  if (d === 'tax_withdholding' || d === 'tax_withdholding_cancel' || d === 'tax_withholding')
    return 'iibb_later'
  if (d.startsWith('tax_withholding_') || d === 'tax_credit_debit') return 'bank_tax'
  if (d.startsWith('tax_iva') || d.startsWith('tax_payment_') || d.startsWith('tax_iibb'))
    return 'perception'
  if (d === 'refund') return 'refund'
  if (d === 'chargeback' || d === 'dispute') return 'chargeback'
  if (d === 'tip') return 'tip'
  if (d === 'credit_payment') return 'loan'
  if (d === 'fee_release_in_advance') return 'fee_advance'
  if (d === 'digitalchange_transaction') return 'digital_change'
  if (d === 'restriction' || d.startsWith('shipping')) return 'other'
  return null
}

/**
 * El canal de un cobro (`mercadopago.md` §1.6), en orden: `OPERATION_TAGS` o
 * `SUB_UNIT`, el lector Point (`POI_ID`), la caja del QR (`POS_ID`/`STORE_ID`),
 * la transferencia (`bank_transfer`, CVU o DEBIN). Lo demás, `null` (a revisión).
 */
export function paymentChannel(s: Partial<Record<MpSignalKey, string>>): MpChannel | null {
  const tags = (s.operationTags ?? '').toUpperCase()
  const sub = normalizeHeader(s.subUnit ?? '')
  const unit = normalizeHeader(s.businessUnit ?? '')
  const type = (s.paymentMethodType ?? '').toLowerCase()
  const method = (s.paymentMethod ?? '').toLowerCase()
  if (/\bQR\b/.test(tags) || sub === 'qr') return 'qr'
  if (/\bPO(INT)?\b/.test(tags) || sub === 'point' || sub.includes('point')) return 'point'
  if (sub.includes('link') || sub.includes('checkout') || unit.includes('link')) return 'link'
  if (s.poiId) return 'point'
  if (s.posId || s.storeId) return 'qr'
  if (type === 'bank_transfer' || method === 'cvu' || method === 'debin_transfer')
    return 'transfer_in'
  return null
}

// ─── Resultado ───────────────────────────────────────────────────────────────

export type MpReleaseContext = {
  /** CUIT de la SAS: una transferencia que viene de ella es plata propia, no una venta. */
  sasCuit?: string | null
  /** CBU/CVU propios (Ajustes › Cajas): un retiro a uno de ellos es una transferencia propia. */
  ownCbus?: readonly string[]
  /** Corte del día contable: 0 = calendario, 5 = día de servicio (de 0 a 8). */
  cutoffHour?: number
}

export type MpFileChecks = {
  /** Saldo inicial + Σ (crédito − débito) contra la fila `total`. */
  readonly total: 'ok' | 'mismatch' | 'unavailable'
  /** Diferencia (total del reporte − lo calculado) si no cierra. */
  readonly totalDiffCents: Cents | null
  /** El saldo corrido (`BALANCE_AMOUNT`) fila a fila. */
  readonly balanceChain: 'ok' | 'mismatch' | 'unavailable'
  readonly balanceMismatchRows: readonly number[]
  /** Filas con el control de bruto/comisión/impuestos que no cierra. */
  readonly rowCheckFailures: number
  /** Pares `reserve_*` que no se compensaron (dinero retenido al cierre). */
  readonly openReserveCents: Cents
}

export type MpParseResult = {
  readonly ok: boolean
  readonly layout: 'mp_release' | null
  readonly headerRow: number | null
  readonly decimal: DecimalMark
  readonly items: readonly ImportRow<MpItem>[]
  readonly rowErrors: readonly ImportIssue[]
  readonly fileIssues: readonly ImportIssue[]
  readonly initialBalance: Cents | null
  readonly finalBalance: Cents | null
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null
  readonly fileChecks: MpFileChecks
  /** `DESCRIPTION` que no conocemos (para mostrarlas y sumar reglas). */
  readonly unknownDescriptions: readonly string[]
}

const AMOUNT_COLUMNS: readonly MpColumn[] = [
  'NET_CREDIT_AMOUNT',
  'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT',
  'BALANCE_AMOUNT',
  'MP_FEE_AMOUNT',
  'FINANCING_FEE_AMOUNT',
  'SHIPPING_FEE_AMOUNT',
  'COUPON_AMOUNT',
  'TAXES_AMOUNT',
]

function emptyChecks(): MpFileChecks {
  return {
    total: 'unavailable',
    totalDiffCents: null,
    balanceChain: 'unavailable',
    balanceMismatchRows: [],
    rowCheckFailures: 0,
    openReserveCents: 0,
  }
}

/**
 * Si un reporte con `,` trae el JSON de `TAXES_DISAGGREGATED` o `METADATA` sin
 * comillas, sus comas parten la celda y corren todas las columnas de después.
 * Cuando la fila tiene más celdas que los títulos, vuelve a unir lo que va de un
 * `[` o `{` hasta su cierre.
 */
export function rejoinSplitJson(raw: readonly Cell[], headerLength: number): readonly Cell[] {
  if (raw.length <= headerLength) return raw
  const out: Cell[] = []
  for (let i = 0; i < raw.length; i++) {
    const cell = raw[i] ?? null
    const s = typeof cell === 'string' ? cell.trim() : ''
    const open = s.startsWith('[') ? ']' : s.startsWith('{') ? '}' : null
    if (open === null || s.endsWith(open) || out.length + (raw.length - i) <= headerLength) {
      out.push(cell)
      continue
    }
    let joined = typeof cell === 'string' ? cell : ''
    let j = i + 1
    while (j < raw.length && out.length + 1 + (raw.length - j) > headerLength) {
      const next = raw[j]
      joined += `,${next === null || next === undefined ? '' : String(next)}`
      j++
      if (joined.trim().endsWith(open)) break
    }
    out.push(joined)
    i = j - 1
  }
  return out
}

function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function digitsOnly(v: string): string {
  return v.replace(/\D/g, '')
}

/**
 * Lee las filas crudas del reporte de Liquidaciones. Nunca tira: lo que no se
 * entiende queda en `rowErrors`, `fileIssues` o como aviso de la fila.
 */
export function parseReleaseReport(
  rows: readonly (readonly Cell[])[],
  ctx: MpReleaseContext = {},
): MpParseResult {
  const header = findHeaderRow(rows, MP_HEADER_RULES, isMpReleaseHeader, 15)
  if (!header) {
    const settlement = rows.slice(0, 15).some((r) => isMpSettlementHeader(r))
    return {
      ok: false,
      layout: null,
      headerRow: null,
      decimal: '.',
      items: [],
      rowErrors: [],
      fileIssues: [issue('error', settlement ? 'mp_settlement' : 'mp_no_header', null)],
      initialBalance: null,
      finalBalance: null,
      period: null,
      fileChecks: emptyChecks(),
      unknownDescriptions: [],
    }
  }
  const cols = header.columns
  const sasCuit = digitsOnly(ctx.sasCuit ?? '')
  const ownCbus = new Set((ctx.ownCbus ?? []).map(digitsOnly).filter((c) => c.length >= 8))
  const cutoff = ctx.cutoffHour ?? 0
  const has = (k: MpColumn) => cols[k] !== undefined

  const headerLength = (rows[header.index] ?? []).length
  const dataRows = rows.slice(header.index + 1)
  const sample: Cell[] = []
  for (const row of dataRows.slice(0, 500)) {
    const r = rejoinSplitJson(row, headerLength)
    for (const k of AMOUNT_COLUMNS) {
      const j = cols[k]
      if (j !== undefined) sample.push(r[j] ?? null)
    }
  }
  const decimal: DecimalMark = detectDecimalMark(sample) ?? '.'

  const items: ImportRow<MpItem>[] = []
  const rowErrors: ImportIssue[] = []
  const fileIssues: ImportIssue[] = []
  const unknown = new Set<string>()
  const seen = new Set<string>()
  const reserves = new Map<string, Cents>()
  const balanceMismatchRows: number[] = []
  let initialBalance: Cents | null = null
  let finalBalance: Cents | null = null
  let movementsSum = 0
  let prevBalance: Cents | null = null
  let chainSeen = false
  let rowCheckFailures = 0
  let from: IsoDate | null = null
  let to: IsoDate | null = null

  for (let i = header.index + 1; i < rows.length; i++) {
    const raw = rejoinSplitJson(rows[i] ?? [], headerLength)
    if (isBlankRow(raw)) continue
    const rowNo = i + 1
    const get = (k: MpColumn): Cell => {
      const j = cols[k]
      return j === undefined ? null : (raw[j] ?? null)
    }
    const issues: ImportIssue[] = []
    const add = (
      level: IssueLevel,
      code: ImportIssueCode,
      extra: { field?: string; cents?: Cents } = {},
    ) => issues.push(issue(level, code, rowNo, extra))
    const amount = (k: MpColumn): Cents | null => {
      const r = parseAmount(get(k), decimal)
      if (r.ok) return r.cents
      if (r.reason === 'empty') return null
      add('error', 'mp_bad_amount', { field: k })
      return null
    }

    const recordType = text(get('RECORD_TYPE')).toLowerCase()
    const credit = amount('NET_CREDIT_AMOUNT') ?? 0
    const debit = amount('NET_DEBIT_AMOUNT') ?? 0
    const balance = amount('BALANCE_AMOUNT')

    if (recordType === 'initial_available_balance') {
      if (issues.length === 0) initialBalance = credit - debit
      if (balance !== null) prevBalance = balance
      else if (issues.length === 0) prevBalance = credit - debit
      continue
    }
    if (recordType === 'total') {
      if (issues.length === 0) finalBalance = credit - debit
      continue
    }
    // Saldo antes y después de cada retiro: informativo.
    if (recordType === 'available_balance') continue

    const description = text(get('DESCRIPTION'))
    if (recordType !== 'release') add('review', 'mp_unknown_record_type', { field: 'RECORD_TYPE' })

    const rawDate = text(get('DATE'))
    const releasedAt = toUtcInstant(rawDate)
    const releaseDate = instantToCordobaDay(rawDate, 0)
    if (releasedAt === null || releaseDate === null) add('error', 'mp_bad_date', { field: 'DATE' })
    const rawApproval = text(get('TRANSACTION_APPROVAL_DATE'))
    const approvedAt = rawApproval === '' ? null : toUtcInstant(rawApproval)
    const businessDate =
      (approvedAt !== null ? instantToCordobaDay(rawApproval, cutoff) : null) ??
      instantToCordobaDay(rawDate, cutoff)

    const gross = amount('GROSS_AMOUNT')
    const mpFee = amount('MP_FEE_AMOUNT') ?? 0
    const financingFee = amount('FINANCING_FEE_AMOUNT') ?? 0
    const shippingFee = amount('SHIPPING_FEE_AMOUNT') ?? 0
    const couponCents = amount('COUPON_AMOUNT') ?? 0
    const taxes = amount('TAXES_AMOUNT') ?? 0

    if (issues.some((x) => x.level === 'error')) {
      rowErrors.push(...issues.filter((x) => x.level === 'error'))
      continue
    }

    // Control por fila: crédito − débito = bruto + comisión + financiación + envío + impuestos.
    if (gross !== null) {
      const diff = credit - debit - (gross + mpFee + financingFee + shippingFee + taxes)
      if (diff !== 0) {
        rowCheckFailures++
        add('review', 'mp_row_check', { cents: diff })
      }
    }

    // Impuestos discriminados.
    let taxesDetail: MpTax[] = []
    if (has('TAXES_DISAGGREGATED')) {
      const parsed = parseTaxesDisaggregated(get('TAXES_DISAGGREGATED'))
      if (parsed === null) add('review', 'mp_taxes_unreadable', { field: 'TAXES_DISAGGREGATED' })
      else {
        taxesDetail = parsed
        const sum = parsed.reduce((a, t) => a + t.amount, 0)
        if (parsed.length > 0 && sum !== taxes)
          add('review', 'mp_taxes_mismatch', { cents: taxes - sum })
        if (parsed.length === 0 && taxes !== 0 && has('TAXES_AMOUNT')) {
          add('review', 'mp_taxes_mismatch', { cents: taxes })
        }
      }
    }

    // Moneda (Liquidaciones va en la moneda local; si no, a revisión).
    const currency = text(get('CURRENCY')).toUpperCase()
    if (currency !== '' && currency !== 'ARS') add('review', 'mp_currency', { field: 'CURRENCY' })

    // Señales del canal (sin datos personales).
    const signals: Partial<Record<MpSignalKey, string>> = {}
    const signal = (key: MpSignalKey, col: MpColumn) => {
      const v = text(get(col))
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

    // Qué es.
    let channel: MpChannel
    let payoutLast4: string | null = null
    let payoutIsOwn: boolean | null = null
    let fromOwnCuit: boolean | null = null
    const kind = channelOfDescription(description)
    if (kind === 'payment') {
      if (has('PAYER_ID_NUMBER')) {
        const payerType = text(get('PAYER_ID_TYPE')).toUpperCase()
        const payer = digitsOnly(text(get('PAYER_ID_NUMBER')))
        fromOwnCuit = sasCuit !== '' && payer !== '' && payer === sasCuit && payerType !== 'DNI'
      }
      const detected = paymentChannel(signals)
      channel = detected ?? 'other'
      if (detected === null) add('review', 'mp_channel_unknown')
    } else if (kind === 'payout') {
      const account = digitsOnly(text(get('PAYOUT_BANK_ACCOUNT_NUMBER')))
      if (account !== '') {
        payoutLast4 = account.slice(-4)
        payoutIsOwn = ownCbus.has(account)
      } else {
        add('review', 'mp_payout_unknown_account', { field: 'PAYOUT_BANK_ACCOUNT_NUMBER' })
      }
      channel = payoutIsOwn ? 'payout_own' : 'payout_third'
    } else if (kind === null) {
      channel = 'other'
      unknown.add(description.slice(0, 80))
      add('review', 'mp_unknown_description', { field: 'DESCRIPTION' })
    } else {
      channel = kind
    }
    if (REVIEW_DESCRIPTIONS.has(description.toLowerCase())) add('review', 'mp_needs_review')

    // Pares de reserva: se compensan por SOURCE_ID.
    const sourceId = text(get('SOURCE_ID'))
    if (channel === 'reserve') {
      const k = sourceId || description
      reserves.set(k, (reserves.get(k) ?? 0) + (credit - debit))
    }

    // Saldo corrido.
    const signed = credit - debit
    movementsSum += signed
    if (balance !== null) {
      chainSeen = true
      if (prevBalance !== null && prevBalance + signed !== balance) {
        balanceMismatchRows.push(rowNo)
        add('review', 'mp_balance_chain', { cents: balance - (prevBalance + signed) })
      }
      prevBalance = balance
    } else if (prevBalance !== null) {
      prevBalance += signed
    }

    const rowKey = `mp:${sha256HexSync(
      [
        sourceId,
        description,
        recordType,
        releasedAt ?? rawDate,
        String(credit),
        String(debit),
        gross === null ? '' : String(gross),
      ].join('|'),
    )}`
    if (seen.has(rowKey)) add('review', 'mp_duplicate_row')
    seen.add(rowKey)

    const externalReference = text(get('EXTERNAL_REFERENCE'))
    const item: MpItem = {
      kind: 'mp',
      rowKey,
      sourceId: sourceId === '' ? null : sourceId.slice(0, 64),
      recordType: recordType.slice(0, 40),
      description: description.slice(0, 80),
      releasedAt: releasedAt as string,
      approvedAt,
      releaseDate: releaseDate as IsoDate,
      businessDate: (businessDate ?? releaseDate) as IsoDate,
      netCredit: credit,
      netDebit: debit,
      gross: gross ?? credit - debit,
      mpFee,
      financingFee,
      shippingFee,
      couponCents,
      taxes,
      taxesDetail,
      balanceAfter: balance,
      channel,
      signals,
      payoutLast4,
      payoutIsOwn,
      fromOwnCuit,
      externalReference: externalReference === '' ? null : externalReference.slice(0, 80),
    }
    const day = item.businessDate
    if (from === null || day < from) from = day
    if (to === null || day > to) to = day
    items.push({ row: rowNo, key: rowKey, item, issues })
  }

  // Controles del archivo.
  if (initialBalance === null) fileIssues.push(issue('review', 'mp_no_initial', null))
  if (finalBalance === null) fileIssues.push(issue('review', 'mp_no_total', null))
  let total: MpFileChecks['total'] = 'unavailable'
  let totalDiffCents: Cents | null = null
  if (initialBalance !== null && finalBalance !== null) {
    // La fila `total` es el saldo final (inicial + movimientos). Si en algún
    // reporte trajera solo la suma de los movimientos, también cierra (A CONFIRMAR
    // con el primer reporte real de HUB).
    if (finalBalance === movementsSum && initialBalance !== 0)
      finalBalance = initialBalance + movementsSum
    totalDiffCents = finalBalance - (initialBalance + movementsSum)
    total = totalDiffCents === 0 ? 'ok' : 'mismatch'
    if (totalDiffCents !== 0) {
      fileIssues.push(issue('review', 'mp_total_mismatch', null, { cents: totalDiffCents }))
    }
  }
  let openReserveCents = 0
  for (const v of reserves.values()) openReserveCents += v
  if (openReserveCents !== 0) {
    fileIssues.push(issue('info', 'mp_open_reserve', null, { cents: openReserveCents }))
  }

  return {
    ok: true,
    layout: 'mp_release',
    headerRow: header.index + 1,
    decimal,
    items,
    rowErrors,
    fileIssues,
    initialBalance,
    finalBalance,
    period: from !== null && to !== null ? { from, to } : null,
    fileChecks: {
      total,
      totalDiffCents,
      balanceChain: chainSeen
        ? balanceMismatchRows.length === 0
          ? 'ok'
          : 'mismatch'
        : 'unavailable',
      balanceMismatchRows,
      rowCheckFailures,
      openReserveCents,
    },
    unknownDescriptions: [...unknown],
  }
}
