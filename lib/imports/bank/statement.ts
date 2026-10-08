/**
 * Extracto bancario (CSV, TXT, XLSX o HTML) → movimientos normalizados
 * (diseño §4.3.1–§4.3.2, `banco.md` §3).
 *
 * El formato de Nación Empresa 24 y de BNA+ Empresas está A CONFIRMAR con una
 * exportación real, así que nada está atado a un layout fijo:
 * - la fila de títulos se busca en las primeras 40 con sinónimos (`fecha`,
 *   `descripción`, `comprobante`, `débito`, `crédito`, `importe`, `D/C`, `saldo`…);
 *   si no se reconoce, `needsMapping` y la pantalla pregunta qué es cada columna
 *   (el mapeo se guarda con la firma de los títulos: `candidateSignatures`);
 * - los metadatos de antes de los títulos (CBU, cuenta, CUIT, moneda) se leen;
 * - el separador decimal se decide por archivo;
 * - débito o crédito por los cuatro casos de §3.4 (dos columnas, signo, columna
 *   D/C o diferencia de saldo). **Nunca por el texto**, salvo como último
 *   recurso y marcando la fila para revisar;
 * - el saldo se verifica fila por fila con 1 centavo de tolerancia; si no
 *   cierra, NO frena: la fila queda con aviso;
 * - un extracto del más nuevo al más viejo se da vuelta;
 * - los movimientos pendientes (provisorios) se saltean;
 * - la huella de cada fila es `sha256(fecha|importe|descripción normalizada|
 *   comprobante|saldo)` más un ordinal para filas idénticas del mismo día.
 */

import { parseCuit } from '@/lib/fiscal/cuit'
import { type DecimalMark, detectDecimalMark, parseAmount } from '../amounts'
import { isBlankRow } from '../csv'
import { toIsoDay } from '../dates'
import { sha256HexSync } from '../hash'
import { findHeaderRow, type HeaderRule, headerSignature, normalizeHeader } from '../headers'
import {
  type BankDirection,
  type BankItem,
  type Cell,
  type Cents,
  type ImportIssue,
  type ImportIssueCode,
  type ImportRow,
  type IsoDate,
  type IssueLevel,
  issue,
} from '../types'

// ─── Columnas ────────────────────────────────────────────────────────────────

export type BankColumn =
  | 'date'
  | 'valueDate'
  | 'description'
  | 'voucher'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'dc'
  | 'balance'
  | 'status'
  | 'counterpartyCuit'
  | 'counterpartyName'
  | 'reference'

export const BANK_COLUMNS: readonly BankColumn[] = [
  'date',
  'valueDate',
  'description',
  'voucher',
  'debit',
  'credit',
  'amount',
  'dc',
  'balance',
  'status',
  'counterpartyCuit',
  'counterpartyName',
  'reference',
]

/** Sinónimos de `banco.md` §3.2 sobre el título normalizado (`normalizeHeader`). */
export const BANK_HEADER_RULES: readonly HeaderRule<BankColumn>[] = [
  [/^(fecha valor|f valor|fec valor|valor fecha)$/, 'valueDate'],
  [
    /^(fecha|fechas|fecha mov|fecha movimiento|fecha (operacion|op|oper|transaccion|contable|proceso|imputacion|origen)|f (operacion|op|mov)|fec|fec mov|dia)$/,
    'date',
  ],
  [/^(referencia unica|id transferencia|codigo transferencia|id coelsa)$/, 'reference'],
  [
    /^(descripcion|concepto|detalle|movimientos?|leyenda|descripcion movimiento|concepto movimiento|detalle movimiento|operacion|transaccion|glosa)$/,
    'description',
  ],
  [
    /^(comprobante|comprob|nro comprobante|n comprobante|numero comprobante|referencia|ref|nro referencia|nro operacion|numero operacion|n operacion|numero|nro|n|cheque|nro cheque|n cheque|codigo|cod)$/,
    'voucher',
  ],
  [/^(debitos?|debe|egresos?|cargos?|importe debito|salidas?|retiros?)$/, 'debit'],
  [/^(creditos?|haber|ingresos?|abonos?|importe credito|entradas?|depositos?)$/, 'credit'],
  [
    /^(importe|monto|valor|importe movimiento|monto movimiento|importe en|importe en pesos|importe pesos|monto en pesos|importe ars)$/,
    'amount',
  ],
  [
    /^(d\/c|deb\/cred|db\/cr|d\/h|debito\/credito|debe\/haber|tipo|signo|tipo movimiento|tipo operacion|d c|dc|naturaleza|sentido)$/,
    'dc',
  ],
  [
    /^(saldos?|saldo parcial|saldo actual|saldo cuenta|saldo contable|saldo disponible|saldo final)$/,
    'balance',
  ],
  [/^(estado|situacion|estado movimiento)$/, 'status'],
  [
    /^(cuit|cuil|cuit cuil|cuit\/cuil|cuit contraparte|cuit ordenante|cuit originante|cuit beneficiario|cuit destinatario|cuit tercero)$/,
    'counterpartyCuit',
  ],
  [
    /^(ordenante|beneficiario|destinatario|contraparte|razon social|titular contraparte|nombre contraparte|tercero)$/,
    'counterpartyName',
  ],
]

/** Fecha + descripción + (importe, o débito y crédito). */
export function isBankHeader(cols: Partial<Record<BankColumn, number>>): boolean {
  return (
    cols.date !== undefined &&
    cols.description !== undefined &&
    (cols.amount !== undefined || (cols.debit !== undefined && cols.credit !== undefined))
  )
}

// ─── Mapeo guardado (`acc_import_layouts.mapping`) ───────────────────────────

/** Qué es cada columna y dónde están los títulos (lo que se guarda por formato). */
export type BankLayout = {
  /** Índice (desde 0) de la fila de títulos. */
  readonly headerRow: number
  readonly columns: Readonly<Partial<Record<BankColumn, number>>>
  /** `null` = decidirlo con los valores del archivo. */
  readonly decimal: DecimalMark | null
  readonly dateOrder: 'dmy' | 'mdy'
}

const MAPPING_KEYS: Readonly<Record<BankColumn, string>> = {
  date: 'date',
  valueDate: 'value_date',
  description: 'description',
  voucher: 'voucher',
  debit: 'debit',
  credit: 'credit',
  amount: 'amount',
  dc: 'dc',
  balance: 'balance',
  status: 'status',
  counterpartyCuit: 'counterparty_cuit',
  counterpartyName: 'counterparty_name',
  reference: 'reference',
}

/** `BankLayout` → el JSON de `acc_import_layouts.mapping` (`{date: 0, …, header_row: 3, decimal: ','}`). */
export function layoutToMapping(layout: BankLayout): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {
    header_row: layout.headerRow,
    decimal: layout.decimal,
    date_order: layout.dateOrder,
  }
  for (const col of BANK_COLUMNS) {
    const j = layout.columns[col]
    if (j !== undefined) out[MAPPING_KEYS[col]] = j
  }
  return out
}

/** El JSON guardado → `BankLayout`, validado. `null` si no sirve. */
export function mappingToLayout(json: unknown): BankLayout | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const rec = json as Record<string, unknown>
  const idx = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 512 ? v : null
  const headerRow = idx(rec.header_row)
  if (headerRow === null) return null
  const columns: Partial<Record<BankColumn, number>> = {}
  for (const col of BANK_COLUMNS) {
    const j = idx(rec[MAPPING_KEYS[col]])
    if (j !== null) columns[col] = j
  }
  if (!isBankHeader(columns)) return null
  const decimal = rec.decimal === ',' || rec.decimal === '.' ? rec.decimal : null
  return { headerRow, columns, decimal, dateOrder: rec.date_order === 'mdy' ? 'mdy' : 'dmy' }
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** Mayúsculas, sin tildes y con los espacios colapsados: lo que miran las reglas y la huella. */
export function normalizeBankDescription(s: Cell | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[  ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** CBU o CVU: 22 dígitos con los dos verificadores (pesos 7,1,3,9 y 3,9,7,1). */
export function isValidCbu(input: string): boolean {
  const d = input.replace(/\D/g, '')
  if (d.length !== 22) return false
  const check = (digits: string, weights: readonly number[]) => {
    let sum = 0
    for (let i = 0; i < digits.length; i++)
      sum += Number(digits[i]) * (weights[i % weights.length] ?? 0)
    return (10 - (sum % 10)) % 10
  }
  return (
    check(d.slice(0, 7), [7, 1, 3, 9]) === Number(d[7]) &&
    check(d.slice(8, 21), [3, 9, 7, 1]) === Number(d[21])
  )
}

const CUIT_IN_TEXT = /(?:^|\D)((?:20|23|24|25|26|27|30|33|34)-?\d{8}-?\d)(?=\D|$)/g

/** La primera CUIT válida (con dígito verificador) en un texto. */
export function findCuit(text: string): string | null {
  CUIT_IN_TEXT.lastIndex = 0
  for (let m = CUIT_IN_TEXT.exec(text); m !== null; m = CUIT_IN_TEXT.exec(text)) {
    const parsed = parseCuit(m[1] ?? '')
    if (parsed.ok) return parsed.cuit
  }
  return null
}

/** Clave natural de un movimiento: `bank:<caja>:<huella>:<ordinal>`. */
export function bankNaturalKey(
  treasuryAccountId: string,
  item: Pick<BankItem, 'fingerprint' | 'ordinal'>,
): string {
  return `bank:${treasuryAccountId}:${item.fingerprint}:${item.ordinal}`
}

function cellText(v: Cell | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()
  const formula = /^="(.*)"$/.exec(s)
  return formula ? (formula[1] ?? '') : s
}

/** `D`, `DB`, `Débito`, `-` → −1; `C`, `CR`, `Crédito`, `H`, `+` → +1. */
function dcSign(v: Cell | undefined): 1 | -1 | null {
  const raw = cellText(v)
  if (raw === '-' || raw === '−') return -1
  if (raw === '+') return 1
  const s = normalizeHeader(raw)
  if (/^(c|cr|cred|credito|creditos|h|haber|ingreso|abono|acreditacion)$/.test(s)) return 1
  if (/^(d|db|deb|debito|debitos|debe|egreso|cargo|debitacion)$/.test(s)) return -1
  return null
}

/** Último recurso (`banco.md` §3.4): prefijos de crédito de BNA. Siempre a revisión. */
function creditByText(description: string): boolean {
  return /^(CR\b|CR[.-]|CRED|LIQ\b|ACRED|DEPOSITO|DEP\.|TRANSF(ERENCIA)?\.? RECIB)/.test(
    description,
  )
}

/** Lo que dicen las líneas de antes de los títulos (CBU, cuenta, CUIT, moneda). */
export type BankStatementMeta = {
  readonly cbu: string | null
  readonly accountNumber: string | null
  readonly cuit: string | null
  readonly currency: 'ARS' | 'USD' | null
}

function readMeta(rows: readonly (readonly Cell[])[]): BankStatementMeta {
  const text = rows
    .flat()
    .map((c) => (c === null ? '' : String(c)))
    .join(' ')
  const joined = text.replace(/(\d)[\s-](?=\d)/g, '$1')
  let cbu: string | null = null
  for (const m of joined.matchAll(/\d{22}/g)) {
    if (isValidCbu(m[0])) {
      cbu = m[0]
      break
    }
  }
  const account = /cuenta[^\d\n]{0,30}?(\d[\d/-]{4,24}\d)/i.exec(text)
  const accountNumber = account ? (account[1] ?? '').replace(/\D/g, '') || null : null
  const cuit = findCuit(text)
  const currency = /\b(u\$s|usd|us\$|d[oó]lar(es)?)\b/i.test(text)
    ? 'USD'
    : /(\$|\bars\b|\bpesos\b)/i.test(text)
      ? 'ARS'
      : null
  return { cbu, accountNumber, cuit, currency }
}

/**
 * Firmas de las primeras filas, para buscar un mapeo guardado cuando los
 * títulos no se reconocen solos: `firma → índice`.
 */
export function candidateSignatures(
  rows: readonly (readonly Cell[])[],
  delimiter: string,
  maxScan = 40,
): Array<{ index: number; signature: string }> {
  const out: Array<{ index: number; signature: string }> = []
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const row = rows[i] ?? []
    if (row.filter((c) => cellText(c) !== '').length >= 2) {
      out.push({ index: i, signature: headerSignature(row, delimiter) })
    }
  }
  return out
}

/** Si no se reconocen los títulos: la fila que parece de títulos (la anterior a la primera con fecha). */
function guessHeaderRow(rows: readonly (readonly Cell[])[], maxScan = 40): number | null {
  for (let i = 1; i < Math.min(rows.length, maxScan); i++) {
    const row = rows[i] ?? []
    if (row.some((c) => toIsoDay(typeof c === 'string' ? c.trim() : c) !== null)) {
      const prev = rows[i - 1] ?? []
      return prev.filter((c) => cellText(c) !== '').length >= 2 ? i - 1 : null
    }
  }
  return null
}

// ─── Resultado ───────────────────────────────────────────────────────────────

export type BankStatementOptions = {
  /** La caja del extracto (`acc_treasury_accounts.id`): va en la clave natural. */
  readonly treasuryAccountId: string
  /** Separador del CSV o contenedor (`xlsx`, `html`): va en la firma del formato. */
  readonly delimiter?: string
}

export type BankBalanceCheck = {
  readonly status: 'ok' | 'mismatch' | 'unavailable'
  readonly mismatchRows: readonly number[]
  readonly opening: Cents | null
  readonly closing: Cents | null
  /** Cómo venía el archivo (los movimientos salen siempre del más viejo al más nuevo). */
  readonly order: 'asc' | 'desc'
}

export type BankParseResult = {
  readonly ok: boolean
  /** No se reconocieron las columnas: hay que mapearlas (y `items` viene vacío). */
  readonly needsMapping: boolean
  /** Si hay que mapear, la fila que parece de títulos (índice desde 0). */
  readonly candidateHeaderRow: number | null
  readonly layout: BankLayout | null
  readonly layoutSignature: string | null
  /** `acc_import_batches.detected_format`: `bank:<firma>`. */
  readonly detectedFormat: string | null
  readonly direction: BankDirection | null
  readonly items: readonly ImportRow<BankItem>[]
  readonly rowErrors: readonly ImportIssue[]
  readonly fileIssues: readonly ImportIssue[]
  readonly balanceCheck: BankBalanceCheck
  readonly meta: BankStatementMeta
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null
}

type Pending = {
  rowNo: number
  date: IsoDate
  valueDate: IsoDate | null
  description: string
  voucher: string | null
  /** Con signo si el modo lo da; si no, sin signo (lo resuelve la diferencia de saldo). */
  amount: Cents
  balance: Cents | null
  counterpartyCuit: string | null
  counterpartyName: string | null
  reference: string | null
  issues: ImportIssue[]
  direction: BankDirection
}

const STOP_RE = /^(saldo final|saldo al cierre|total(es)?\b|subtotal|fin (de )?resumen)/i
const OPENING_RE = /^(saldo anterior|saldo inicial|saldo al inicio)/i
const SKIP_RE = /^(transporte|saldo transportado|de transporte)/i
const PENDING_RE = /pend|provis|del dia|no conform|en proceso/i

/**
 * Lee las filas crudas de un extracto. Con `layout` (un mapeo guardado) usa ese;
 * si no, busca los títulos. Nunca tira.
 */
export function parseBankStatement(
  rows: readonly (readonly Cell[])[],
  layout: BankLayout | null | undefined,
  opts: BankStatementOptions,
): BankParseResult {
  const unavailable: BankBalanceCheck = {
    status: 'unavailable',
    mismatchRows: [],
    opening: null,
    closing: null,
    order: 'asc',
  }
  let resolved: BankLayout | null = layout ?? null
  if (!resolved) {
    const found = findHeaderRow(rows, BANK_HEADER_RULES, isBankHeader, 40)
    if (found)
      resolved = { headerRow: found.index, columns: found.columns, decimal: null, dateOrder: 'dmy' }
  }
  if (!resolved) {
    return {
      ok: false,
      needsMapping: true,
      candidateHeaderRow: guessHeaderRow(rows),
      layout: null,
      layoutSignature: null,
      detectedFormat: null,
      direction: null,
      items: [],
      rowErrors: [],
      fileIssues: [issue('error', 'bank_needs_mapping', null)],
      balanceCheck: unavailable,
      meta: readMeta(rows.slice(0, 40)),
      period: null,
    }
  }
  const L = resolved
  const cols = L.columns
  const signature = headerSignature(rows[L.headerRow] ?? [], opts.delimiter ?? 'csv')
  const meta = readMeta(rows.slice(0, L.headerRow))
  const fileIssues: ImportIssue[] = []
  if (meta.currency === 'USD') fileIssues.push(issue('review', 'bank_foreign_currency', null))

  const at = (raw: readonly Cell[], k: BankColumn): Cell => {
    const j = cols[k]
    return j === undefined ? null : (raw[j] ?? null)
  }
  const dataRows = rows.slice(L.headerRow + 1)

  // Decimal y orden de las fechas, por archivo.
  const amountCols: BankColumn[] = ['amount', 'debit', 'credit', 'balance']
  const decimal: DecimalMark =
    L.decimal ??
    detectDecimalMark(dataRows.slice(0, 1000).flatMap((r) => amountCols.map((k) => at(r, k)))) ??
    ','
  let dateOrder = L.dateOrder
  if (!layout) {
    for (const r of dataRows.slice(0, 1000)) {
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(cellText(at(r, 'date')))
      if (!m) continue
      if (Number(m[1]) > 12) {
        dateOrder = 'dmy'
        break
      }
      if (Number(m[2]) > 12) {
        dateOrder = 'mdy'
        break
      }
    }
  }

  // Modo para saber débito o crédito. Solo cuentan las filas de movimientos (con
  // fecha y que no son saldo anterior, transporte ni totales).
  const movementRows = dataRows.filter((r) => {
    const description = cellText(at(r, 'description'))
    if (OPENING_RE.test(description) || SKIP_RE.test(description) || STOP_RE.test(description)) {
      return false
    }
    const rawDate = at(r, 'date')
    return (
      toIsoDay(typeof rawDate === 'string' ? rawDate.trim() : rawDate, { order: dateOrder }) !==
      null
    )
  })
  // Una columna «Tipo» con el nombre de la operación («Transferencia») no es D/C:
  // se usa solo si casi todos sus valores lo son.
  const dcValues = movementRows.map((r) => cellText(at(r, 'dc'))).filter((v) => v !== '')
  const dcUsable =
    cols.dc !== undefined &&
    dcValues.length > 0 &&
    dcValues.filter((v) => dcSign(v) !== null).length >= dcValues.length * 0.8
  const twoColumns = cols.debit !== undefined && cols.credit !== undefined
  let mode: BankDirection
  if (twoColumns) mode = 'columns'
  else if (dcUsable) mode = 'dc'
  else {
    const anyNegative = movementRows.some((r) => {
      const a = parseAmount(at(r, 'amount'), decimal)
      return a.ok && a.cents < 0
    })
    mode = anyNegative ? 'sign' : cols.balance !== undefined ? 'balance_diff' : 'text'
  }

  const pending: Pending[] = []
  const rowErrors: ImportIssue[] = []
  let opening: Cents | null = null
  let blanks = 0
  let lastWasItem = false

  for (let i = 0; i < dataRows.length; i++) {
    const raw = dataRows[i] ?? []
    const rowNo = L.headerRow + 2 + i
    if (isBlankRow(raw)) {
      blanks++
      if (blanks >= 3 && pending.length > 0) break
      lastWasItem = false
      continue
    }
    blanks = 0
    const description = cellText(at(raw, 'description'))
    const firstText = cellText(raw.find((c) => cellText(c) !== '') ?? null)
    const rawDate = at(raw, 'date')
    const date = toIsoDay(typeof rawDate === 'string' ? rawDate.trim() : rawDate, {
      order: dateOrder,
    })
    const balanceRead = parseAmount(at(raw, 'balance'), decimal)
    const balance = balanceRead.ok ? balanceRead.cents : null

    if (OPENING_RE.test(description) || OPENING_RE.test(firstText)) {
      if (balance !== null) opening = balance
      else {
        const a = parseAmount(at(raw, 'amount'), decimal)
        if (a.ok) opening = a.cents
      }
      lastWasItem = false
      continue
    }
    if (SKIP_RE.test(description) || SKIP_RE.test(firstText)) continue
    if (date === null) {
      if (STOP_RE.test(description) || STOP_RE.test(firstText)) break
      const hasAmount = (['amount', 'debit', 'credit'] as const).some(
        (k) => cellText(at(raw, k)) !== '',
      )
      const last = pending[pending.length - 1]
      if (!hasAmount && description !== '' && last && lastWasItem) {
        // Descripción en dos renglones: se agrega a la fila anterior.
        last.description = `${last.description} ${description}`.slice(0, 240)
        continue
      }
      if (hasAmount) rowErrors.push(issue('error', 'bank_bad_date', rowNo, { field: 'date' }))
      lastWasItem = false
      continue
    }

    // Totales y saldos finales con fecha: no son movimientos.
    if (STOP_RE.test(description)) {
      lastWasItem = false
      continue
    }
    const status = cellText(at(raw, 'status'))
    if (status !== '' && PENDING_RE.test(normalizeHeader(status))) {
      fileIssues.push(issue('info', 'bank_pending_skipped', rowNo))
      lastWasItem = false
      continue
    }

    const issues: ImportIssue[] = []
    const add = (
      level: IssueLevel,
      code: ImportIssueCode,
      extra: { field?: string; cents?: Cents } = {},
    ) => issues.push(issue(level, code, rowNo, extra))

    let amount: Cents = 0
    let direction: BankDirection = mode
    if (mode === 'columns') {
      const d = parseAmount(at(raw, 'debit'), decimal)
      const c = parseAmount(at(raw, 'credit'), decimal)
      if ((!d.ok && d.reason !== 'empty') || (!c.ok && c.reason !== 'empty')) {
        add('error', 'bank_bad_amount', {
          field: !d.ok && d.reason !== 'empty' ? 'debit' : 'credit',
        })
      }
      const debit = d.ok ? Math.abs(d.cents) : 0
      const credit = c.ok ? Math.abs(c.cents) : 0
      if (debit !== 0 && credit !== 0) add('review', 'bank_both_sides')
      amount = credit - debit
    } else {
      const a = parseAmount(at(raw, 'amount'), decimal)
      if (!a.ok && a.reason !== 'empty') add('error', 'bank_bad_amount', { field: 'amount' })
      amount = a.ok ? a.cents : 0
      if (mode === 'dc') {
        const sign = dcSign(at(raw, 'dc'))
        amount = Math.abs(amount)
        if (sign === null) {
          add('review', 'bank_dc_unknown', { field: 'dc' })
          direction = cols.balance !== undefined ? 'balance_diff' : 'text'
        } else if (amount !== 0) {
          amount *= sign
        }
      } else if (mode !== 'sign') {
        amount = Math.abs(amount)
      }
    }
    if (issues.some((x) => x.level === 'error')) {
      rowErrors.push(...issues.filter((x) => x.level === 'error'))
      lastWasItem = false
      continue
    }
    if (amount === 0) {
      fileIssues.push(issue('info', 'bank_zero_amount', rowNo))
      lastWasItem = false
      continue
    }

    const cuitCell = cellText(at(raw, 'counterpartyCuit'))
    const counterpartyCuit = (cuitCell !== '' ? findCuit(cuitCell) : null) ?? findCuit(description)
    const name = cellText(at(raw, 'counterpartyName'))
    const voucher = cellText(at(raw, 'voucher'))
    const reference = cellText(at(raw, 'reference'))
    const rawValue = at(raw, 'valueDate')
    pending.push({
      rowNo,
      date,
      valueDate: toIsoDay(typeof rawValue === 'string' ? rawValue.trim() : rawValue, {
        order: dateOrder,
      }),
      description: description.slice(0, 240),
      voucher: voucher === '' ? null : voucher.slice(0, 40),
      amount,
      balance,
      counterpartyCuit,
      counterpartyName: name === '' ? null : name.slice(0, 120),
      reference: reference === '' ? null : reference.slice(0, 80),
      issues,
      direction,
    })
    lastWasItem = true
  }

  // ¿Del más nuevo al más viejo? Por fechas y, si son todas del mismo día, por el saldo.
  let order: 'asc' | 'desc' = 'asc'
  const first = pending[0]
  const last = pending[pending.length - 1]
  if (first && last && first.date > last.date) order = 'desc'
  else if (first && last && first.date === last.date && pending.length > 1) {
    const fits = (list: Pending[]) => {
      let ok = 0
      for (let k = 1; k < list.length; k++) {
        const prev = list[k - 1]?.balance
        const cur = list[k]
        if (prev === null || prev === undefined || !cur || cur.balance === null) continue
        if (Math.abs(prev + Math.abs(cur.amount) - cur.balance) <= 1) ok++
        else if (Math.abs(prev - Math.abs(cur.amount) - cur.balance) <= 1) ok++
      }
      return ok
    }
    if (fits([...pending].reverse()) > fits(pending)) order = 'desc'
  }
  if (order === 'desc') pending.reverse()

  // Sentido por diferencia de saldo (o por texto, a revisar) donde haga falta.
  let prevBalance: Cents | null = opening
  for (const p of pending) {
    if (p.direction === 'balance_diff' || p.direction === 'text') {
      const a = Math.abs(p.amount)
      let resolvedSign: 1 | -1 | null = null
      if (p.direction === 'balance_diff' && prevBalance !== null && p.balance !== null) {
        if (Math.abs(prevBalance + a - p.balance) <= 1) resolvedSign = 1
        else if (Math.abs(prevBalance - a - p.balance) <= 1) resolvedSign = -1
      }
      if (resolvedSign === null) {
        resolvedSign = creditByText(normalizeBankDescription(p.description)) ? 1 : -1
        p.direction = 'text'
        p.issues.push(issue('review', 'bank_direction_guess', p.rowNo))
      }
      p.amount = a * resolvedSign
    }
    prevBalance = p.balance ?? (prevBalance === null ? null : prevBalance + p.amount)
  }

  // Saldo fila por fila (1 centavo de tolerancia) y huella con ordinal.
  const mismatchRows: number[] = []
  const counts = new Map<string, number>()
  const items: ImportRow<BankItem>[] = []
  let chain: Cents | null = opening
  let anyBalance = false
  for (const p of pending) {
    let balanceOk: boolean | null = null
    if (p.balance !== null) {
      anyBalance = true
      if (chain !== null) {
        const diff = p.balance - (chain + p.amount)
        balanceOk = Math.abs(diff) <= 1
        if (!balanceOk) {
          mismatchRows.push(p.rowNo)
          p.issues.push(issue('review', 'bank_balance_mismatch', p.rowNo, { cents: diff }))
        }
      }
      chain = p.balance
    } else if (chain !== null) {
      chain += p.amount
    }
    const normalized = normalizeBankDescription(p.description)
    const fingerprint = sha256HexSync(
      [
        p.date,
        String(p.amount),
        normalized,
        p.voucher ?? '',
        p.balance === null ? '' : String(p.balance),
      ].join('|'),
    )
    const ordinal = counts.get(fingerprint) ?? 0
    counts.set(fingerprint, ordinal + 1)
    const item: BankItem = {
      kind: 'bank',
      date: p.date,
      valueDate: p.valueDate,
      description: p.description,
      voucher: p.voucher,
      amount: p.amount,
      balance: p.balance,
      counterpartyCuit: p.counterpartyCuit,
      counterpartyName: p.counterpartyName,
      reference: p.reference,
      ordinal,
      fingerprint,
      direction: p.direction,
      balanceOk,
    }
    items.push({
      row: p.rowNo,
      key: bankNaturalKey(opts.treasuryAccountId, item),
      item,
      issues: p.issues,
    })
  }

  const firstItem = items[0]?.item
  const lastItem = items[items.length - 1]?.item
  const openingBalance =
    opening ??
    (firstItem && firstItem.balance !== null ? firstItem.balance - firstItem.amount : null)
  return {
    ok: true,
    needsMapping: false,
    candidateHeaderRow: L.headerRow,
    layout: { ...L, decimal, dateOrder },
    layoutSignature: signature,
    detectedFormat: `bank:${signature}`,
    direction: mode,
    items,
    rowErrors,
    fileIssues,
    balanceCheck: {
      status: anyBalance ? (mismatchRows.length === 0 ? 'ok' : 'mismatch') : 'unavailable',
      mismatchRows,
      opening: openingBalance,
      closing: lastItem?.balance ?? null,
      order,
    },
    meta,
    period: firstItem && lastItem ? { from: firstItem.date, to: lastItem.date } : null,
  }
}
