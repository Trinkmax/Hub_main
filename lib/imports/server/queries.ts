import 'server-only'

/**
 * Lecturas de las importaciones (diseño §4.0, pantallas de WP10): historial,
 * un lote, sus propuestas y filas, el resumen de la revisión («Cargar 142
 * compras»), la configuración de Mercado Pago, reglas y formatos.
 *
 * Todas con la sesión del usuario: las tablas `acc_import_*` y
 * `acc_mp_connections` se leen por la RLS de lectores (la contadora ve el
 * historial y las reglas, en solo lectura) y cada `select` filtra el bar
 * explícito. Errores → `AccQueryError` (las páginas usan `settleQuery`).
 * Nunca se devuelve un token: de Mercado Pago solo los últimos 4 caracteres.
 */

import { loadPostingCatalog } from '@/lib/accounting/context'
import {
  AccQueryError,
  asRecord,
  asRecords,
  bool,
  cents,
  dayOrNull,
  instantOrNull,
  int,
  intOrNull,
  isUuid,
  queryError,
  readerClient,
  str,
  strings,
  strOrNull,
  type UnknownRecord,
} from '@/lib/accounting/queries/shared'
import { WARNING_KEYS, type WarningKey } from '@/lib/accounting/types'
import { type ImportIssue, type ImportSource, importIssueSchema } from '../types'
import { type NewSupplierRow, newSuppliersOf } from './proposals/arca'
import { decisionsFromSummary, importCatalogFrom } from './proposals/common'
import { loadMpConnection, mpSettingsFor } from './propose'
import { isSafePattern } from './safe-pattern'
import { batchStatusOf, parseBatchCounts } from './stage'
import {
  type ImportBatchCounts,
  type ImportBatchStatus,
  type ImportItemStatus,
  type ImportNeed,
  ITEM_STATUSES,
  type MpCobroChannel,
  NEED_KEYS,
  type NeedKey,
  PROPOSAL_STATUSES,
  type ProposalError,
  type ProposalStatus,
  type ProposalSummary,
  type SavedImportRule,
  SUMMARY_KINDS,
} from './types'

// ─── Lotes ───────────────────────────────────────────────────────────────────

export type ImportBatchRow = {
  id: string
  source: ImportSource
  origin: 'upload' | 'api'
  fileName: string | null
  fileSize: number | null
  detectedFormat: string | null
  periodFrom: string | null
  periodTo: string | null
  treasuryAccountId: string | null
  status: ImportBatchStatus
  counts: ImportBatchCounts | null
  /** Lo que todavía falta revisar o cargar (para revisar + listas + con error + desactualizadas). */
  pending: number
  createdByName: string
  createdAt: string
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export type ImportBatchDetail = ImportBatchRow & { meta: UnknownRecord }

const BATCH_COLUMNS =
  'id, source, origin, file_name, file_size, detected_format, period_from, period_to, treasury_account_id, status, counts, meta, created_by_name, created_at, completed_at, cancelled_at, cancel_reason'

const SOURCES: readonly ImportSource[] = [
  'arca_recibidos',
  'arca_emitidos',
  'mp_release',
  'bank_statement',
]

function sourceOf(v: unknown): ImportSource {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v)
    ? (v as ImportSource)
    : 'arca_recibidos'
}

function pendingOf(counts: ImportBatchCounts | null, status: ImportBatchStatus): number {
  if (!counts || status === 'cancelled' || status === 'done') return 0
  return counts.needsInput + counts.ready + counts.stale + counts.error + counts.posting
}

function parseBatch(row: UnknownRecord): ImportBatchDetail {
  const status = batchStatusOf(row.status) ?? 'staging'
  const counts = parseBatchCounts(row.counts)
  return {
    id: str(row.id),
    source: sourceOf(row.source),
    origin: row.origin === 'api' ? 'api' : 'upload',
    fileName: strOrNull(row.file_name),
    fileSize: intOrNull(row.file_size),
    detectedFormat: strOrNull(row.detected_format),
    periodFrom: dayOrNull(row.period_from),
    periodTo: dayOrNull(row.period_to),
    treasuryAccountId: strOrNull(row.treasury_account_id),
    status,
    counts,
    pending: pendingOf(counts, status),
    createdByName: str(row.created_by_name),
    createdAt: instantOrNull(row.created_at) ?? '',
    completedAt: instantOrNull(row.completed_at),
    cancelledAt: instantOrNull(row.cancelled_at),
    cancelReason: strOrNull(row.cancel_reason),
    meta: asRecord(row.meta),
  }
}

function toRow(detail: ImportBatchDetail): ImportBatchRow {
  const { meta: _meta, ...row } = detail
  return row
}

/**
 * Historial de importaciones, la más nueva primero. `before` = `createdAt` de
 * la última fila de la página anterior.
 */
export async function listImportBatches(
  tenantId: string,
  opts: { source?: ImportSource | null; limit?: number; before?: string | null } = {},
): Promise<ImportBatchRow[]> {
  const supabase = await readerClient()
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200)
  let q = supabase
    .from('acc_import_batches')
    .select(BATCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (opts.source) q = q.eq('source', opts.source)
  if (opts.before && /^\d{4}-\d{2}-\d{2}T/.test(opts.before)) q = q.lt('created_at', opts.before)
  const { data, error } = await q
  if (error) throw queryError('acc_import_batches', error)
  return asRecords(data).map((r) => toRow(parseBatch(r)))
}

/** Un lote (con su `meta`: saldos del archivo, controles, generación); `null` si no es de este bar. */
export async function getImportBatch(
  tenantId: string,
  batchId: string,
): Promise<ImportBatchDetail | null> {
  if (!isUuid(batchId)) return null
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_import_batches')
    .select(BATCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', batchId)
    .maybeSingle()
  if (error) throw queryError('acc_import_batches', error)
  return data ? parseBatch(asRecord(data)) : null
}

// ─── Propuestas ──────────────────────────────────────────────────────────────

export type ImportProposalRow = {
  key: string
  form: string
  status: ProposalStatus
  /** El hash que va a `postImportProposals` (`null` si todavía no se puede armar). */
  previewHash: string | null
  summary: ProposalSummary
  needs: ImportNeed[]
  warningsAck: WarningKey[]
  documentId: string | null
  postedAt: string | null
  error: ProposalError | null
  /**
   * La entrada del formulario (sin `clientRef` ni `previewHash`): sirve para
   * «Ver asiento» (`previewBundle`) y para «Cargarla a mano» (precargar el formulario).
   */
  formValues: UnknownRecord
  updatedAt: string | null
}

function proposalStatus(v: unknown): ProposalStatus {
  return typeof v === 'string' && (PROPOSAL_STATUSES as readonly string[]).includes(v)
    ? (v as ProposalStatus)
    : 'needs_input'
}

function parseNeeds(v: unknown): ImportNeed[] {
  return asRecords(v).filter((n): n is ImportNeed =>
    (NEED_KEYS as readonly unknown[]).includes(n.key),
  )
}

function parseWarnings(v: unknown): WarningKey[] {
  return strings(v).filter((k): k is WarningKey => (WARNING_KEYS as readonly string[]).includes(k))
}

function parseSummary(v: unknown): ProposalSummary {
  const r = asRecord(v)
  const kind = SUMMARY_KINDS.find((k) => k === r.kind) ?? 'purchase'
  const notes = strings(r.notes)
  return {
    kind,
    date: dayOrNull(r.date) ?? '',
    month: typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) ? r.month : null,
    label: str(r.label),
    counterparty: strOrNull(r.counterparty),
    total_cents: cents(r.total_cents),
    item_count: int(r.item_count),
    ...(r.detail && typeof r.detail === 'object'
      ? { detail: asRecord(r.detail) as ProposalSummary['detail'] }
      : {}),
    ...(Array.isArray(r.warnings) ? { warnings: parseWarnings(r.warnings) } : {}),
    ...(notes.length > 0 ? { notes: notes as ProposalSummary['notes'] } : {}),
    ...(r.decisions ? { decisions: decisionsFromSummary(r) } : {}),
  }
}

function parseError(v: unknown): ProposalError | null {
  const r = asRecord(v)
  const reason = r.reason
  if (typeof reason !== 'string') return null
  return {
    reason: reason as ProposalError['reason'],
    ...(typeof r.key === 'string' ? { key: r.key } : {}),
    ...(typeof r.message === 'string' ? { message: r.message } : {}),
    ...(typeof r.document_id === 'string' ? { document_id: r.document_id } : {}),
    ...(typeof r.label === 'string' ? { label: r.label } : {}),
    ...(typeof r.date === 'string' ? { date: r.date } : {}),
    ...(typeof r.batch_id === 'string' ? { batch_id: r.batch_id } : {}),
  }
}

function parseProposal(r: UnknownRecord): ImportProposalRow {
  return {
    key: str(r.key),
    form: str(r.form),
    status: proposalStatus(r.status),
    previewHash: strOrNull(r.preview_hash),
    summary: parseSummary(r.summary),
    needs: parseNeeds(r.needs),
    warningsAck: parseWarnings(r.warnings_ack),
    documentId: strOrNull(r.document_id),
    postedAt: instantOrNull(r.posted_at),
    error: parseError(r.error),
    formValues: asRecord(r.form_values),
    updatedAt: instantOrNull(r.updated_at),
  }
}

const PROPOSAL_READ_COLUMNS =
  'key, form, status, preview_hash, summary, needs, warnings_ack, document_id, posted_at, error, form_values, updated_at'

/**
 * Las propuestas de un lote, por estado (todas si no se pide uno), en orden de
 * clave. `offset`/`limit` para paginar (hasta 500 por página). Con `need`, solo
 * las que necesitan eso (los chips de «Para revisar»: `needs @> [{key}]`).
 */
export async function listImportProposals(
  tenantId: string,
  batchId: string,
  opts: {
    statuses?: readonly ProposalStatus[]
    need?: NeedKey | null
    limit?: number
    offset?: number
  } = {},
): Promise<{ rows: ImportProposalRow[]; total: number }> {
  if (!isUuid(batchId)) return { rows: [], total: 0 }
  const supabase = await readerClient()
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), 500)
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0)
  let q = supabase
    .from('acc_import_proposals')
    .select(PROPOSAL_READ_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('batch_id', batchId)
  if (opts.statuses && opts.statuses.length > 0) q = q.in('status', [...opts.statuses])
  if (opts.need && (NEED_KEYS as readonly string[]).includes(opts.need)) {
    // jsonb: la cadena va tal cual al operador `cs` (un arreglo JSON, no uno de Postgres).
    q = q.contains('needs', JSON.stringify([{ key: opts.need }]))
  }
  const { data, error, count } = await q.order('key').range(offset, offset + limit - 1)
  if (error) throw queryError('acc_import_proposals', error)
  const rows = asRecords(data).map(parseProposal)
  return { rows, total: count ?? rows.length }
}

// ─── Filas ───────────────────────────────────────────────────────────────────

export type ImportItemRow = {
  id: string
  rowNo: number
  naturalKey: string
  status: ImportItemStatus
  /** `McItem`, `MpItem` o `BankItem` (sin datos personales). */
  data: UnknownRecord
  issues: ImportIssue[]
  proposalKeys: string[]
  duplicateOf: string | null
}

function itemStatus(v: unknown): ImportItemStatus {
  return typeof v === 'string' && (ITEM_STATUSES as readonly string[]).includes(v)
    ? (v as ImportItemStatus)
    : 'new'
}

/** Las filas de un lote (para «Ver filas» y «No es nuestro»), en el orden del archivo. */
export async function listImportItems(
  tenantId: string,
  batchId: string,
  opts: {
    statuses?: readonly ImportItemStatus[]
    proposalKey?: string | null
    limit?: number
    offset?: number
  } = {},
): Promise<{ rows: ImportItemRow[]; total: number }> {
  if (!isUuid(batchId)) return { rows: [], total: 0 }
  const supabase = await readerClient()
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), 1000)
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0)
  let q = supabase
    .from('acc_import_items')
    .select('id, row_no, natural_key, status, data, issues, proposal_keys, duplicate_of', {
      count: 'exact',
    })
    .eq('tenant_id', tenantId)
    .eq('batch_id', batchId)
  if (opts.statuses && opts.statuses.length > 0) q = q.in('status', [...opts.statuses])
  if (opts.proposalKey) q = q.contains('proposal_keys', [opts.proposalKey])
  const { data, error, count } = await q.order('row_no').range(offset, offset + limit - 1)
  if (error) throw queryError('acc_import_items', error)
  const rows = asRecords(data).map((r) => ({
    id: str(r.id),
    rowNo: int(r.row_no),
    naturalKey: str(r.natural_key),
    status: itemStatus(r.status),
    data: asRecord(r.data),
    issues: (Array.isArray(r.issues) ? r.issues : []).flatMap((i) => {
      const p = importIssueSchema.safeParse(i)
      return p.success ? [p.data] : []
    }),
    proposalKeys: strings(r.proposal_keys),
    duplicateOf: strOrNull(r.duplicate_of),
  }))
  return { rows, total: count ?? rows.length }
}

// ─── Resumen de la revisión ──────────────────────────────────────────────────

export type ImportReviewSummary = {
  batch: ImportBatchDetail
  byStatus: Record<ProposalStatus, number>
  /** Salteadas porque ya estaban cargadas («Ya cargados»). */
  alreadyLoaded: number
  /** Lo que se va a cargar (listas) y lo que falta revisar, en centavos. */
  readyCents: number
  pendingCents: number
  /** Qué falta, por tipo (para los filtros y los botones rápidos). */
  needs: Partial<Record<NeedKey, number>>
  /** Avisos que se aceptan con la confirmación del lote, y en cuántas propuestas listas. */
  warnings: Partial<Record<WarningKey, number>>
  /** Propuestas listas por mes del libro. */
  months: Array<{ month: string; count: number; totalCents: number }>
  /** Listas cuya fecha es de un mes cerrado: se cargan el primer día abierto. */
  movedToOpenMonth: number
  /** «Proveedores nuevos (N)» con la cuenta sugerida (Mis Comprobantes). */
  newSuppliers: NewSupplierRow[]
}

/**
 * Todo lo que la pantalla de revisión muestra arriba (los `StatCard`, los
 * proveedores nuevos y el resumen antes de «Cargar»). Lee todas las propuestas
 * del lote (solo estado, resumen, lo que falta y el error).
 */
export async function getImportReview(
  tenantId: string,
  batchId: string,
): Promise<ImportReviewSummary | null> {
  const batch = await getImportBatch(tenantId, batchId)
  if (!batch) return null
  const supabase = await readerClient()
  const rows: UnknownRecord[] = []
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await supabase
      .from('acc_import_proposals')
      .select('status, summary, needs, error')
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .order('key')
      .range(from, from + 999)
    if (error) throw queryError('acc_import_proposals', error)
    const page = asRecords(data)
    rows.push(...page)
    if (page.length < 1000) break
  }

  const byStatus = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<
    ProposalStatus,
    number
  >
  const needs: Partial<Record<NeedKey, number>> = {}
  const warnings: Partial<Record<WarningKey, number>> = {}
  const months = new Map<string, { count: number; totalCents: number }>()
  let alreadyLoaded = 0
  let readyCents = 0
  let pendingCents = 0
  let movedToOpenMonth = 0
  const supplierInput: Array<{ needs: ImportNeed[]; totalCents: number }> = []
  for (const r of rows) {
    const status = proposalStatus(r.status)
    byStatus[status]++
    const summary = parseSummary(r.summary)
    const list = parseNeeds(r.needs)
    if (status === 'skipped' && asRecord(r.error).reason === 'already_loaded') alreadyLoaded++
    if (status === 'ready') {
      readyCents += summary.total_cents
      for (const w of summary.warnings ?? []) warnings[w] = (warnings[w] ?? 0) + 1
      if (summary.month) {
        const m = months.get(summary.month) ?? { count: 0, totalCents: 0 }
        m.count++
        m.totalCents += summary.total_cents
        months.set(summary.month, m)
        if (summary.date && summary.date.slice(0, 7) < summary.month) movedToOpenMonth++
      }
    }
    if (status === 'needs_input' || status === 'stale' || status === 'error') {
      pendingCents += summary.total_cents
      for (const n of list) needs[n.key] = (needs[n.key] ?? 0) + 1
    }
    if (list.some((n) => n.key === 'new_supplier')) {
      supplierInput.push({ needs: list, totalCents: summary.total_cents })
    }
  }
  let newSuppliers: NewSupplierRow[] = []
  if (supplierInput.length > 0) {
    const catalog = importCatalogFrom(await loadPostingCatalog(tenantId))
    newSuppliers = newSuppliersOf(supplierInput, catalog)
  }
  return {
    batch,
    byStatus,
    alreadyLoaded,
    readyCents,
    pendingCents,
    needs,
    warnings,
    months: [...months.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
    movedToOpenMonth,
    newSuppliers,
  }
}

// ─── Hub «Importar» ──────────────────────────────────────────────────────────

export type ImportSourceOverview = {
  lastBatch: ImportBatchRow | null
  /** Lotes con algo para revisar o cargar. */
  pendingBatches: number
  pendingProposals: number
}

export type ImportsOverview = Record<
  'arca_recibidos' | 'mp_release' | 'bank_statement',
  ImportSourceOverview
>

/** Las tres tarjetas del hub: la última importación de cada origen y lo pendiente. */
export async function getImportsOverview(tenantId: string): Promise<ImportsOverview> {
  const recent = await listImportBatches(tenantId, { limit: 200 })
  const out: ImportsOverview = {
    arca_recibidos: { lastBatch: null, pendingBatches: 0, pendingProposals: 0 },
    mp_release: { lastBatch: null, pendingBatches: 0, pendingProposals: 0 },
    bank_statement: { lastBatch: null, pendingBatches: 0, pendingProposals: 0 },
  }
  for (const b of recent) {
    if (b.source === 'arca_emitidos') continue
    const o = out[b.source]
    if (!o.lastBatch && b.status !== 'cancelled') o.lastBatch = b
    if (b.pending > 0) {
      o.pendingBatches++
      o.pendingProposals += b.pending
    }
  }
  return out
}

// ─── Reglas, formatos y Mercado Pago ─────────────────────────────────────────

export type ImportRuleRow = SavedImportRule & {
  /** El patrón entra en el subconjunto que el servidor puede evaluar (si no, la regla no se aplica). */
  serverSafe: boolean
}

export async function listImportRules(
  tenantId: string,
  source?: 'arca_recibidos' | 'mp_release' | 'bank_statement' | null,
): Promise<ImportRuleRow[]> {
  const supabase = await readerClient()
  let q = supabase
    .from('acc_import_rules')
    .select('id, source, priority, label, match, action, active, updated_at')
    .eq('tenant_id', tenantId)
    .order('source')
    .order('priority')
    .order('id')
    .limit(1000)
  if (source) q = q.eq('source', source)
  const { data, error } = await q
  if (error) throw queryError('acc_import_rules', error)
  return asRecords(data).map((r) => {
    const match = asRecord(r.match)
    const pattern = typeof match.pattern === 'string' ? match.pattern : null
    return {
      id: str(r.id),
      source: str(r.source),
      priority: int(r.priority),
      label: str(r.label),
      match,
      action: asRecord(r.action),
      active: bool(r.active),
      updatedAt: strOrNull(r.updated_at),
      serverSafe: pattern === null || isSafePattern(pattern),
    }
  })
}

export type ImportLayoutRow = {
  id: string
  signature: string
  mapping: UnknownRecord
  treasuryAccountId: string | null
  updatedAt: string | null
}

/** Los mapeos de columnas guardados (`importar/banco` busca por firma antes de preguntar). */
export async function listImportLayouts(tenantId: string): Promise<ImportLayoutRow[]> {
  const supabase = await readerClient()
  const { data, error } = await supabase
    .from('acc_import_layouts')
    .select('id, signature, mapping, treasury_account_id, updated_at')
    .eq('tenant_id', tenantId)
    .eq('source', 'bank_statement')
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) throw queryError('acc_import_layouts', error)
  return asRecords(data).map((r) => ({
    id: str(r.id),
    signature: str(r.signature),
    mapping: asRecord(r.mapping),
    treasuryAccountId: strOrNull(r.treasury_account_id),
    updatedAt: strOrNull(r.updated_at),
  }))
}

export type MpImportSettings = {
  /** La fila de `acc_mp_connections` (sin token; solo sus últimos 4). `null` si nunca se configuró. */
  connection: {
    id: string
    status: string
    treasuryAccountId: string
    partyId: string
    channelMethods: Partial<Record<MpCobroChannel, string>>
    dayCutoffHour: number
    tokenLast4: string | null
    lastSyncAt: string | null
    lastSyncStatus: string | null
    lastErrorKey: string | null
    syncedThrough: string | null
    updatedAt: string | null
  } | null
  /** Lo que usaría el importador hoy (configurado o deducido). `null` si falta la billetera. */
  effective: {
    treasuryId: string
    partyId: string
    channelMethods: Partial<Record<MpCobroChannel, string>>
    inferred: MpCobroChannel[]
  } | null
  wallets: Array<{ id: string; name: string; hasCvu: boolean }>
  /** Medios del cierre del día que se pueden elegir para un canal (activos). */
  methods: Array<{ id: string; name: string; kind: string; partyId: string | null }>
  /** CBU/CVU propios cargados (para distinguir un retiro propio de un pago a un tercero). */
  ownAccounts: number
}

/** La tarjeta «Antes de la primera importación» de Mercado Pago. */
export async function getMpImportSettings(tenantId: string): Promise<MpImportSettings> {
  const supabase = await readerClient()
  const [conn, catalogRaw, extra] = await Promise.all([
    loadMpConnection(supabase, tenantId).catch((error: unknown) => {
      throw queryError('acc_mp_connections', error as { message?: string; code?: string })
    }),
    loadPostingCatalog(tenantId),
    supabase
      .from('acc_mp_connections')
      .select('token_last4, last_sync_at, last_sync_status, last_error_key, synced_through')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  if (extra.error) throw queryError('acc_mp_connections', extra.error)
  const x = asRecord(extra.data)
  const catalog = importCatalogFrom(catalogRaw)
  const effective = mpSettingsFor(conn, catalog, null)
  return {
    connection: conn
      ? {
          id: conn.id,
          status: conn.status,
          treasuryAccountId: conn.treasuryAccountId,
          partyId: conn.partyId,
          channelMethods: conn.channelMethods,
          dayCutoffHour: conn.dayCutoffHour,
          tokenLast4: strOrNull(x.token_last4),
          lastSyncAt: instantOrNull(x.last_sync_at),
          lastSyncStatus: strOrNull(x.last_sync_status),
          lastErrorKey: strOrNull(x.last_error_key),
          syncedThrough: dayOrNull(x.synced_through),
          updatedAt: conn.updatedAt,
        }
      : null,
    effective: effective
      ? {
          treasuryId: effective.treasuryId,
          partyId: effective.partyId,
          channelMethods: { ...effective.channelMethods },
          inferred: [...effective.inferred],
        }
      : null,
    wallets: catalogRaw.treasuries
      .filter((t) => t.active && t.kind === 'wallet')
      .map((t) => ({ id: t.id, name: t.name, hasCvu: t.cbuCvu !== null })),
    methods: catalogRaw.methods
      .filter((m) => m.active)
      .map((m) => ({ id: m.id, name: m.name, kind: m.kind, partyId: m.partyId })),
    ownAccounts: catalogRaw.treasuries.filter((t) => t.active && t.cbuCvu !== null).length,
  }
}

/** Para que las pantallas distingan «no existe» de un error de lectura. */
export function isImportQueryError(error: unknown): error is AccQueryError {
  return error instanceof AccQueryError
}
