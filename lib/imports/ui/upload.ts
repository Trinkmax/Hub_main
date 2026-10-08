/**
 * Del archivo que suelta la persona al plan de subida (diseño §4.0, primer
 * paso): se abre y se reconoce EN EL NAVEGADOR (`detectSource`, con
 * `DecompressionStream('deflate-raw')` para los ZIP), se parsea con el parser de
 * cada origen y se arma lo que va a viajar: el lote (`createImportBatch`, con su
 * `meta` en lista blanca) y las filas (`addImportItems`). Además, lo que se le
 * muestra antes de mandar nada: qué es, de qué período, cuántas filas y cuánta
 * plata.
 *
 * Puro (sin React): corre igual en el navegador y en los tests (con el
 * descompresor de Node). Nunca copia datos personales: los parsers ya los dejan
 * afuera y el `meta` solo lleva números y formatos.
 */

import { formatRange } from '@/lib/dates'
import {
  CREDIT_NOTE_CODES,
  type McParseResult,
  parseMisComprobantes,
} from '@/lib/imports/arca/mis-comprobantes'
import {
  type BankLayout,
  type BankParseResult,
  parseBankStatement,
} from '@/lib/imports/bank/statement'
import { detectSource, IMPORT_MAX_FILE_BYTES, type OpenedTable } from '@/lib/imports/detect'
import { type MpParseResult, parseReleaseReport } from '@/lib/imports/mercadopago/release'
import type { ImportBatchMeta } from '@/lib/imports/server/types'
import {
  type DetectedSource,
  IMPORT_ISSUE_TEXT,
  type ImportIssue,
  type InflateRaw,
  issueText,
} from '@/lib/imports/types'
import { formatCents } from '@/lib/money'
import { type StagedRowInput, toStagedRow } from './chunks'
import { IMPORT_SOURCE_COPY, type UiImportSource } from './labels'
import { count, formatCount } from './progress'

// ─── Abrir ───────────────────────────────────────────────────────────────────

export type OpenedFile =
  | { ok: true; table: OpenedTable; detected: DetectedSource }
  | { ok: false; message: string }

/** Abre el archivo y dice qué parece ser. Nunca tira por un archivo roto. */
export async function openImportFile(input: {
  bytes: Uint8Array
  fileName: string
  inflateRaw?: InflateRaw
}): Promise<OpenedFile> {
  if (input.bytes.length > IMPORT_MAX_FILE_BYTES) {
    return { ok: false, message: IMPORT_ISSUE_TEXT.file_too_big }
  }
  const result = await detectSource({
    bytes: input.bytes,
    fileName: input.fileName,
    ...(input.inflateRaw ? { inflateRaw: input.inflateRaw } : {}),
  })
  if (!result.table) {
    return {
      ok: false,
      message: result.issue ? issueText(result.issue) : IMPORT_ISSUE_TEXT.file_not_table,
    }
  }
  return { ok: true, table: result.table, detected: result.source }
}

/** De qué importador es cada cosa que reconoce `detectSource`. */
const DETECTED_HOME: Readonly<Partial<Record<DetectedSource, UiImportSource>>> = {
  arca_recibidos: 'arca_recibidos',
  mp_release: 'mp_release',
  bank: 'bank_statement',
}

export type WrongPlace = {
  message: string
  /** El importador correcto, si lo hay (la pantalla ofrece el link). */
  goTo: UiImportSource | null
}

/**
 * Si el archivo es de otro lado, por qué y adónde ir. `null` si sirve acá (o si
 * no se reconoce y el banco igual puede pedir las columnas).
 */
export function wrongPlace(expected: UiImportSource, detected: DetectedSource): WrongPlace | null {
  if (detected === 'arca_emitidos') {
    return {
      message:
        'Este archivo es de «Mis Comprobantes › Emitidos» (lo que facturaste vos). Acá van los «Recibidos»: las facturas que te hicieron tus proveedores.',
      goTo: expected === 'arca_recibidos' ? null : 'arca_recibidos',
    }
  }
  if (detected === 'portal_iva_compras') {
    return {
      message:
        'Este es el archivo de compras del «Portal IVA». Para importar compras usá el de «Mis Comprobantes › Recibidos» (el ZIP tal cual lo bajás).',
      goTo: expected === 'arca_recibidos' ? null : 'arca_recibidos',
    }
  }
  if (detected === 'mp_settlement') {
    return {
      message: IMPORT_ISSUE_TEXT.mp_settlement,
      goTo: expected === 'mp_release' ? null : 'mp_release',
    }
  }
  const home = DETECTED_HOME[detected] ?? null
  if (home === null) {
    if (expected === 'bank_statement') return null
    return {
      message:
        expected === 'arca_recibidos'
          ? 'No reconocemos este archivo. Subí el ZIP de «Mis Comprobantes › Recibidos» tal cual lo bajaste de ARCA, sin abrirlo con Excel.'
          : 'No reconocemos este archivo. Subí el CSV del reporte de «Liquidaciones» de Mercado Pago, sin abrirlo con Excel.',
      goTo: null,
    }
  }
  if (home === expected) return null
  return {
    message: `Este archivo es de ${IMPORT_SOURCE_COPY[home].title}: importalo desde su pantalla.`,
    goTo: home,
  }
}

// ─── El plan ─────────────────────────────────────────────────────────────────

export type UploadFact = {
  label: string
  value: string
  /** `warning`: algo para mirar (no frena). */
  tone?: 'default' | 'warning'
}

export type UploadPlan = {
  source: UiImportSource
  fileName: string
  fileSize: number
  detectedFormat: string | null
  periodFrom: string | null
  periodTo: string | null
  meta: ImportBatchMeta
  rows: StagedRowInput[]
  /** Lo que se le muestra antes de subir. */
  title: string
  facts: UploadFact[]
  /** Filas que no se pudieron leer (quedan afuera), con su texto. */
  rowErrors: string[]
  /** Avisos del archivo que no frenan (tildes arregladas, saldo que no cierra…). */
  notices: string[]
}

export type PlanResult =
  | { ok: true; plan: UploadPlan }
  | { ok: false; message: string; goTo?: UiImportSource | null }
  | { ok: false; needsMapping: true; candidateHeaderRow: number | null }

type FileInfo = { fileName: string; fileSize: number }

const MAX_META_ISSUES = 20

/** Avisos de archivo que pasan por el `meta` (solo los que no frenan, hasta 20). */
function metaIssues(issues: readonly ImportIssue[]): ImportIssue[] {
  return issues.filter((i) => i.level !== 'error').slice(0, MAX_META_ISSUES)
}

function firstError(issues: readonly ImportIssue[]): ImportIssue | null {
  return issues.find((i) => i.level === 'error') ?? null
}

function tableMeta(
  table: OpenedTable,
): Pick<ImportBatchMeta, 'container' | 'encoding' | 'delimiter'> {
  return {
    container: table.container,
    ...(table.encoding ? { encoding: table.encoding } : {}),
    ...(table.delimiter ? { delimiter: table.delimiter } : {}),
  }
}

function money(cents: number): string {
  return formatCents(cents, { decimals: 2 })
}

function periodFact(period: { from: string; to: string } | null): UploadFact[] {
  return period ? [{ label: 'Período', value: formatRange(period.from, period.to) }] : []
}

function rowErrorTexts(rowErrors: readonly ImportIssue[]): string[] {
  return rowErrors.map(issueText)
}

function safeName(name: string): string {
  return name.trim().slice(0, 200)
}

// ─── Mis Comprobantes (Recibidos) ────────────────────────────────────────────

export type ArcaContext = { sasCuit: string | null }

const MC_FORMAT_TEXT: Readonly<Record<string, string>> = {
  mc_g3: 'formato nuevo, con el IVA por alícuota',
  mc_g2: 'formato anterior (sin el IVA por alícuota)',
  mc_g1: 'formato viejo (sin el IVA por alícuota)',
  mc_xlsx: 'planilla de Excel',
}

export function planMisComprobantes(
  table: OpenedTable,
  file: FileInfo,
  ctx: ArcaContext,
): PlanResult {
  const parsed: McParseResult = parseMisComprobantes(table.rows, {
    fileName: table.entryName ?? file.fileName,
    sasCuit: ctx.sasCuit,
    container: table.cellKind,
  })
  if (!parsed.ok) {
    const err = firstError(parsed.fileIssues)
    return { ok: false, message: err ? issueText(err) : IMPORT_ISSUE_TEXT.mc_no_header }
  }
  if (parsed.kind === 'emitidos' || parsed.kind === 'portal_iva_compras') {
    const wrong = wrongPlace(
      'arca_recibidos',
      parsed.kind === 'emitidos' ? 'arca_emitidos' : 'portal_iva_compras',
    )
    return { ok: false, message: wrong?.message ?? IMPORT_ISSUE_TEXT.mc_no_header }
  }
  const blocking = firstError(parsed.fileIssues)
  if (blocking) {
    const message =
      blocking.code === 'mc_other_cuit'
        ? 'Este archivo es de otra CUIT: no son las compras de tu SAS. Bajá el de tu SAS (en ARCA, arriba tiene que decir que actuás en su representación).'
        : issueText(blocking)
    return { ok: false, message }
  }
  if (parsed.items.length === 0) {
    return {
      ok: false,
      message:
        parsed.rowErrors.length > 0
          ? `No pudimos leer ningún comprobante: ${rowErrorTexts(parsed.rowErrors.slice(0, 1)).join('')}`
          : 'El archivo no trae comprobantes. Revisá las fechas que elegiste en ARCA.',
    }
  }

  const items = parsed.items.map((r) => r.item)
  const pesos = items.filter((it) => it.currency === 'ARS')
  const totalArs = pesos.reduce(
    (acc, it) => acc + (CREDIT_NOTE_CODES.has(it.code) ? -it.total : it.total),
    0,
  )
  const suppliers = new Set(items.map((it) => it.issuerCuit)).size
  const otherCuit = parsed.items.filter((r) =>
    r.issues.some((i) => i.code === 'mc_receiver_mismatch'),
  ).length

  const facts: UploadFact[] = [
    {
      label: 'Qué es',
      value: `Mis Comprobantes · Recibidos (${MC_FORMAT_TEXT[parsed.layout ?? ''] ?? 'formato reconocido'})`,
    },
    ...periodFact(parsed.period),
    {
      label: 'Comprobantes',
      value:
        parsed.stats.creditNotes > 0
          ? `${formatCount(items.length)} (${count(parsed.stats.creditNotes, 'nota de crédito', 'notas de crédito')})`
          : formatCount(items.length),
    },
    { label: 'Proveedores distintos', value: formatCount(suppliers) },
    { label: 'Total en pesos', value: money(totalArs) },
  ]
  if (parsed.stats.foreignCurrency > 0) {
    facts.push({
      label: 'En moneda extranjera',
      value: `${formatCount(parsed.stats.foreignCurrency)}: los pasamos a pesos y te los mostramos para confirmar`,
      tone: 'warning',
    })
  }
  if (otherCuit > 0) {
    facts.push({
      label: 'A nombre de otra persona',
      value: `${formatCount(otherCuit)}: te vamos a preguntar si son tuyos`,
      tone: 'warning',
    })
  }

  const notices = parsed.fileIssues.filter((i) => i.level !== 'error').map(issueText)
  const meta: ImportBatchMeta = {
    ...(parsed.layout ? { layout: parsed.layout } : {}),
    ...(parsed.generation ? { generation: parsed.generation } : {}),
    titleCuit: parsed.titleCuit && /^\d{11}$/.test(parsed.titleCuit) ? parsed.titleCuit : null,
    headerRow: parsed.headerRow,
    ...tableMeta(table),
    rows: parsed.stats.rows,
    rowErrors: parsed.rowErrors.length,
    stats: {
      items: parsed.stats.items,
      creditNotes: parsed.stats.creditNotes,
      foreignCurrency: parsed.stats.foreignCurrency,
      duplicateKeys: parsed.stats.duplicateKeys,
      totalGapRows: parsed.stats.totalGapRows,
      errorRows: parsed.stats.errorRows,
    },
    fileIssues: metaIssues(parsed.fileIssues),
  }
  return {
    ok: true,
    plan: {
      source: 'arca_recibidos',
      fileName: safeName(file.fileName),
      fileSize: file.fileSize,
      detectedFormat: parsed.layout,
      periodFrom: parsed.period?.from ?? null,
      periodTo: parsed.period?.to ?? null,
      meta,
      rows: parsed.items.map(toStagedRow),
      title: `${count(items.length, 'comprobante', 'comprobantes')} de compras`,
      facts,
      rowErrors: rowErrorTexts(parsed.rowErrors),
      notices,
    },
  }
}

// ─── Mercado Pago (Liquidaciones) ────────────────────────────────────────────

export type MercadoPagoContext = {
  sasCuit: string | null
  /** CBU/CVU propios (para reconocer un retiro a tu cuenta). Solo viven en el navegador. */
  ownCbus: readonly string[]
  /** Corte del día: 0 = calendario, 5 = día de servicio. */
  cutoffHour: number
}

export function planMercadoPago(
  table: OpenedTable,
  file: FileInfo,
  ctx: MercadoPagoContext,
): PlanResult {
  const parsed: MpParseResult = parseReleaseReport(table.rows, {
    sasCuit: ctx.sasCuit,
    ownCbus: ctx.ownCbus,
    cutoffHour: ctx.cutoffHour,
  })
  if (!parsed.ok) {
    const err = firstError(parsed.fileIssues)
    return { ok: false, message: err ? issueText(err) : IMPORT_ISSUE_TEXT.mp_no_header }
  }
  const blocking = firstError(parsed.fileIssues)
  if (blocking) return { ok: false, message: issueText(blocking) }
  if (parsed.items.length === 0) {
    return {
      ok: false,
      message: 'El reporte no trae movimientos en esas fechas. Bajá uno con otro período.',
    }
  }
  const items = parsed.items.map((r) => r.item)
  const credit = items.reduce((acc, it) => acc + it.netCredit, 0)
  const debit = items.reduce((acc, it) => acc + it.netDebit, 0)
  const checks = parsed.fileChecks

  const facts: UploadFact[] = [
    { label: 'Qué es', value: 'Reporte de «Liquidaciones» de Mercado Pago' },
    ...periodFact(parsed.period),
    { label: 'Movimientos', value: formatCount(items.length) },
    { label: 'Entró a la cuenta', value: money(credit) },
    { label: 'Salió de la cuenta', value: money(debit) },
  ]
  if (parsed.initialBalance !== null && parsed.finalBalance !== null) {
    facts.push({
      label: 'Saldo según Mercado Pago',
      value: `${money(parsed.initialBalance)} al empezar · ${money(parsed.finalBalance)} al terminar`,
    })
  }
  if (checks.total === 'mismatch') {
    facts.push({
      label: 'Control del saldo',
      value: `No cierra${checks.totalDiffCents !== null ? ` por ${money(Math.abs(checks.totalDiffCents))}` : ''}: igual lo importamos y te lo marcamos para revisar`,
      tone: 'warning',
    })
  } else if (checks.total === 'ok') {
    facts.push({
      label: 'Control del saldo',
      value: 'El saldo inicial más los movimientos da el final',
    })
  }
  if (checks.rowCheckFailures > 0) {
    facts.push({
      label: 'Filas para mirar',
      value: `${formatCount(checks.rowCheckFailures)}: el bruto menos descuentos no da el neto`,
      tone: 'warning',
    })
  }
  if (checks.openReserveCents !== 0) {
    facts.push({
      label: 'Dinero retenido',
      value: `${money(Math.abs(checks.openReserveCents))} que Mercado Pago todavía no liberó`,
      tone: 'warning',
    })
  }

  const meta: ImportBatchMeta = {
    layout: 'mp_release',
    headerRow: parsed.headerRow,
    decimal: parsed.decimal,
    ...tableMeta(table),
    cutoffHour: ctx.cutoffHour,
    initialBalanceCents: parsed.initialBalance,
    finalBalanceCents: parsed.finalBalance,
    rows: items.length,
    rowErrors: parsed.rowErrors.length,
    checks: {
      total: checks.total,
      totalDiffCents: checks.totalDiffCents,
      balanceChain: checks.balanceChain,
      balanceMismatchRows: checks.balanceMismatchRows.length,
      rowCheckFailures: checks.rowCheckFailures,
      openReserveCents: checks.openReserveCents,
    },
    stats: { unknownDescriptions: parsed.unknownDescriptions.length },
    fileIssues: metaIssues(parsed.fileIssues),
  }
  return {
    ok: true,
    plan: {
      source: 'mp_release',
      fileName: safeName(file.fileName),
      fileSize: file.fileSize,
      detectedFormat: 'mp_release',
      periodFrom: parsed.period?.from ?? null,
      periodTo: parsed.period?.to ?? null,
      meta,
      rows: parsed.items.map(toStagedRow),
      title: `${count(items.length, 'movimiento', 'movimientos')} de Mercado Pago`,
      facts,
      rowErrors: rowErrorTexts(parsed.rowErrors),
      notices: parsed.fileIssues.filter((i) => i.level !== 'error').map(issueText),
    },
  }
}

// ─── Banco ───────────────────────────────────────────────────────────────────

export type BankContext = {
  treasuryAccountId: string
  /** Un mapeo guardado (o el que se acaba de armar). `null` = reconocer solo. */
  layout: BankLayout | null
}

export function planBank(table: OpenedTable, file: FileInfo, ctx: BankContext): PlanResult {
  const parsed: BankParseResult = parseBankStatement(table.rows, ctx.layout, {
    treasuryAccountId: ctx.treasuryAccountId,
    delimiter: table.signatureDelimiter,
  })
  if (parsed.needsMapping || !parsed.layout) {
    return { ok: false, needsMapping: true, candidateHeaderRow: parsed.candidateHeaderRow }
  }
  const blocking = firstError(parsed.fileIssues)
  if (blocking) return { ok: false, message: issueText(blocking) }
  if (parsed.items.length === 0) {
    return {
      ok: false,
      message:
        parsed.rowErrors.length > 0
          ? `No pudimos leer ningún movimiento: ${rowErrorTexts(parsed.rowErrors.slice(0, 1)).join('')}`
          : 'El extracto no trae movimientos. Revisá las fechas que elegiste al exportarlo.',
    }
  }
  const items = parsed.items.map((r) => r.item)
  const credit = items.reduce((acc, it) => acc + (it.amount > 0 ? it.amount : 0), 0)
  const debit = items.reduce((acc, it) => acc + (it.amount < 0 ? -it.amount : 0), 0)
  const guessed = items.filter((it) => it.direction === 'text').length
  const check = parsed.balanceCheck

  const facts: UploadFact[] = [
    { label: 'Qué es', value: 'Extracto de movimientos del banco' },
    ...periodFact(parsed.period),
    { label: 'Movimientos', value: formatCount(items.length) },
    { label: 'Entró', value: money(credit) },
    { label: 'Salió', value: money(debit) },
  ]
  if (check.opening !== null && check.closing !== null) {
    facts.push({
      label: 'Saldo del extracto',
      value: `${money(check.opening)} al empezar · ${money(check.closing)} al terminar`,
    })
  }
  if (check.status === 'ok') {
    facts.push({ label: 'Control del saldo', value: 'Cierra fila por fila' })
  } else if (check.status === 'mismatch') {
    const first = check.mismatchRows[0]
    facts.push({
      label: 'Control del saldo',
      value: `No cierra en ${count(check.mismatchRows.length, 'fila', 'filas')}${first !== undefined ? ` (la primera es la ${formatCount(first)})` : ''}: igual lo importamos, revisá esas fechas`,
      tone: 'warning',
    })
  }
  if (guessed > 0) {
    facts.push({
      label: 'Sentido deducido',
      value: `En ${count(guessed, 'movimiento', 'movimientos')} no sabemos bien si entró o salió: te los marcamos`,
      tone: 'warning',
    })
  }

  const meta: ImportBatchMeta = {
    layout: 'bank',
    headerRow: parsed.layout.headerRow,
    ...(parsed.layout.decimal ? { decimal: parsed.layout.decimal } : {}),
    ...tableMeta(table),
    initialBalanceCents: check.opening,
    finalBalanceCents: check.closing,
    rows: items.length,
    rowErrors: parsed.rowErrors.length,
    checks: {
      balance: check.status,
      mismatchRows: check.mismatchRows.length,
      order: check.order,
      direction: parsed.direction,
    },
    stats: { guessedDirection: guessed },
    fileIssues: metaIssues(parsed.fileIssues),
  }
  return {
    ok: true,
    plan: {
      source: 'bank_statement',
      fileName: safeName(file.fileName),
      fileSize: file.fileSize,
      detectedFormat: parsed.detectedFormat,
      periodFrom: parsed.period?.from ?? null,
      periodTo: parsed.period?.to ?? null,
      meta,
      rows: parsed.items.map(toStagedRow),
      title: `${count(items.length, 'movimiento', 'movimientos')} del banco`,
      facts,
      rowErrors: rowErrorTexts(parsed.rowErrors),
      notices: parsed.fileIssues.filter((i) => i.level !== 'error').map(issueText),
    },
  }
}

/** El parse del banco (para guardar el mapeo después de «Contanos qué es cada columna»). */
export function parseBankWith(table: OpenedTable, ctx: BankContext): BankParseResult {
  return parseBankStatement(table.rows, ctx.layout, {
    treasuryAccountId: ctx.treasuryAccountId,
    delimiter: table.signatureDelimiter,
  })
}
