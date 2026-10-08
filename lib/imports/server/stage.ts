import 'server-only'

/**
 * Subir (diseño §4.0, «Idempotencia, en cuatro capas»): el lote y sus filas,
 * más las lecturas que detectan lo que ya está cargado a mano.
 *
 * 1. **Archivo:** `acc_import_create_batch` es idempotente por (bar, origen,
 *    SHA-256). Un archivo repetido vuelve con «Ya importaste este archivo el
 *    03/10 (Nacho)» y el id de ese lote; si ese lote quedó a medio subir
 *    (`staging`), se puede seguir subiendo ahí (`resumable`).
 * 2. **Fila:** las filas llegan YA parseadas por el navegador (los parsers de
 *    `lib/imports/**` corren ahí: esquiva el límite de 1 MB de las acciones).
 *    Acá se revalidan con el zod estricto de su origen (una clave de más se
 *    rechaza: así no entra ningún dato personal), se controla que la clave
 *    natural sea la de la fila, y los avisos se compactan para que entren en
 *    los 4 KB de la base (repetidos afuera; si no alcanza, primero los
 *    informativos). Van en tandas de 500 a `acc_import_add_items`, que marca
 *    `duplicate` las claves ya vivas y saltea los reenvíos.
 * 3. **Contra lo cargado a mano:** compras por número o por total
 *    (`acc_import_match_purchases`), días de Mercado Pago con cobros o ajustes
 *    manuales, transferencias ya cargadas (±3 días) y gastos bancarios del día.
 *    Solo comprobantes que no vinieron de una importación.
 *
 * Todo con la sesión del usuario (RLS + `acc_assert_writer` en las RPC); nunca
 * `service_role`. Nunca se loguean filas ni datos personales.
 */

import type { AccountingAuthorized } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { accFailure, asRecord, intOf, rpcFailure, textOf } from '@/lib/accounting/actions/support'
import { ACC_GENERIC_ERROR } from '@/lib/accounting/errors'
import { addDays } from '@/lib/dates'
import { createClient } from '@/lib/supabase/server'
import { mcNaturalKey } from '../arca/mis-comprobantes'
import { bankNaturalKey } from '../bank/statement'
import {
  bankItemSchema,
  type ImportIssue,
  type ImportSource,
  importIssueSchema,
  mcItemSchema,
  mpItemSchema,
} from '../types'
import type { PurchaseMatch } from './proposals/arca'
import { estimateJsonbSize, stableStringify } from './proposals/common'
import type { PostedTransfer } from './proposals/mp'
import type {
  AddImportItemsResult,
  CreateImportBatchResult,
  ImportBatchCounts,
  ImportBatchStatus,
} from './types'
import { addImportItemsSchema, BATCH_STATUSES, createImportBatchSchema } from './types'

export type Supabase = Awaited<ReturnType<typeof createClient>>

/** Tope de `acc_import_items.issues` (`pg_column_size` ≤ 4096) con margen. */
export const ISSUES_MAX_BYTES = 3800
/** Tope de `acc_import_items.data` (≤ 8192) con margen. */
export const ITEM_DATA_MAX_BYTES = 7800
/** Filas por llamada a `acc_import_add_items` (la base acepta hasta 1000). */
export const ADD_ITEMS_CHUNK = 500
/** Avisos por fila que acepta `importIssuesSchema`. */
const MAX_ISSUES = 50

// ─── Lectura de lo que devuelve la base ──────────────────────────────────────

/** `acc_import_batches.counts` → camelCase (lo que falte, en cero). */
export function parseBatchCounts(raw: unknown): ImportBatchCounts | null {
  const r = asRecord(raw)
  if (!r) return null
  const n = (k: string) => intOf(r[k]) ?? 0
  return {
    items: n('items'),
    new: n('new'),
    duplicate: n('duplicate'),
    ignored: n('ignored'),
    review: n('review'),
    postedItems: n('posted_items'),
    cancelled: n('cancelled'),
    proposals: n('proposals'),
    needsInput: n('needs_input'),
    ready: n('ready'),
    posting: n('posting'),
    posted: n('posted'),
    stale: n('stale'),
    error: n('error'),
    skipped: n('skipped'),
    voided: n('voided'),
  }
}

export function batchStatusOf(value: unknown): ImportBatchStatus | null {
  return typeof value === 'string' && (BATCH_STATUSES as readonly string[]).includes(value)
    ? (value as ImportBatchStatus)
    : null
}

export type BatchRow = {
  id: string
  source: ImportSource
  status: ImportBatchStatus
  treasuryAccountId: string | null
  periodFrom: string | null
  periodTo: string | null
  counts: ImportBatchCounts | null
  createdAt: string | null
}

const BATCH_SOURCES: readonly ImportSource[] = [
  'arca_recibidos',
  'arca_emitidos',
  'mp_release',
  'bank_statement',
]

/** El lote (por la RLS de lectores y con el bar explícito); `null` si no es de este bar. */
export async function loadBatch(
  supabase: Supabase,
  tenantId: string,
  batchId: string,
): Promise<BatchRow | null> {
  const { data, error } = await supabase
    .from('acc_import_batches')
    .select('id, source, status, treasury_account_id, period_from, period_to, counts, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', batchId)
    .maybeSingle()
  if (error) throw error
  const r = asRecord(data)
  if (!r) return null
  const source = r.source
  const status = batchStatusOf(r.status)
  if (
    typeof source !== 'string' ||
    !(BATCH_SOURCES as readonly string[]).includes(source) ||
    !status
  ) {
    return null
  }
  return {
    id: textOf(r.id) ?? batchId,
    source: source as ImportSource,
    status,
    treasuryAccountId: textOf(r.treasury_account_id),
    periodFrom: textOf(r.period_from),
    periodTo: textOf(r.period_to),
    counts: parseBatchCounts(r.counts),
    createdAt: textOf(r.created_at),
  }
}

// ─── Avisos: sin repetidos y dentro de los 4 KB ──────────────────────────────

const LEVEL_RANK: Readonly<Record<ImportIssue['level'], number>> = { error: 0, review: 1, info: 2 }

/**
 * Los avisos de una fila listos para la base: sin repetidos (mismo nivel,
 * código, campo e importe), los más graves primero y recortados para que el
 * `jsonb` entre en `ISSUES_MAX_BYTES`. Devuelve cuántos sacó.
 */
export function compactIssues(
  issues: readonly ImportIssue[],
  maxBytes: number = ISSUES_MAX_BYTES,
): { issues: ImportIssue[]; trimmed: number } {
  const seen = new Set<string>()
  const unique: Array<{ issue: ImportIssue; order: number }> = []
  issues.forEach((issue, order) => {
    const id = stableStringify(issue)
    if (seen.has(id)) return
    seen.add(id)
    unique.push({ issue, order })
  })
  unique.sort((a, b) => LEVEL_RANK[a.issue.level] - LEVEL_RANK[b.issue.level] || a.order - b.order)
  const kept: ImportIssue[] = []
  for (const { issue } of unique) {
    if (kept.length >= MAX_ISSUES) break
    if (estimateJsonbSize([...kept, issue]) > maxBytes) break
    kept.push(issue)
  }
  return { issues: kept, trimmed: issues.length - kept.length }
}

// ─── Filas ───────────────────────────────────────────────────────────────────

export type StagedRowPayload = {
  row_no: number
  natural_key: string
  data: Record<string, unknown>
  issues: ImportIssue[]
}

export type StagedRowCheck =
  | { ok: true; row: StagedRowPayload; trimmed: number }
  | { ok: false; rowNo: number; reason: 'data' | 'key' | 'issues' | 'size' }

/**
 * Una fila parseada en el navegador, revalidada: el zod estricto de su origen,
 * la clave natural tiene que ser la de los datos (no se acepta cualquier
 * clave), y los avisos compactados.
 */
export function checkStagedRow(
  source: ImportSource,
  treasuryId: string | null,
  row: { rowNo: number; naturalKey: string; data: unknown; issues: readonly unknown[] },
): StagedRowCheck {
  let data: Record<string, unknown>
  let key: string | null
  switch (source) {
    case 'arca_recibidos': {
      const p = mcItemSchema.safeParse(row.data)
      if (!p.success) return { ok: false, rowNo: row.rowNo, reason: 'data' }
      data = p.data
      key = mcNaturalKey('recibidos', p.data)
      break
    }
    case 'mp_release': {
      const p = mpItemSchema.safeParse(row.data)
      if (!p.success) return { ok: false, rowNo: row.rowNo, reason: 'data' }
      data = p.data
      key = p.data.rowKey
      break
    }
    case 'bank_statement': {
      const p = bankItemSchema.safeParse(row.data)
      if (!p.success || !treasuryId) return { ok: false, rowNo: row.rowNo, reason: 'data' }
      data = p.data
      key = bankNaturalKey(treasuryId, p.data)
      break
    }
    default:
      return { ok: false, rowNo: row.rowNo, reason: 'data' }
  }
  if (key !== row.naturalKey) return { ok: false, rowNo: row.rowNo, reason: 'key' }
  const issues: ImportIssue[] = []
  for (const raw of row.issues) {
    const p = importIssueSchema.safeParse(raw)
    if (!p.success) return { ok: false, rowNo: row.rowNo, reason: 'issues' }
    issues.push(p.data)
  }
  if (estimateJsonbSize(data) > ITEM_DATA_MAX_BYTES) {
    return { ok: false, rowNo: row.rowNo, reason: 'size' }
  }
  const compact = compactIssues(issues)
  return {
    ok: true,
    row: { row_no: row.rowNo, natural_key: key, data, issues: compact.issues },
    trimmed: compact.trimmed,
  }
}

const ROW_PROBLEM: Readonly<Record<'data' | 'key' | 'issues' | 'size', string>> = {
  data: 'no se pudo leer',
  key: 'no coincide con su clave',
  issues: 'tiene avisos que no se entienden',
  size: 'es demasiado grande',
}

function rowFailure(rowNo: number, reason: 'data' | 'key' | 'issues' | 'size'): AccFailureState {
  return {
    ok: false,
    code: 'invalid',
    message: `La fila ${rowNo} del archivo ${ROW_PROBLEM[reason]}. Recargá la página y subí el archivo de nuevo.`,
    detail: { key: 'invalid_payload', row_no: rowNo, reason, bug: true },
  }
}

// ─── Crear el lote ───────────────────────────────────────────────────────────

/** `createImportBatch`: el lote, idempotente por archivo. */
export async function createImportBatchFor(
  auth: AccountingAuthorized,
  raw: unknown,
): Promise<AccSimpleState<CreateImportBatchResult>> {
  const parsed = createImportBatchSchema.safeParse(raw)
  if (!parsed.success) return invalidState(parsed.error)
  const v = parsed.data
  if (estimateJsonbSize(v.meta) > 7800) {
    return accFailure('invalid_payload')
  }
  const supabase = await createClient()
  const payload: Record<string, unknown> = {
    source: v.source,
    file_sha256: v.fileSha256,
    file_size: v.fileSize,
    meta: v.meta,
  }
  if (v.fileName !== null) payload.file_name = v.fileName
  if (v.detectedFormat !== null) payload.detected_format = v.detectedFormat
  if (v.periodFrom !== null) payload.period_from = v.periodFrom
  if (v.periodTo !== null) payload.period_to = v.periodTo
  if (v.treasuryAccountId !== null) payload.treasury_account_id = v.treasuryAccountId

  const { data, error } = await supabase.rpc('acc_import_create_batch', {
    p_tenant_id: auth.tenantId,
    p_batch: payload,
  })
  if (error) {
    const state = rpcFailure('imports.createBatch', error)
    // «Ya importaste este archivo»: si ese lote quedó a medio subir, se puede seguir ahí.
    const existing = typeof state.detail?.batch_id === 'string' ? state.detail.batch_id : null
    if (state.detail?.key === 'import_file_already' && existing) {
      try {
        const batch = await loadBatch(supabase, auth.tenantId, existing)
        if (batch) {
          state.detail = {
            ...state.detail,
            status: batch.status,
            resumable: batch.status === 'staging',
          }
        }
      } catch {
        // Sin el estado, la pantalla muestra igual «Ver esa importación».
      }
    }
    return state
  }
  const row = asRecord(data)
  const batchId = textOf(row?.id)
  if (!row || !batchId) {
    console.error('[imports.createBatch] respuesta sin id')
    return { ok: false, code: 'error', message: ACC_GENERIC_ERROR }
  }
  return {
    ok: true,
    data: {
      batchId,
      status: batchStatusOf(row.status) ?? 'staging',
      createdAt: textOf(row.created_at),
    },
    message: 'Archivo listo: estamos cargando las filas.',
  }
}

// ─── Cargar las filas ────────────────────────────────────────────────────────

/** `addImportItems`: una tanda de filas ya parseadas (hasta 1000), en sub-tandas de 500. */
export async function addImportItemsFor(
  auth: AccountingAuthorized,
  raw: unknown,
): Promise<AccSimpleState<AddImportItemsResult>> {
  const parsed = addImportItemsSchema.safeParse(raw)
  if (!parsed.success) return invalidState(parsed.error)
  const { batchId, items } = parsed.data
  const supabase = await createClient()
  const batch = await loadBatch(supabase, auth.tenantId, batchId)
  if (!batch || batch.status !== 'staging') return accFailure('import_batch_closed')
  if (batch.source === 'arca_emitidos') return accFailure('import_batch_closed')

  const rows: StagedRowPayload[] = []
  const seenRows = new Set<number>()
  let trimmed = 0
  for (const item of items) {
    if (seenRows.has(item.rowNo)) continue
    seenRows.add(item.rowNo)
    const check = checkStagedRow(batch.source, batch.treasuryAccountId, item)
    if (!check.ok) return rowFailure(check.rowNo, check.reason)
    rows.push(check.row)
    trimmed += check.trimmed
  }

  let inserted = 0
  let duplicates = 0
  let skipped = 0
  let counts: ImportBatchCounts | null = batch.counts
  for (let i = 0; i < rows.length; i += ADD_ITEMS_CHUNK) {
    const chunk = rows.slice(i, i + ADD_ITEMS_CHUNK)
    const { data, error } = await supabase.rpc('acc_import_add_items', {
      p_tenant_id: auth.tenantId,
      p_batch_id: batchId,
      p_items: chunk,
    })
    if (error) return rpcFailure('imports.addItems', error)
    const r = asRecord(data)
    inserted += intOf(r?.new) ?? 0
    duplicates += intOf(r?.duplicate) ?? 0
    skipped += intOf(r?.skipped) ?? 0
    counts = parseBatchCounts(r?.counts) ?? counts
  }
  return {
    ok: true,
    data: { inserted, duplicates, skipped, issuesTrimmed: trimmed, counts },
    message:
      duplicates > 0
        ? `${inserted} filas nuevas; ${duplicates} ya estaban en otra importación.`
        : `${inserted} filas nuevas.`,
  }
}

// ─── Lecturas paginadas ──────────────────────────────────────────────────────

const PAGE = 1000

/** Filas de un `select` en páginas de 1000 (el máximo de PostgREST), hasta `max`. */
export async function pagedRows(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  max = 200_000,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, Math.min(from + PAGE, max) - 1)
    if (error) throw error
    const page = Array.isArray(data) ? data : []
    for (const row of page) {
      const r = asRecord(row)
      if (r) out.push(r)
    }
    if (page.length < PAGE) break
  }
  return out
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** De estos comprobantes, los que vinieron de una importación (no son «a mano»). */
async function importedDocumentIds(
  supabase: Supabase,
  tenantId: string,
  documentIds: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  for (const chunk of chunks([...new Set(documentIds)], 100)) {
    const { data, error } = await supabase
      .from('acc_import_proposals')
      .select('document_id')
      .eq('tenant_id', tenantId)
      .in('document_id', chunk)
    if (error) throw error
    for (const row of Array.isArray(data) ? data : []) {
      const id = textOf(asRecord(row)?.document_id)
      if (id) out.add(id)
    }
  }
  return out
}

type DocRow = { id: string; date: string; total: number; kind: string; description: string }

async function documentsInRange(
  supabase: Supabase,
  tenantId: string,
  kinds: readonly string[],
  from: string,
  to: string,
  partyIds?: readonly string[],
): Promise<DocRow[]> {
  const rows = await pagedRows((a, b) => {
    let q = supabase
      .from('acc_documents')
      .select('id, accounting_date, total_cents, kind, description, party_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .in('kind', [...kinds])
      .gte('accounting_date', from)
      .lte('accounting_date', to)
    if (partyIds && partyIds.length > 0) q = q.in('party_id', [...partyIds])
    return q.order('accounting_date').order('id').range(a, b)
  }, 20_000)
  const out: DocRow[] = []
  for (const r of rows) {
    const id = textOf(r.id)
    const date = textOf(r.accounting_date)?.slice(0, 10)
    const total = intOf(r.total_cents)
    if (!id || !date || total === null) continue
    out.push({
      id,
      date,
      total,
      kind: textOf(r.kind) ?? '',
      description: textOf(r.description) ?? '',
    })
  }
  return out
}

/** Los renglones de caja (`role = treasury`) de estos comprobantes. */
async function treasuryLines(
  supabase: Supabase,
  tenantId: string,
  documentIds: readonly string[],
): Promise<Array<{ documentId: string; treasuryId: string; side: string }>> {
  const out: Array<{ documentId: string; treasuryId: string; side: string }> = []
  for (const chunk of chunks([...new Set(documentIds)], 100)) {
    const rows = await pagedRows(
      (a, b) =>
        supabase
          .from('acc_document_lines')
          .select('document_id, treasury_account_id, side')
          .eq('tenant_id', tenantId)
          .eq('role', 'treasury')
          .in('document_id', chunk)
          .order('document_id')
          .order('line_no')
          .range(a, b),
      20_000,
    )
    for (const r of rows) {
      const documentId = textOf(r.document_id)
      const treasuryId = textOf(r.treasury_account_id)
      const side = textOf(r.side)
      if (documentId && treasuryId && side) out.push({ documentId, treasuryId, side })
    }
  }
  return out
}

// ─── Contra lo cargado a mano ────────────────────────────────────────────────

/**
 * Compras que ya están (`acc_import_match_purchases`, de a 1000): `number`
 * (mismo proveedor, tipo, PV y número) o `amount` (mismo total ±3 días).
 */
export async function matchPurchases(
  supabase: Supabase,
  tenantId: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<Map<string, PurchaseMatch>> {
  const out = new Map<string, PurchaseMatch>()
  for (const chunk of chunks(rows, 1000)) {
    const { data, error } = await supabase.rpc('acc_import_match_purchases', {
      p_tenant_id: tenantId,
      p_rows: chunk,
    })
    if (error) throw error
    for (const raw of Array.isArray(data) ? data : []) {
      const r = asRecord(raw)
      const key = textOf(r?.key)
      const documentId = textOf(r?.document_id)
      const match = r?.match
      if (!key || !documentId || (match !== 'number' && match !== 'amount')) continue
      out.set(key, { match, documentId, label: textOf(r?.label) ?? '' })
    }
  }
  return out
}

/**
 * Días con cobros (`collection` del partícipe de Mercado Pago) o «Ajustar
 * saldo» de la billetera cargados A MANO en el período: esos días no se
 * proponen (diseño §4.0, capa 4).
 */
export async function loadManualMpDays(
  supabase: Supabase,
  tenantId: string,
  o: { partyIds: readonly string[]; walletId: string | null; from: string; to: string },
): Promise<Set<string>> {
  const days = new Set<string>()
  const collections =
    o.partyIds.length > 0
      ? await documentsInRange(supabase, tenantId, ['collection'], o.from, o.to, o.partyIds)
      : []
  const adjustments = o.walletId
    ? await documentsInRange(supabase, tenantId, ['treasury_adjustment'], o.from, o.to)
    : []
  let candidates: DocRow[] = [...collections]
  if (adjustments.length > 0 && o.walletId) {
    const lines = await treasuryLines(
      supabase,
      tenantId,
      adjustments.map((d) => d.id),
    )
    const onWallet = new Set(
      lines.filter((l) => l.treasuryId === o.walletId).map((l) => l.documentId),
    )
    candidates = candidates.concat(adjustments.filter((d) => onWallet.has(d.id)))
  }
  if (candidates.length === 0) return days
  const imported = await importedDocumentIds(
    supabase,
    tenantId,
    candidates.map((d) => d.id),
  )
  for (const d of candidates) if (!imported.has(d.id)) days.add(d.date)
  return days
}

/**
 * Movimientos entre cuentas ya cargados (de cualquier origen) que tocan estas
 * cajas, del período ±3 días: un retiro de Mercado Pago que ya entró por el
 * banco (o al revés) no se carga dos veces.
 */
export async function loadPostedTransfers(
  supabase: Supabase,
  tenantId: string,
  o: { treasuryIds: readonly string[]; from: string; to: string },
): Promise<PostedTransfer[]> {
  if (o.treasuryIds.length === 0) return []
  const docs = await documentsInRange(
    supabase,
    tenantId,
    ['transfer'],
    addDays(o.from, -3),
    addDays(o.to, 3),
  )
  if (docs.length === 0) return []
  const lines = await treasuryLines(
    supabase,
    tenantId,
    docs.map((d) => d.id),
  )
  const byDoc = new Map<string, { from: string | null; to: string | null }>()
  for (const l of lines) {
    const v = byDoc.get(l.documentId) ?? { from: null, to: null }
    if (l.side === 'credit') v.from = l.treasuryId
    else v.to = l.treasuryId
    byDoc.set(l.documentId, v)
  }
  const wanted = new Set(o.treasuryIds)
  const out: PostedTransfer[] = []
  for (const d of docs) {
    const v = byDoc.get(d.id)
    if (!v?.from || !v.to) continue
    if (!wanted.has(v.from) && !wanted.has(v.to)) continue
    out.push({
      documentId: d.id,
      date: d.date,
      amountCents: d.total,
      fromTreasuryId: v.from,
      toTreasuryId: v.to,
      label: d.description,
    })
  }
  return out
}

/**
 * Gastos bancarios de esta cuenta cargados A MANO en el período: `<día>:<total>`
 * (diseño §4.0: «misma cuenta, mismo día y mismo total → Ya registrado»).
 */
export async function loadManualBankExpenses(
  supabase: Supabase,
  tenantId: string,
  o: { treasuryId: string; from: string; to: string },
): Promise<Set<string>> {
  const out = new Set<string>()
  const docs = await documentsInRange(supabase, tenantId, ['bank_expense'], o.from, o.to)
  if (docs.length === 0) return out
  const lines = await treasuryLines(
    supabase,
    tenantId,
    docs.map((d) => d.id),
  )
  const onBank = new Set(
    lines.filter((l) => l.treasuryId === o.treasuryId).map((l) => l.documentId),
  )
  const mine = docs.filter((d) => onBank.has(d.id))
  if (mine.length === 0) return out
  const imported = await importedDocumentIds(
    supabase,
    tenantId,
    mine.map((d) => d.id),
  )
  for (const d of mine) if (!imported.has(d.id)) out.add(`${d.date}:${d.total}`)
  return out
}
