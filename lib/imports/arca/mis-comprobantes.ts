/**
 * «Mis Comprobantes» de ARCA (Recibidos y Emitidos) y el CSV de compras de
 * Portal IVA → comprobantes normalizados (diseño §4.1, `arca-mis-comprobantes.md`).
 *
 * Es el port del prototipo `research/scripts/mc-parse.ts`, que se validó contra
 * 2.146 filas reales, con lo que le faltaba para producción:
 * - las tres generaciones del CSV (G1 hasta oct-2023, G2 hasta ago-2025, G3
 *   vigente), el Excel, la variante «del Emisor», Windows-1252 y el CSV
 *   «pasado por Excel» (fechas con barras, CAE en notación científica), que se
 *   marca para que la pantalla pida el ZIP original;
 * - la fila de títulos se BUSCA en las primeras 10 (el Excel trae un título);
 * - el separador decimal lo decide el archivo, no cada valor (G2 y G3: coma);
 * - importes a centavos sin `float`, positivos (las NC también: el sentido lo
 *   da el código) y el cuadre del total con el redondeo de ARCA;
 * - en G1 y G2 (un solo neto y un solo IVA) la alícuota se deduce del cociente;
 * - la clave natural `mc:R:<cuit emisor>:<código>:<pv>:<número>` con el CÓDIGO
 *   de ARCA (nunca la letra) y sin el CAE (los CAEA se repiten);
 * - avisos por fila sin copiar texto del archivo, y nada de datos de clientes
 *   (en Emitidos no se guarda el nombre del receptor ni su DNI).
 */

import { parseCuit } from '@/lib/fiscal/cuit'
import { type DecimalMode, parseAmount, parseDecimal } from '../amounts'
import { isBlankRow } from '../csv'
import { isSlashedDate, toIsoDay } from '../dates'
import {
  findHeaderRow,
  isMcHeader,
  MC_HEADER_RULES,
  type McColumn,
  normalizeHeader,
} from '../headers'
import {
  type Cell,
  type Cents,
  type ImportIssue,
  type ImportIssueCode,
  type ImportRow,
  type IsoDate,
  type IssueLevel,
  issue,
  type McGeneration,
  type McItem,
  type McKind,
  type McRateKey,
  type McVatRateKey,
  type PortalIvaTaxes,
} from '../types'

// ─── Tabla de comprobantes (TABLACOMPROBANTES.xls, ARCA, 29/12/2025) ─────────

/** Todos los códigos de la tabla oficial. Uno que no esté va a revisión. */
export const ARCA_VOUCHER_CODES: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54,
  55, 56, 57, 58, 59, 60, 61, 63, 64, 66, 80, 81, 82, 83, 88, 89, 90, 91, 99, 109, 110, 111, 112,
  113, 114, 115, 116, 117, 201, 202, 203, 206, 207, 208, 211, 212, 213, 331, 332, 991, 992, 993,
  994, 995, 997, 998,
])

/** Notas de crédito (los importes vienen positivos igual). */
export const CREDIT_NOTE_CODES: ReadonlySet<number> = new Set([
  3, 8, 13, 21, 38, 43, 44, 48, 53, 90, 110, 112, 113, 114, 203, 208, 213,
])

export const DEBIT_NOTE_CODES: ReadonlySet<number> = new Set([
  2, 7, 12, 20, 37, 45, 46, 47, 52, 115, 116, 117, 202, 207, 212,
])

/** Recibos: si son gasto o constancia de pago lo decide la contadora (A CONFIRMAR). */
export const RECEIPT_CODES: ReadonlySet<number> = new Set([4, 9, 15, 54])

// ─── Tipos del resultado ─────────────────────────────────────────────────────

/** `acc_import_batches.detected_format`. */
export type McLayout = 'mc_g3' | 'mc_g2' | 'mc_g1' | 'mc_xlsx' | 'portal_iva_compras'

export type McMeta = {
  /** Nombre del archivo (o del CSV dentro del ZIP): pista de Recibidos/Emitidos y CUIT de quien consultó. */
  fileName?: string | null
  /**
   * CUIT de la SAS (Ajustes › Datos de la SAS). En Recibidos valida que el
   * receptor sea la SAS; en Emitidos es el emisor.
   */
  sasCuit?: string | null
  /**
   * De dónde vienen las filas: `csv` (texto; el decimal lo fija la generación) o
   * `sheet` (Excel o HTML: celdas tipadas, decimal por valor). Default `csv`.
   */
  container?: 'csv' | 'sheet'
}

export type McStats = {
  /** Filas de datos con un tipo de comprobante (las que se pudieron leer y las que no). */
  readonly rows: number
  readonly items: number
  readonly errorRows: number
  readonly duplicateKeys: number
  readonly creditNotes: number
  readonly foreignCurrency: number
  /** Filas con IVA discriminado cuyo total difiere de las partes en más de $ 1. */
  readonly totalGapRows: number
  /** El mayor redondeo de ARCA (≤ $ 1) en filas con IVA discriminado. */
  readonly maxRoundingCents: number
}

export type McParseResult = {
  /** `false` si no se encontró la fila de títulos. */
  readonly ok: boolean
  readonly layout: McLayout | null
  readonly generation: McGeneration | null
  readonly kind: McKind | 'portal_iva_compras' | null
  /** Fila de títulos (desde 1). */
  readonly headerRow: number | null
  /** CUIT del título del Excel («Mis Comprobantes Recibidos - CUIT 30…»). */
  readonly titleCuit: string | null
  /** CUIT del nombre del archivo: la de QUIEN CONSULTÓ (puede ser la contadora). Solo informativo. */
  readonly fileNameCuit: string | null
  /** La CUIT receptora más repetida (Recibidos con columnas del receptor). */
  readonly receiverCuit: string | null
  /** Pasó por Excel: la pantalla pide el ZIP original. */
  readonly excelResaved: boolean
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null
  readonly items: readonly ImportRow<McItem>[]
  /** Avisos de las filas que no se pudieron leer (no están en `items`). */
  readonly rowErrors: readonly ImportIssue[]
  readonly fileIssues: readonly ImportIssue[]
  /** Solo Portal IVA: el desglose de «Otros Tributos» por clave natural. */
  readonly portalIvaTaxes: Readonly<Record<string, PortalIvaTaxes>>
  readonly stats: McStats
}

// ─── Valores ─────────────────────────────────────────────────────────────────

/** `1 - Factura A`, `1`, `1.0` o el número 1 → 1. */
export function toVoucherCode(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v < 1000 ? v : null
  const m = /^(\d{1,3})(?:\.0+)?(?:\s*-.*)?$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) : null
}

const DOC_TYPES: Readonly<Record<string, number>> = {
  cuit: 80,
  cuil: 86,
  cdi: 87,
  le: 89,
  lc: 90,
  pasaporte: 94,
  dni: 96,
  otro: 99,
  'sin identificar': 99,
}

/** `80`, `'80'`, `'CUIT'` o `'DNI'` → código de tipo de documento de ARCA. */
export function toDocType(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null
  const s = String(v ?? '').trim()
  if (s === '') return null
  const m = /^(\d{1,2})(?:\.0+)?$/.exec(s) ?? /^(\d{1,2})\b/.exec(s)
  if (m) return Number(m[1])
  return DOC_TYPES[normalizeHeader(s)] ?? null
}

/** Entero de un punto de venta o número: `'00003'`, `3`, `'3.0'`. */
function toInt(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null
  const s = String(v ?? '').trim()
  const m = /^(\d{1,9})(?:\.0+)?$/.exec(s)
  return m ? Number(m[1]) : null
}

/** Solo los dígitos de un documento (`'30-71234567-1'`, `30712345671`). */
function docDigits(v: Cell | undefined): string {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? String(v) : ''
  return String(v ?? '').replace(/\D/g, '')
}

/** `$`, `PES`, `ARS` → ARS; `USD`, `DOL`, `U$S` → USD; `EUR`/`060` → EUR. Lo demás, crudo. */
export function normalizeCurrency(v: Cell | undefined): { code: string; known: boolean } {
  const s = String(v ?? '')
    .trim()
    .toUpperCase()
  if (s === '' || s === '$' || s === 'PES' || s === 'ARS') return { code: 'ARS', known: true }
  if (s === 'USD' || s === 'DOL' || s === 'U$S' || s === 'US$' || s === 'U$D' || s === 'U$') {
    return { code: 'USD', known: true }
  }
  if (s === 'EUR' || s === '060') return { code: 'EUR', known: true }
  return { code: s.slice(0, 10), known: false }
}

/** CUIT válida de 11 dígitos en un texto (título del Excel), o `null`. */
function cuitIn(text: string): string | null {
  const re = /(?:^|\D)(\d{2}-?\d{8}-?\d)(?=\D|$)/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const parsed = parseCuit(m[1] ?? '')
    if (parsed.ok) return parsed.cuit
  }
  return null
}

/** Del nombre `comprobantes_consulta_csv_recibidos_{id}_{CUIT}_{fecha}.zip`: la CUIT de quien consultó. */
function fileNameInfo(name: string): { kind: McKind | null; cuit: string | null } {
  const m = /comprobantes_consulta_(?:csv|xls|xlsx)_(recibidos|emitidos)_\d+_(\d{11})_/i.exec(name)
  if (m) {
    const parsed = parseCuit(m[2] ?? '')
    return {
      kind: (m[1] ?? '').toLowerCase() as McKind,
      cuit: parsed.ok ? parsed.cuit : null,
    }
  }
  const lower = name.toLowerCase()
  return {
    kind: lower.includes('recibid') ? 'recibidos' : lower.includes('emitid') ? 'emitidos' : null,
    cuit: null,
  }
}

const SCIENTIFIC = /^\d+(?:[.,]\d+)?e[+-]?\d+$/i

/** CAE/CAEA de 14 dígitos; `'damaged'` si vino en notación científica (pasó por Excel). */
function readAuthCode(v: Cell | undefined): string | null | 'damaged' {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    return Number.isSafeInteger(v) && String(v).length === 14 ? String(v) : 'damaged'
  }
  const s = v === true || v === false ? '' : String(v).trim()
  if (s === '') return null
  if (SCIENTIFIC.test(s)) return 'damaged'
  const digits = s.replace(/\s/g, '')
  return /^\d{14}$/.test(digits) ? digits : 'damaged'
}

// ─── Columnas ────────────────────────────────────────────────────────────────

const RATE_NET: ReadonlyArray<readonly [McRateKey, McColumn]> = [
  ['r0', 'neto_0'],
  ['r25', 'neto_2_5'],
  ['r5', 'neto_5'],
  ['r105', 'neto_10_5'],
  ['r21', 'neto_21'],
  ['r27', 'neto_27'],
]

const RATE_VAT: ReadonlyArray<readonly [McVatRateKey, McColumn]> = [
  ['r25', 'iva_2_5'],
  ['r5', 'iva_5'],
  ['r105', 'iva_10_5'],
  ['r21', 'iva_21'],
  ['r27', 'iva_27'],
]

/** Alícuotas en puntos básicos, en el orden en que se prueban (las comunes primero). */
const RATE_BP: ReadonlyArray<readonly [McVatRateKey, number]> = [
  ['r21', 2100],
  ['r105', 1050],
  ['r27', 2700],
  ['r5', 500],
  ['r25', 250],
]

const PORTAL_TAXES: ReadonlyArray<readonly [keyof PortalIvaTaxes, McColumn]> = [
  ['vatComputable', 'cf_computable'],
  ['percVat', 'perc_iva'],
  ['percIibb', 'perc_iibb'],
  ['percOtherNational', 'perc_otros_nac'],
  ['municipal', 'imp_municipales'],
  ['internal', 'imp_internos'],
]

const ZERO_NET: Readonly<Record<McRateKey, Cents>> = {
  r0: 0,
  r25: 0,
  r5: 0,
  r105: 0,
  r21: 0,
  r27: 0,
}
const ZERO_VAT: Readonly<Record<McVatRateKey, Cents>> = { r25: 0, r5: 0, r105: 0, r21: 0, r27: 0 }

/**
 * G1 y G2 traen un solo neto y un solo IVA. Si el IVA es el neto por una sola
 * alícuota (con tolerancia por el redondeo línea por línea: 0,5 % o 5 centavos),
 * esa es la alícuota. Si calzan dos o ninguna, no se adivina.
 */
export function inferVatRate(netTotal: Cents, vatTotal: Cents): McVatRateKey | 'r0' | null {
  if (netTotal <= 0) return null
  if (vatTotal === 0) return 'r0'
  const matches = RATE_BP.filter(([, bp]) => {
    const expected = Math.round((netTotal * bp) / 10000)
    const tolerance = Math.max(5, Math.round(expected * 0.005))
    return Math.abs(vatTotal - expected) <= tolerance
  })
  return matches.length === 1 ? (matches[0]?.[0] ?? null) : null
}

/** Suma de las partes de un comprobante (lo que tendría que dar el total). */
export function mcComponentsSum(it: McItem): Cents {
  return it.netTotal + it.nonTaxed + it.exempt + it.otherTaxes + it.vatTotal
}

/** ¿Discrimina IVA? (B, C y recibos C traen los componentes en cero). */
export function mcIsDiscriminated(it: McItem): boolean {
  return it.netTotal !== 0 || it.vatTotal !== 0
}

/** Clave natural (`acc_import_items.natural_key`). Siempre con el código de ARCA. */
export function mcNaturalKey(
  kind: McKind | 'portal_iva_compras',
  it: Pick<McItem, 'issuerCuit' | 'code' | 'pointOfSale' | 'number' | 'numberTo'>,
): string {
  return kind === 'emitidos'
    ? `mc:E:${it.code}:${it.pointOfSale}:${it.number}:${it.numberTo}`
    : `mc:R:${it.issuerCuit}:${it.code}:${it.pointOfSale}:${it.number}`
}

// ─── El parser ───────────────────────────────────────────────────────────────

function emptyResult(fileIssues: ImportIssue[]): McParseResult {
  return {
    ok: false,
    layout: null,
    generation: null,
    kind: null,
    headerRow: null,
    titleCuit: null,
    fileNameCuit: null,
    receiverCuit: null,
    excelResaved: false,
    period: null,
    items: [],
    rowErrors: [],
    fileIssues,
    portalIvaTaxes: {},
    stats: {
      rows: 0,
      items: 0,
      errorRows: 0,
      duplicateKeys: 0,
      creditNotes: 0,
      foreignCurrency: 0,
      totalGapRows: 0,
      maxRoundingCents: 0,
    },
  }
}

/**
 * Lee las filas crudas de un archivo de Mis Comprobantes (o de Portal IVA).
 * `rows` sale de `parseCsv` o de `readFirstSheet`. Nunca tira: lo que no se
 * entiende queda en `rowErrors` o `fileIssues`.
 */
export function parseMisComprobantes(
  rows: readonly (readonly Cell[])[],
  meta: McMeta = {},
): McParseResult {
  const header = findHeaderRow(rows, MC_HEADER_RULES, isMcHeader, 10)
  if (!header) return emptyResult([issue('error', 'mc_no_header', null)])
  const cols = header.columns
  const has = (k: McColumn) => cols[k] !== undefined

  const portal =
    has('cf_computable') || has('perc_iibb') || has('perc_iva') || has('perc_otros_nac')
  const perRate = RATE_NET.some(([, c]) => has(c)) || RATE_VAT.some(([, c]) => has(c))
  const generation: McGeneration = perRate ? 'g3' : has('otros_tributos') ? 'g2' : 'g1'
  const container = meta.container ?? 'csv'

  const titleText = rows
    .slice(0, header.index)
    .flat()
    .map((c) => (c === null ? '' : String(c)))
    .join(' ')
  const fromName = fileNameInfo(meta.fileName ?? '')
  const titleKind: McKind | null = /recibid/i.test(titleText)
    ? 'recibidos'
    : /emitid/i.test(titleText)
      ? 'emitidos'
      : null
  const kind: McKind | 'portal_iva_compras' = portal
    ? 'portal_iva_compras'
    : has('denom_emisor') || has('nro_doc_emisor')
      ? 'recibidos'
      : has('denom_receptor') || has('nro_doc_receptor')
        ? 'emitidos'
        : (titleKind ?? fromName.kind ?? 'recibidos')
  const layout: McLayout = portal
    ? 'portal_iva_compras'
    : container === 'sheet'
      ? 'mc_xlsx'
      : `mc_${generation}`
  const titleCuit = cuitIn(titleText)
  const sas = meta.sasCuit ? parseCuit(meta.sasCuit) : null
  const sasCuit = sas?.ok ? sas.cuit : null

  // El decimal lo decide el archivo: G2, G3 y Portal IVA usan coma; G1 y las
  // planillas, por valor.
  const decimal: DecimalMode = container === 'sheet' || generation === 'g1' ? 'auto' : ','
  const headerLength = (rows[header.index] ?? []).length

  const items: ImportRow<McItem>[] = []
  const rowErrors: ImportIssue[] = []
  const portalIvaTaxes: Record<string, PortalIvaTaxes> = {}
  const seen = new Set<string>()
  const receiverCounts = new Map<string, number>()
  let excelResaved = false
  let rowsRead = 0
  let errorRows = 0
  let duplicateKeys = 0
  let creditNotes = 0
  let foreignCurrency = 0
  let totalGapRows = 0
  let maxRoundingCents = 0
  let from: IsoDate | null = null
  let to: IsoDate | null = null

  for (let i = header.index + 1; i < rows.length; i++) {
    const raw = rows[i] ?? []
    if (isBlankRow(raw)) continue
    const rowNo = i + 1
    const get = (k: McColumn): Cell => {
      const j = cols[k]
      return j === undefined ? null : (raw[j] ?? null)
    }
    const issues: ImportIssue[] = []
    const add = (
      level: IssueLevel,
      code: ImportIssueCode,
      extra: { field?: string; cents?: Cents } = {},
    ) => issues.push(issue(level, code, rowNo, extra))

    const code = toVoucherCode(get('tipo'))
    if (code === null) {
      // Una fila sin tipo ni fecha es un pie (totales, una leyenda): se saltea.
      if (toIsoDay(get('fecha')) === null) continue
      rowsRead++
      errorRows++
      rowErrors.push(issue('error', 'mc_bad_type', rowNo, { field: 'tipo' }))
      continue
    }
    rowsRead++

    if (container === 'csv' && raw.length !== headerLength) {
      const extraBlank = raw.length > headerLength && isBlankRow(raw.slice(headerLength))
      if (!extraBlank) add('error', 'mc_column_count')
    }
    if (!ARCA_VOUCHER_CODES.has(code)) add('review', 'mc_unknown_code', { field: 'tipo' })

    // Fecha
    const rawDate = get('fecha')
    const issueDate = toIsoDay(rawDate)
    if (issueDate === null) add('error', 'mc_bad_date', { field: 'fecha' })
    else if (container === 'csv' && generation !== 'g1' && isSlashedDate(rawDate))
      excelResaved = true

    // Punto de venta y número (o «PPPPP-NNNNNNNN» en una sola columna).
    let pointOfSale = toInt(get('pto_vta'))
    let number = toInt(get('nro_desde'))
    if (number === null && has('nro_comprobante')) {
      const combined = String(get('nro_comprobante') ?? '').trim()
      const m = /^(\d{1,5})\s*-\s*(\d{1,8})$/.exec(combined)
      if (m) {
        pointOfSale ??= Number(m[1])
        number = Number(m[2])
      } else {
        number = toInt(combined)
      }
    }
    if (pointOfSale === null || pointOfSale > 99_999)
      add('error', 'mc_bad_pos', { field: 'pto_vta' })
    if (number === null || number < 1 || number > 99_999_999) {
      add('error', 'mc_bad_number', { field: 'nro_desde' })
    }
    const numberTo = has('nro_hasta') ? (toInt(get('nro_hasta')) ?? number) : number
    if (number !== null && numberTo !== null && numberTo !== number) {
      add(numberTo < number ? 'error' : 'review', 'mc_range', { field: 'nro_hasta' })
    }

    // CAE / CAEA
    const auth = readAuthCode(get('cod_aut'))
    if (auth === 'damaged') {
      add('review', 'mc_cae_damaged', { field: 'cod_aut' })
      if (container === 'csv' && SCIENTIFIC.test(String(get('cod_aut') ?? '').trim()))
        excelResaved = true
    }

    // Emisor y receptor
    let issuerCuit = ''
    let issuerName = ''
    let receiverDocType: number | null = null
    let receiverDoc: string | null = null
    if (kind === 'emitidos') {
      issuerCuit = sasCuit ?? titleCuit ?? ''
      receiverDocType = toDocType(get('tipo_doc_receptor'))
      const doc = docDigits(get('nro_doc_receptor'))
      // Un DNI de un cliente es un dato personal: solo se guarda una CUIT.
      receiverDoc = receiverDocType === 80 && doc.length === 11 ? doc : null
    } else {
      const digits = docDigits(get('nro_doc_emisor'))
      if (digits.length !== 11) {
        add('error', 'mc_bad_issuer', { field: 'nro_doc_emisor' })
      } else {
        issuerCuit = digits
        if (!parseCuit(digits).ok)
          add('review', 'mc_issuer_check_digit', { field: 'nro_doc_emisor' })
      }
      issuerName = String(get('denom_emisor') ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200)
      if (has('nro_doc_receptor')) {
        receiverDocType = toDocType(get('tipo_doc_receptor'))
        const doc = docDigits(get('nro_doc_receptor'))
        receiverDoc = doc === '' || doc.length > 11 ? null : doc
        if (receiverDoc !== null && (receiverDocType === 80 || receiverDocType === null)) {
          receiverCounts.set(receiverDoc, (receiverCounts.get(receiverDoc) ?? 0) + 1)
        }
        if (sasCuit && receiverDoc !== sasCuit)
          add('review', 'mc_receiver_mismatch', { field: 'nro_doc_receptor' })
      }
    }

    // Moneda y tipo de cambio
    const currency = normalizeCurrency(get('moneda'))
    if (!currency.known) add('review', 'mc_unknown_currency', { field: 'moneda' })
    if (currency.code !== 'ARS') add('review', 'mc_foreign_currency', { field: 'moneda' })
    const rawRate = get('tipo_cambio')
    const rateEmpty = rawRate === null || String(rawRate).trim() === ''
    let fxRate = rateEmpty ? '1' : parseDecimal(rawRate, decimal === ',' ? ',' : 'auto')
    if (fxRate === null || fxRate.startsWith('-') || /^0(\.0*)?$/.test(fxRate)) {
      if (currency.code === 'ARS') fxRate = '1'
      else {
        add('error', 'mc_bad_fx', { field: 'tipo_cambio' })
        fxRate = '1'
      }
    }

    // Importes
    let negative = false
    let rounded = false
    const amount = (k: McColumn): Cents => {
      const v = get(k)
      const r = parseAmount(v, decimal)
      if (!r.ok) {
        if (r.reason === 'empty') return 0
        add('error', 'mc_bad_amount', { field: k })
        if (r.reason === 'scientific' && container === 'csv') excelResaved = true
        return 0
      }
      if (r.rounded) rounded = true
      if (r.cents < 0) negative = true
      return Math.abs(r.cents)
    }
    const net: Record<McRateKey, Cents> = { ...ZERO_NET }
    const vat: Record<McVatRateKey, Cents> = { ...ZERO_VAT }
    let netTotal: Cents
    let vatTotal: Cents
    if (generation === 'g3') {
      for (const [rk, c] of RATE_NET) net[rk] = amount(c)
      for (const [rk, c] of RATE_VAT) vat[rk] = amount(c)
      const sumNet = Object.values(net).reduce((a, b) => a + b, 0)
      const sumVat = Object.values(vat).reduce((a, b) => a + b, 0)
      netTotal = has('neto_gravado_total') ? amount('neto_gravado_total') : sumNet
      vatTotal = has('iva_total') ? amount('iva_total') : sumVat
      if (sumNet !== netTotal) add('info', 'mc_net_sum', { cents: netTotal - sumNet })
      if (sumVat !== vatTotal) add('info', 'mc_vat_sum', { cents: vatTotal - sumVat })
    } else {
      netTotal = amount('neto_gravado_total')
      vatTotal = amount('iva_total')
      const rate = inferVatRate(netTotal, vatTotal)
      if (rate === 'r0') net.r0 = netTotal
      else if (rate !== null) {
        net[rate] = netTotal
        vat[rate] = vatTotal
      } else if (netTotal !== 0 || vatTotal !== 0) {
        add('review', 'mc_rate_unknown', { field: 'iva_total' })
      }
    }
    const nonTaxed = amount('no_gravado')
    const exempt = amount('exento')
    let otherTaxes = amount('otros_tributos')
    let portalTaxes: PortalIvaTaxes | null = null
    if (portal) {
      const t: Record<keyof PortalIvaTaxes, Cents> = {
        vatComputable: 0,
        percVat: 0,
        percIibb: 0,
        percOtherNational: 0,
        municipal: 0,
        internal: 0,
      }
      for (const [field, c] of PORTAL_TAXES) t[field] = amount(c)
      portalTaxes = t
      otherTaxes += t.percVat + t.percIibb + t.percOtherNational + t.municipal + t.internal
    }
    const total = amount('total')
    if (negative) add(portal ? 'info' : 'review', 'mc_negative_amount')
    if (rounded) add('info', 'mc_rounded_amount')

    // Cuadre: con IVA discriminado, total = partes ± el redondeo de ARCA.
    const discriminated = netTotal !== 0 || vatTotal !== 0
    if (discriminated) {
      const diff = total - (netTotal + nonTaxed + exempt + otherTaxes + vatTotal)
      if (diff > 100) add('review', 'mc_total_gap', { cents: diff })
      else if (diff < -100) add('review', 'mc_total_over', { cents: diff })
      else if (diff !== 0) add('info', 'mc_rounding', { cents: diff })
    } else {
      const undiscriminated = total - otherTaxes - exempt - nonTaxed
      if (undiscriminated < 0) add('review', 'mc_total_over', { cents: undiscriminated })
    }

    if (issues.some((x) => x.level === 'error')) {
      errorRows++
      rowErrors.push(...issues.filter((x) => x.level === 'error'))
      continue
    }

    const item: McItem = {
      kind: 'mc',
      issueDate: issueDate as IsoDate,
      code,
      pointOfSale: pointOfSale as number,
      number: number as number,
      numberTo: numberTo as number,
      authCode: auth === 'damaged' ? null : auth,
      issuerCuit,
      issuerName,
      receiverDocType,
      receiverDoc,
      currency: currency.code,
      fxRate,
      net,
      vat,
      netTotal,
      nonTaxed,
      exempt,
      otherTaxes,
      vatTotal,
      total,
      generation,
    }
    const key = mcNaturalKey(kind, item)
    if (seen.has(key)) {
      duplicateKeys++
      issues.push(issue('review', 'mc_duplicate_key', rowNo))
    }
    seen.add(key)

    // Estadísticas (las de `arca-mis-comprobantes.md` §9.5).
    if (CREDIT_NOTE_CODES.has(code)) creditNotes++
    if (currency.code !== 'ARS') foreignCurrency++
    if (discriminated) {
      const diff = Math.abs(total - (netTotal + nonTaxed + exempt + otherTaxes + vatTotal))
      if (diff > 100) totalGapRows++
      else if (diff > maxRoundingCents) maxRoundingCents = diff
    }
    if (from === null || item.issueDate < from) from = item.issueDate
    if (to === null || item.issueDate > to) to = item.issueDate
    if (portalTaxes) portalIvaTaxes[key] = portalTaxes
    items.push({ row: rowNo, key, item, issues })
  }

  // CUIT del archivo contra la de la SAS.
  let receiverCuit: string | null = null
  let best = 0
  for (const [doc, n] of receiverCounts) {
    if (n > best) {
      receiverCuit = doc
      best = n
    }
  }
  const fileIssues: ImportIssue[] = []
  if (excelResaved) fileIssues.push(issue('error', 'mc_excel_resaved', null))
  if (sasCuit && kind !== 'emitidos') {
    const titleMismatch = titleCuit !== null && titleCuit !== sasCuit
    const noReceiverMatch = receiverCounts.size > 0 && !receiverCounts.has(sasCuit)
    if (titleMismatch || noReceiverMatch) fileIssues.push(issue('error', 'mc_other_cuit', null))
  }

  return {
    ok: true,
    layout,
    generation,
    kind,
    headerRow: header.index + 1,
    titleCuit,
    fileNameCuit: fromName.cuit,
    receiverCuit,
    excelResaved,
    period: from !== null && to !== null ? { from, to } : null,
    items,
    rowErrors,
    fileIssues,
    portalIvaTaxes,
    stats: {
      rows: rowsRead,
      items: items.length,
      errorRows,
      duplicateKeys,
      creditNotes,
      foreignCurrency,
      totalGapRows,
      maxRoundingCents,
    },
  }
}
