import 'server-only'

/**
 * Revisar (diseño §4.0): de las filas del lote a las propuestas.
 *
 * `rebuildBatch` lee TODO desde la base (filas, propuestas que ya existen,
 * catálogo, reglas, partidas abiertas, lo cargado a mano), arma los borradores
 * con los armadores puros (`proposals/{arca,mp,bank}.ts`), los evalúa con el
 * mismo camino de la acción de guardar (zod → `build*` → vista previa → hash) y
 * escribe con `acc_import_put_proposals` solo lo que cambió, en tandas de 100:
 *
 * - `client_ref = importClientRef(bar, clave, intento)`: determinístico. La base
 *   lo guarda solo al insertar; un reintento de `acc_post_bundle` con la misma
 *   propuesta devuelve lo ya guardado.
 * - Las `posted` no se tocan; las `posting` de hace menos de 3 minutos tampoco
 *   (puede haber otra pestaña cargándolas; la base aplica la misma regla).
 * - Las `voided` (su comprobante se anuló o se revirtió) quedan así hasta
 *   «Volver a cargar» (`reimport`): ahí se arman con `attempt + 1` y su
 *   `client_ref` nuevo, sin los avisos aceptados del intento anterior.
 * - Un `client_ref` nuevo cuyo comprobante se anuló (la misma fila importada
 *   en un lote cancelado) no vuelve a entrar: se usa el próximo intento libre.
 *   Uno vigente sí: al confirmar, `acc_post_bundle` devuelve ese comprobante y
 *   no queda dos veces.
 * - Lo que ya no sale del armado (una fila ignorada, un canal que cambió de
 *   medio) queda `skipped` con el motivo.
 * - Las decisiones de la persona (`summary.decisions`) y los avisos aceptados
 *   (`warnings_ack`) sobreviven a «Revisar de nuevo».
 *
 * `resolveImportNeedsFor` aplica los cambios de la revisión (cuenta habitual,
 * condición del proveedor, «otros tributos», medio de un canal, «no es
 * nuestro»…) y vuelve a armar. `createImportSuppliersFor` da de alta los
 * proveedores nuevos con su cuenta habitual y vuelve a armar.
 *
 * Con la sesión del usuario; nunca `service_role`. Sin datos personales en logs.
 */

import type { AccountingAuthorized } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { accFailure, asRecord, intOf, rpcFailure, textOf } from '@/lib/accounting/actions/support'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingCatalog,
  type PostingContextRefs,
  tryLoadPostingContext,
} from '@/lib/accounting/context'
import { mapAccError } from '@/lib/accounting/errors'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { revalidateAdministracion } from '@/lib/accounting/server/post-document'
import { WARNING_KEYS, type WarningKey } from '@/lib/accounting/types'
import { parseCuit } from '@/lib/fiscal'
import { createClient } from '@/lib/supabase/server'
import { importClientRef } from '../hash'
import {
  bankItemSchema,
  type ImportIssue,
  importIssueSchema,
  mcItemSchema,
  mpItemSchema,
} from '../types'
import { buildArcaDrafts, otherTaxesRulesFrom, purchaseMatchRows } from './proposals/arca'
import { bankRulesFrom, buildBankDrafts } from './proposals/bank'
import {
  decisionsFromSummary,
  type EvaluatedProposal,
  estimateJsonbSize,
  evaluateDraft,
  type ImportCatalog,
  importCatalogFrom,
  isBuildable,
  mergeDecisions,
  OpenItemPool,
  type ProposalDraft,
  type StagedItem,
  stableStringify,
  systemParty,
  treasuriesOfKind,
} from './proposals/common'
import { buildMpDrafts, type MpSettings, mpTaxRulesFrom } from './proposals/mp'
import {
  type BatchRow,
  chunks,
  loadBatch,
  loadManualBankExpenses,
  loadManualMpDays,
  loadPostedTransfers,
  matchPurchases,
  pagedRows,
  parseBatchCounts,
  type Supabase,
} from './stage'
import {
  type BuildProposalsResult,
  type CreateImportSuppliersResult,
  createImportSuppliersSchema,
  type ImportBatchCounts,
  type ImportChange,
  type ImportItemStatus,
  ITEM_STATUSES,
  MP_COBRO_CHANNELS,
  type MpCobroChannel,
  PROPOSAL_SOURCES,
  PROPOSAL_STATUSES,
  type ProposalDecisions,
  type ProposalError,
  type ProposalStatus,
  resolveImportNeedsSchema,
} from './types'

/** Propuestas por llamada a `acc_import_put_proposals` (la base acepta 500; el cuerpo queda chico). */
export const PUT_PROPOSALS_CHUNK = 100
/** Filas que una propuesta vincula por entrada (`item_ids` ≤ 5000 en la base). */
const ITEM_IDS_CHUNK = 5000
/** Una propuesta `posting` más nueva que esto la está cargando otra pestaña: no se toca (como la base). */
const POSTING_GRACE_MS = 3 * 60_000
/** Tope de `attempt` en `acc_import_put_proposals`. */
const MAX_ATTEMPT = 100

// ─── Lecturas ────────────────────────────────────────────────────────────────

type RawItem = {
  id: string
  rowNo: number
  key: string
  status: ImportItemStatus
  data: unknown
  issues: ImportIssue[]
}

function itemStatusOf(v: unknown): ImportItemStatus {
  return typeof v === 'string' && (ITEM_STATUSES as readonly string[]).includes(v)
    ? (v as ImportItemStatus)
    : 'new'
}

async function loadItems(
  supabase: Supabase,
  tenantId: string,
  batchId: string,
): Promise<RawItem[]> {
  const rows = await pagedRows((a, b) =>
    supabase
      .from('acc_import_items')
      .select('id, row_no, natural_key, data, status, issues')
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .order('row_no')
      .range(a, b),
  )
  const out: RawItem[] = []
  for (const r of rows) {
    const id = textOf(r.id)
    const key = textOf(r.natural_key)
    const rowNo = intOf(r.row_no)
    if (!id || !key || rowNo === null) continue
    const issues: ImportIssue[] = []
    for (const raw of Array.isArray(r.issues) ? r.issues : []) {
      const p = importIssueSchema.safeParse(raw)
      if (p.success) issues.push(p.data)
    }
    out.push({ id, rowNo, key, status: itemStatusOf(r.status), data: r.data, issues })
  }
  return out
}

/** Las filas que arman propuestas, validadas contra el esquema de su origen. */
function staged<T>(
  rows: readonly RawItem[],
  parse: (data: unknown) => { success: true; data: T } | { success: false },
): StagedItem<T>[] {
  const out: StagedItem<T>[] = []
  let broken = 0
  for (const r of rows) {
    if (!isBuildable(r.status)) continue
    const p = parse(r.data)
    if (!p.success) {
      broken++
      continue
    }
    out.push({
      id: r.id,
      rowNo: r.rowNo,
      key: r.key,
      status: r.status,
      item: p.data,
      issues: r.issues,
    })
  }
  if (broken > 0) console.error('[imports.rebuild] filas que no pasan el esquema', broken)
  return out
}

export type ExistingProposal = {
  key: string
  form: string
  status: ProposalStatus
  clientRef: string
  attempt: number
  previewHash: string | null
  formValues: unknown
  summary: unknown
  needs: unknown
  warningsAck: WarningKey[]
  error: unknown
  documentId: string | null
  updatedAt: string | null
}

function proposalStatusOf(v: unknown): ProposalStatus {
  return typeof v === 'string' && (PROPOSAL_STATUSES as readonly string[]).includes(v)
    ? (v as ProposalStatus)
    : 'needs_input'
}

export function warningKeysOf(v: unknown): WarningKey[] {
  if (!Array.isArray(v)) return []
  return [
    ...new Set(v.filter((k): k is WarningKey => (WARNING_KEYS as readonly unknown[]).includes(k))),
  ]
}

export const PROPOSAL_COLUMNS =
  'key, form, status, client_ref, attempt, preview_hash, form_values, summary, needs, warnings_ack, error, document_id, updated_at'

export function parseExistingProposal(r: Record<string, unknown>): ExistingProposal | null {
  const key = textOf(r.key)
  const clientRef = textOf(r.client_ref)
  const form = textOf(r.form)
  if (!key || !clientRef || !form) return null
  return {
    key,
    form,
    status: proposalStatusOf(r.status),
    clientRef,
    attempt: intOf(r.attempt) ?? 1,
    previewHash: textOf(r.preview_hash),
    formValues: r.form_values,
    summary: r.summary,
    needs: r.needs,
    warningsAck: warningKeysOf(r.warnings_ack),
    error: r.error ?? null,
    documentId: textOf(r.document_id),
    updatedAt: textOf(r.updated_at),
  }
}

async function loadProposals(
  supabase: Supabase,
  tenantId: string,
  batchId: string,
): Promise<Map<string, ExistingProposal>> {
  const rows = await pagedRows((a, b) =>
    supabase
      .from('acc_import_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .order('key')
      .range(a, b),
  )
  const out = new Map<string, ExistingProposal>()
  for (const r of rows) {
    const p = parseExistingProposal(r)
    if (p) out.set(p.key, p)
  }
  return out
}

type RuleRow = {
  id: string
  priority: number
  label: string
  match: unknown
  action: unknown
  updatedAt: string | null
}

async function loadRules(supabase: Supabase, tenantId: string, source: string): Promise<RuleRow[]> {
  const rows = await pagedRows(
    (a, b) =>
      supabase
        .from('acc_import_rules')
        .select('id, priority, label, match, action, updated_at')
        .eq('tenant_id', tenantId)
        .eq('source', source)
        .eq('active', true)
        .order('priority')
        .order('id')
        .range(a, b),
    5000,
  )
  const out: RuleRow[] = []
  for (const r of rows) {
    const id = textOf(r.id)
    if (!id) continue
    out.push({
      id,
      priority: intOf(r.priority) ?? 100,
      label: textOf(r.label) ?? '',
      match: r.match,
      action: r.action,
      updatedAt: textOf(r.updated_at),
    })
  }
  return out
}

export type MpConnectionRow = {
  id: string
  treasuryAccountId: string
  partyId: string
  status: string
  channelMethods: Partial<Record<MpCobroChannel, string>>
  dayCutoffHour: number
  updatedAt: string | null
}

export async function loadMpConnection(
  supabase: Supabase,
  tenantId: string,
): Promise<MpConnectionRow | null> {
  const { data, error } = await supabase
    .from('acc_mp_connections')
    .select(
      'id, treasury_account_id, party_id, status, channel_methods, day_cutoff_hour, updated_at',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  const r = asRecord(data)
  const id = textOf(r?.id)
  const treasury = textOf(r?.treasury_account_id)
  const party = textOf(r?.party_id)
  if (!r || !id || !treasury || !party) return null
  const methods: Partial<Record<MpCobroChannel, string>> = {}
  const raw = asRecord(r.channel_methods) ?? {}
  for (const channel of MP_COBRO_CHANNELS) {
    const v = textOf(raw[channel])
    if (v) methods[channel] = v
  }
  return {
    id,
    treasuryAccountId: treasury,
    partyId: party,
    status: textOf(r.status) ?? 'csv_only',
    channelMethods: methods,
    dayCutoffHour: intOf(r.day_cutoff_hour) ?? 0,
    updatedAt: textOf(r.updated_at),
  }
}

// ─── Mercado Pago: billetera, partícipe y medios ─────────────────────────────

const CHANNEL_NAME: Readonly<Record<MpCobroChannel, RegExp>> = {
  qr: /\bQR\b/i,
  point: /\bPOINT\b/i,
  link: /\bLINK\b/i,
  transfer_in: /TRANSF/i,
}

/**
 * La billetera, el partícipe y el medio del cierre de cada canal: lo
 * configurado en `acc_mp_connections`; lo que falta se deduce (un solo medio
 * de Mercado Pago cuyo nombre dice «QR», «Transferencia»…) y queda marcado.
 */
export function mpSettingsFor(
  conn: MpConnectionRow | null,
  catalog: ImportCatalog,
  batchTreasuryId: string | null,
): MpSettings | null {
  const partyId = conn?.partyId ?? systemParty(catalog, 'mercado_pago')?.id ?? null
  if (!partyId) return null
  const wallets = treasuriesOfKind(catalog, 'wallet')
  const treasuryId =
    batchTreasuryId ??
    conn?.treasuryAccountId ??
    wallets.find((w) => w.bankPartyId === partyId)?.id ??
    (wallets.length === 1 ? (wallets[0]?.id ?? null) : null)
  if (!treasuryId) return null
  const channelMethods: Partial<Record<MpCobroChannel, string>> = {}
  const inferred = new Set<MpCobroChannel>()
  for (const channel of MP_COBRO_CHANNELS) {
    const configured = conn?.channelMethods[channel]
    if (configured && catalog.methods.get(configured)?.active) {
      channelMethods[channel] = configured
      continue
    }
    const candidates = [...catalog.methods.values()].filter(
      (m) =>
        m.active &&
        (m.kind === 'settled_now' || m.kind === 'receivable') &&
        m.partyId === partyId &&
        CHANNEL_NAME[channel].test(m.name),
    )
    if (candidates.length === 1 && candidates[0]) {
      channelMethods[channel] = candidates[0].id
      inferred.add(channel)
    }
  }
  return { treasuryId, partyId, channelMethods, inferred }
}

// ─── Armar y escribir ────────────────────────────────────────────────────────

export type ProposalPatches = {
  decisions?: ReadonlyMap<string, ProposalDecisions>
  acks?: ReadonlyMap<string, readonly WarningKey[]>
  resets?: ReadonlySet<string>
  /** Propuestas `voided` que se vuelven a armar con otro intento («Volver a cargar»). */
  rearm?: ReadonlySet<string>
}

function sourceFailure(): AccFailureState {
  return {
    ok: false,
    code: 'conflict',
    message: 'Este tipo de archivo todavía no se puede revisar acá.',
    detail: { key: 'import_source_unsupported' },
  }
}

function mpWalletMissing(): AccFailureState {
  return {
    ok: false,
    code: 'conflict',
    message:
      'Falta la billetera de Mercado Pago: cargala en Ajustes › Cajas y cuentas (o elegila en Importar › Mercado Pago).',
    detail: { key: 'mp_wallet_missing' },
  }
}

/** El lote en un estado donde todavía se puede revisar. */
function reviewable(batch: BatchRow | null): batch is BatchRow {
  return batch !== null && ['staging', 'review', 'posting'].includes(batch.status)
}

/** Lo que va a `acc_import_put_proposals` (puede repetir la clave para vincular más de 5000 filas). */
function putPayloads(
  e: EvaluatedProposal,
  clientRef: string,
  attempt: number,
): Array<Record<string, unknown>> {
  const base = {
    key: e.key,
    form: e.form,
    form_values: e.formValues,
    summary: fitSummary(e.summary),
    client_ref: clientRef,
    attempt,
    status: e.status,
    preview_hash: e.previewHash,
    needs: fitNeeds(e.needs),
    warnings_ack: e.warningsAck,
    error: e.error,
  }
  const ids = [...e.itemIds]
  if (ids.length <= ITEM_IDS_CHUNK) return [{ ...base, item_ids: ids }]
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < ids.length; i += ITEM_IDS_CHUNK) {
    out.push({ ...base, item_ids: ids.slice(i, i + ITEM_IDS_CHUNK) })
  }
  return out
}

/** `summary` ≤ 4 KB: si el detalle no entra, se saca (la propuesta sigue completa en `form_values`). */
function fitSummary(summary: EvaluatedProposal['summary']): EvaluatedProposal['summary'] {
  if (estimateJsonbSize(summary) <= 3800) return summary
  const { detail: _detail, ...rest } = summary
  return rest
}

/** `needs` ≤ 8 KB. */
function fitNeeds(needs: EvaluatedProposal['needs']): EvaluatedProposal['needs'] {
  const out: EvaluatedProposal['needs'] = []
  for (const n of needs) {
    if (estimateJsonbSize([...out, n]) > 7800) break
    out.push(n)
  }
  return out
}

function sameAsStored(e: EvaluatedProposal, ex: ExistingProposal): boolean {
  return (
    ex.form === e.form &&
    ex.status === e.status &&
    ex.previewHash === e.previewHash &&
    stableStringify(ex.formValues) === stableStringify(e.formValues) &&
    stableStringify(ex.summary) === stableStringify(fitSummary(e.summary)) &&
    stableStringify(ex.needs) === stableStringify(fitNeeds(e.needs)) &&
    stableStringify(ex.error ?? null) === stableStringify(e.error ?? null) &&
    stableStringify([...ex.warningsAck].sort()) === stableStringify([...e.warningsAck].sort())
  )
}

/** `client_ref` por consulta (`in` en la URL de PostgREST) y consultas a la vez. */
const REF_CHUNK = 100
const REF_PARALLEL = 4

/** Corre `run` sobre cada tanda, de a `REF_PARALLEL` a la vez. */
async function eachChunk<T>(list: readonly T[], run: (chunk: T[]) => Promise<void>): Promise<void> {
  const all = chunks(list, REF_CHUNK)
  for (let i = 0; i < all.length; i += REF_PARALLEL) {
    await Promise.all(all.slice(i, i + REF_PARALLEL).map(run))
  }
}

/**
 * De estos `client_ref`, los que ya generaron un comprobante anulado o
 * revertido: `acc_import_put_proposals` no los acepta en una propuesta nueva
 * ni en una rearmada (`invalid_payload · attempt`).
 */
async function burnedClientRefs(
  supabase: Supabase,
  tenantId: string,
  refs: readonly string[],
): Promise<Set<string>> {
  const burned = new Set<string>()
  const refOfBundle = new Map<string, string>()
  await eachChunk(refs, async (chunk) => {
    const { data, error } = await supabase
      .from('acc_bundles')
      .select('id, client_ref')
      .eq('tenant_id', tenantId)
      .in('client_ref', chunk)
    if (error) throw error
    for (const raw of Array.isArray(data) ? data : []) {
      const r = asRecord(raw)
      const id = textOf(r?.id)
      const ref = textOf(r?.client_ref)
      if (id && ref) refOfBundle.set(id, ref)
    }
  })
  if (refOfBundle.size === 0) return burned
  const refOfLiveDoc = new Map<string, string>()
  await eachChunk([...refOfBundle.keys()], async (chunk) => {
    const { data, error } = await supabase
      .from('acc_documents')
      .select('id, bundle_id, status')
      .eq('tenant_id', tenantId)
      .in('bundle_id', chunk)
    if (error) throw error
    for (const raw of Array.isArray(data) ? data : []) {
      const r = asRecord(raw)
      const id = textOf(r?.id)
      const ref = refOfBundle.get(textOf(r?.bundle_id) ?? '')
      if (!id || !ref) continue
      if (r?.status === 'posted') refOfLiveDoc.set(id, ref)
      else burned.add(ref)
    }
  })
  if (refOfLiveDoc.size === 0) return burned
  await eachChunk([...refOfLiveDoc.keys()], async (chunk) => {
    const { data, error } = await supabase
      .from('acc_documents')
      .select('reverses_document_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'posted')
      .in('reverses_document_id', chunk)
    if (error) throw error
    for (const raw of Array.isArray(data) ? data : []) {
      const ref = refOfLiveDoc.get(textOf(asRecord(raw)?.reverses_document_id) ?? '')
      if (ref) burned.add(ref)
    }
  })
  return burned
}

/** El primer intento libre de cada clave, desde el pedido (ver `burnedClientRefs`). */
async function freeAttempts(
  supabase: Supabase,
  tenantId: string,
  wanted: ReadonlyArray<{ key: string; attempt: number }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  let round = [...wanted]
  while (round.length > 0) {
    const byRef = new Map(round.map((w) => [importClientRef(tenantId, w.key, w.attempt), w]))
    const burned = await burnedClientRefs(supabase, tenantId, [...byRef.keys()])
    const next: Array<{ key: string; attempt: number }> = []
    for (const [ref, w] of byRef) {
      if (burned.has(ref) && w.attempt < MAX_ATTEMPT)
        next.push({ key: w.key, attempt: w.attempt + 1 })
      else out.set(w.key, w.attempt)
    }
    round = next
  }
  return out
}

/** Con la nota de «carga nueva» cuando es un intento posterior a una anulación. */
function withAttemptNote(e: EvaluatedProposal, attempt: number): EvaluatedProposal {
  if (attempt <= 1 || e.summary.notes?.includes('reimport')) return e
  return { ...e, summary: { ...e.summary, notes: [...(e.summary.notes ?? []), 'reimport'] } }
}

function recentPosting(p: ExistingProposal, now: number): boolean {
  if (p.status !== 'posting') return false
  const at = p.updatedAt ? Date.parse(p.updatedAt) : Number.NaN
  return Number.isFinite(at) && now - at < POSTING_GRACE_MS
}

/** Escribe en tandas; devuelve los conteos del último llamado. */
export async function putProposals(
  supabase: Supabase,
  tenantId: string,
  batchId: string,
  payloads: ReadonlyArray<Record<string, unknown>>,
): Promise<{ ok: true; counts: ImportBatchCounts | null } | { ok: false; state: AccFailureState }> {
  let counts: ImportBatchCounts | null = null
  for (let i = 0; i < payloads.length; i += PUT_PROPOSALS_CHUNK) {
    const { data, error } = await supabase.rpc('acc_import_put_proposals', {
      p_tenant_id: tenantId,
      p_batch_id: batchId,
      p_proposals: payloads.slice(i, i + PUT_PROPOSALS_CHUNK),
    })
    if (error) return { ok: false, state: rpcFailure('imports.putProposals', error) }
    counts = parseBatchCounts(asRecord(data)?.counts) ?? counts
  }
  return { ok: true, counts }
}

/** El item cuya clave natural es la de la propuesta (o la de su prefijo `<clave>:<sufijo>`). */
function itemOfKey(items: ReadonlyMap<string, RawItem>, key: string): RawItem | null {
  const direct = items.get(key)
  if (direct) return direct
  const cut = key.lastIndexOf(':')
  return cut > 0 ? (items.get(key.slice(0, cut)) ?? null) : null
}

/**
 * Arma (o vuelve a armar) todas las propuestas del lote y escribe lo que
 * cambió. `patches` trae las decisiones nuevas de la revisión.
 */
export async function rebuildBatch(
  auth: AccountingAuthorized,
  batchId: string,
  patches: ProposalPatches = {},
): Promise<AccSimpleState<BuildProposalsResult>> {
  const tenantId = auth.tenantId
  const supabase = await createClient()
  const batch = await loadBatch(supabase, tenantId, batchId)
  if (!reviewable(batch)) return accFailure('import_batch_closed')
  if (!(PROPOSAL_SOURCES as readonly string[]).includes(batch.source)) return sourceFailure()

  const [rawItems, existing] = await Promise.all([
    loadItems(supabase, tenantId, batchId),
    loadProposals(supabase, tenantId, batchId),
  ])
  let catalogRaw: PostingCatalog
  try {
    catalogRaw = await loadPostingCatalog(tenantId)
  } catch (error) {
    if (error instanceof AccountingContextError) return error.state
    throw error
  }
  const catalog = importCatalogFrom(catalogRaw)

  const decisionsOf = (key: string): ProposalDecisions => {
    if (patches.resets?.has(key)) return patches.decisions?.get(key) ?? {}
    const stored = decisionsFromSummary(existing.get(key)?.summary)
    const patch = patches.decisions?.get(key)
    return patch ? mergeDecisions(stored, patch) : stored
  }
  const rearming = (key: string) =>
    existing.get(key)?.status === 'voided' && patches.rearm?.has(key) === true
  const acksOf = (key: string): WarningKey[] => {
    const stored =
      patches.resets?.has(key) || rearming(key) ? [] : (existing.get(key)?.warningsAck ?? [])
    return [...new Set([...stored, ...(patches.acks?.get(key) ?? [])])].sort()
  }
  // No toman partidas abiertas: las cargadas (ya las aplicaron) y las anuladas que siguen así.
  const frozen = (key: string) => {
    const status = existing.get(key)?.status
    return status === 'posted' || (status === 'voided' && !rearming(key))
  }
  const allDecisions = [...existing.keys()].map(decisionsOf)
  for (const [key, d] of patches.decisions ?? []) if (!existing.has(key)) allDecisions.push(d)

  // ── Lo que necesita cada origen ──
  const openItemsOf: Array<{ partyId: string; accountId?: string | null }> = []
  let rulesSkipped = 0
  let build: (pool: OpenItemPool) => ProposalDraft[]
  switch (batch.source) {
    case 'arca_recibidos': {
      const items = staged(rawItems, (d) => mcItemSchema.safeParse(d))
      const rules = otherTaxesRulesFrom(await loadRules(supabase, tenantId, 'arca_recibidos'))
      const matches = await matchPurchases(supabase, tenantId, purchaseMatchRows(items, catalog))
      if (allDecisions.some((d) => d.settles_commissions === true)) {
        const mp = systemParty(catalog, 'mercado_pago')
        const pending = catalogRaw.accounts.find((a) => a.systemKey === 'vat_credit_pending')
        if (mp) openItemsOf.push({ partyId: mp.id, accountId: pending?.id ?? null })
      }
      build = () => buildArcaDrafts({ items, catalog, rules, matches, decisions: decisionsOf })
      break
    }
    case 'mp_release': {
      const items = staged(rawItems, (d) => mpItemSchema.safeParse(d))
      const conn = await loadMpConnection(supabase, tenantId)
      const settings = mpSettingsFor(conn, catalog, batch.treasuryAccountId)
      if (!settings) return mpWalletMissing()
      const { rules: taxRules, skipped } = mpTaxRulesFrom(
        await loadRules(supabase, tenantId, 'mp_release'),
      )
      rulesSkipped = skipped
      const days = items.map((s) => s.item.businessDate).sort()
      const from = days[0] ?? null
      const to = days[days.length - 1] ?? null
      const methodParties = Object.values(settings.channelMethods)
        .map((id) => (id ? catalog.methods.get(id)?.partyId : null))
        .filter((id): id is string => typeof id === 'string')
      const partyIds = [...new Set([settings.partyId, ...methodParties])]
      const [manualDays, postedTransfers] =
        from && to
          ? await Promise.all([
              loadManualMpDays(supabase, tenantId, {
                partyIds,
                walletId: settings.treasuryId,
                from,
                to,
              }),
              loadPostedTransfers(supabase, tenantId, {
                treasuryIds: [...catalog.treasuries.keys()],
                from,
                to,
              }),
            ])
          : [new Set<string>(), []]
      for (const id of partyIds) openItemsOf.push({ partyId: id })
      for (const d of allDecisions) if (d.party_id) openItemsOf.push({ partyId: d.party_id })
      build = (pool) =>
        buildMpDrafts({
          batchId,
          items,
          catalog,
          settings,
          pool,
          manualDays,
          postedTransfers,
          taxRules,
          decisions: decisionsOf,
          frozen,
        })
      break
    }
    case 'bank_statement': {
      const treasuryId = batch.treasuryAccountId
      if (!treasuryId) return accFailure('import_batch_closed')
      const items = staged(rawItems, (d) => bankItemSchema.safeParse(d))
      const { rules, skipped } = bankRulesFrom(
        await loadRules(supabase, tenantId, 'bank_statement'),
      )
      rulesSkipped = skipped
      const days = items.map((s) => s.item.date).sort()
      const from = days[0]
      const to = days[days.length - 1]
      const conn = await loadMpConnection(supabase, tenantId)
      const mpSettings = mpSettingsFor(conn, catalog, null)
      const [manualExpenses, postedTransfers] =
        from && to
          ? await Promise.all([
              loadManualBankExpenses(supabase, tenantId, { treasuryId, from, to }),
              loadPostedTransfers(supabase, tenantId, {
                treasuryIds: [treasuryId],
                from,
                to,
              }),
            ])
          : [new Set<string>(), []]
      for (const r of rules) {
        if (r.action.kind === 'payment' || r.action.kind === 'collection') {
          openItemsOf.push({ partyId: r.action.partyId })
        }
      }
      for (const d of allDecisions) if (d.party_id) openItemsOf.push({ partyId: d.party_id })
      build = (pool) =>
        buildBankDrafts({
          batchId,
          treasuryId,
          items,
          catalog,
          rules,
          pool,
          manualExpenses,
          postedTransfers,
          mpTreasuryId: mpSettings?.treasuryId ?? null,
          decisions: decisionsOf,
          frozen,
        })
      break
    }
    default:
      return sourceFailure()
  }

  // ── Contexto del motor (con las partidas que se van a aplicar) ──
  const refs: PostingContextRefs = {
    openItemsOf: dedupeParties(openItemsOf).filter((p) => catalog.parties.has(p.partyId)),
  }
  const [loaded, firstOpenDate] = await Promise.all([
    tryLoadPostingContext(tenantId, refs),
    loadFirstOpenDate(tenantId),
  ])
  if (!loaded.ok) return loaded.state
  const ctx = loaded.ctx
  const drafts = build(new OpenItemPool(ctx.openItems.values()))

  // ── Evaluar y comparar con lo guardado ──
  const now = Date.now()
  const payloads: Array<Record<string, unknown>> = []
  const finalStatus = new Map<string, ProposalStatus>()
  for (const p of existing.values()) finalStatus.set(p.key, p.status)
  let written = 0
  let unchanged = 0
  const produced = new Set<string>()
  // Las nuevas y las rearmadas llevan un client_ref nuevo; las demás conservan el suyo.
  const toWrite: Array<{ e: EvaluatedProposal; attempt: number; clientRef: string | null }> = []
  for (const draft of drafts) {
    if (produced.has(draft.key)) continue
    produced.add(draft.key)
    const ex = existing.get(draft.key)
    if (ex && (ex.status === 'posted' || recentPosting(ex, now))) continue
    // Anulada: queda así hasta «Volver a cargar»; ahí va con otro intento (la base lo exige).
    const rearm = ex?.status === 'voided'
    if (rearm && (!rearming(draft.key) || ex.attempt >= MAX_ATTEMPT)) continue
    const e = evaluateDraft(draft, ctx, { firstOpenDate, warningsAck: acksOf(draft.key) })
    if (ex && !rearm) {
      const kept = withAttemptNote(e, ex.attempt)
      if (sameAsStored(kept, ex)) {
        unchanged++
        continue
      }
      toWrite.push({ e: kept, attempt: ex.attempt, clientRef: ex.clientRef })
      continue
    }
    toWrite.push({ e, attempt: rearm ? ex.attempt + 1 : 1, clientRef: null })
  }
  const fresh = toWrite.filter((w) => w.clientRef === null)
  const attempts =
    fresh.length > 0
      ? await freeAttempts(
          supabase,
          tenantId,
          fresh.map((w) => ({ key: w.e.key, attempt: w.attempt })),
        )
      : new Map<string, number>()
  for (const w of toWrite) {
    const attempt = w.clientRef === null ? (attempts.get(w.e.key) ?? w.attempt) : w.attempt
    const clientRef = w.clientRef ?? importClientRef(tenantId, w.e.key, attempt)
    const e = withAttemptNote(w.e, attempt)
    payloads.push(...putPayloads(e, clientRef, attempt))
    finalStatus.set(e.key, e.status)
    written++
  }

  // ── Lo que ya no sale del armado ──
  const itemsByKey = new Map(rawItems.map((r) => [r.key, r]))
  for (const ex of existing.values()) {
    if (produced.has(ex.key)) continue
    if (['posted', 'skipped', 'voided'].includes(ex.status) || recentPosting(ex, now)) continue
    const item = itemOfKey(itemsByKey, ex.key)
    const error: ProposalError = { reason: item?.status === 'ignored' ? 'ignored' : 'replaced' }
    payloads.push({
      key: ex.key,
      form: ex.form,
      form_values: asRecord(ex.formValues) ?? {},
      summary: asRecord(ex.summary) ?? {},
      client_ref: ex.clientRef,
      attempt: ex.attempt,
      status: 'skipped',
      preview_hash: null,
      needs: [],
      warnings_ack: ex.warningsAck,
      item_ids: [],
      error,
    })
    finalStatus.set(ex.key, 'skipped')
    written++
  }

  let counts = batch.counts
  if (payloads.length > 0) {
    const put = await putProposals(supabase, tenantId, batchId, payloads)
    if (!put.ok) return put.state
    counts = put.counts ?? counts
  }

  const byStatus = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as Record<
    ProposalStatus,
    number
  >
  for (const s of finalStatus.values()) byStatus[s]++
  // La base pudo saltear propuestas (ya cargadas desde otro lote): mandan sus conteos.
  if (counts) {
    byStatus.needs_input = counts.needsInput
    byStatus.ready = counts.ready
    byStatus.posting = counts.posting
    byStatus.posted = counts.posted
    byStatus.stale = counts.stale
    byStatus.error = counts.error
    byStatus.skipped = counts.skipped
    byStatus.voided = counts.voided
  }
  return {
    ok: true,
    data: { byStatus, written, unchanged, rulesSkipped, counts },
    message:
      byStatus.needs_input > 0
        ? `Listo: ${byStatus.ready} para cargar y ${byStatus.needs_input} para revisar.`
        : `Listo: ${byStatus.ready} para cargar.`,
  }
}

function dedupeParties(
  list: ReadonlyArray<{ partyId: string; accountId?: string | null }>,
): Array<{ partyId: string; accountId?: string | null }> {
  // Un partícipe pedido entero (sin cuenta) ya trae todas sus partidas.
  const whole = new Set(list.filter((p) => !p.accountId).map((p) => p.partyId))
  const seen = new Set<string>()
  const out: Array<{ partyId: string; accountId?: string | null }> = []
  for (const p of list) {
    if (p.accountId && whole.has(p.partyId)) continue
    const id = `${p.partyId}|${p.accountId ?? ''}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(p.accountId ? p : { partyId: p.partyId })
  }
  return out
}

// ─── Cambios de la revisión ──────────────────────────────────────────────────

function invalidChange(message: string): AccFailureState {
  return { ok: false, code: 'invalid', message, detail: { key: 'invalid_change' } }
}

/** Una edición parcial de un partícipe (`acc_save_party` con `id` y solo lo que cambia). */
async function editParty(
  supabase: Supabase,
  tenantId: string,
  catalog: PostingCatalog,
  partyId: string,
  patch: Record<string, unknown>,
): Promise<AccFailureState | null> {
  const party = catalog.parties.find((p) => p.id === partyId)
  if (!party) return accFailure('party_not_found')
  const { error } = await supabase.rpc('acc_save_party', {
    p_tenant_id: tenantId,
    p_party: { id: partyId, ...patch },
    p_expected_updated_at: party.updatedAt,
  })
  return error ? rpcFailure('imports.editParty', error) : null
}

function isPurchaseAccount(catalog: PostingCatalog, accountId: string): boolean {
  const a = catalog.accounts.find((x) => x.id === accountId)
  return !!a && a.postable && a.active && a.purchaseSelectable
}

/**
 * `resolveImportNeeds`: aplica los cambios (los de datos maestros con sus RPC,
 * los de una propuesta como decisión) y vuelve a armar el lote.
 */
export async function resolveImportNeedsFor(
  auth: AccountingAuthorized,
  raw: unknown,
): Promise<AccSimpleState<BuildProposalsResult>> {
  const parsed = resolveImportNeedsSchema.safeParse(raw)
  if (!parsed.success) return invalidState(parsed.error)
  const { batchId, changes } = parsed.data
  const tenantId = auth.tenantId
  const supabase = await createClient()
  const batch = await loadBatch(supabase, tenantId, batchId)
  if (!reviewable(batch)) return accFailure('import_batch_closed')
  const existing = await loadProposals(supabase, tenantId, batchId)
  let catalog: PostingCatalog
  try {
    catalog = await loadPostingCatalog(tenantId)
  } catch (error) {
    if (error instanceof AccountingContextError) return error.state
    throw error
  }

  const decisions = new Map<string, ProposalDecisions>()
  const acks = new Map<string, WarningKey[]>()
  const resets = new Set<string>()
  const rearm = new Set<string>()
  const decide = (key: string, patch: ProposalDecisions) => {
    decisions.set(key, mergeDecisions(decisions.get(key) ?? {}, patch))
  }
  const known = (key: string | null): key is string => key !== null && existing.has(key)

  const applyChange = async (change: ImportChange): Promise<AccFailureState | null> => {
    switch (change.kind) {
      case 'supplier_account':
        if (!isPurchaseAccount(catalog, change.accountId)) {
          return invalidChange('Elegí una cuenta de compras o gastos.')
        }
        return editParty(supabase, tenantId, catalog, change.partyId, {
          default_account_id: change.accountId,
        })
      case 'supplier_condition':
        return editParty(supabase, tenantId, catalog, change.partyId, {
          iva_condition: change.ivaCondition,
        })
      case 'other_taxes_as': {
        const patch: ProposalDecisions = {
          other_taxes_as: change.as,
          ...(change.accountId ? { other_taxes_account_id: change.accountId } : {}),
          ...(change.jurisdictionCode !== null
            ? { jurisdiction_code: change.jurisdictionCode }
            : {}),
        }
        if (change.proposalKey !== null) {
          if (!known(change.proposalKey))
            return invalidChange('Recargá la página y probá de nuevo.')
          decide(change.proposalKey, patch)
        } else if (change.partyId !== null) {
          // Todas las del proveedor en este lote.
          for (const p of existing.values()) {
            const needs = Array.isArray(p.needs) ? p.needs : []
            if (
              needs.some(
                (n) =>
                  asRecord(n)?.key === 'other_taxes_as' && asRecord(n)?.party_id === change.partyId,
              )
            ) {
              decide(p.key, patch)
            }
          }
        }
        if (change.remember && change.partyId !== null) {
          return saveOtherTaxesRule(supabase, tenantId, catalog, change)
        }
        return null
      }
      case 'ignore':
      case 'unignore': {
        const { error } = await supabase.rpc('acc_import_set_items', {
          p_tenant_id: tenantId,
          p_batch_id: batchId,
          p_changes: [
            {
              kind: change.kind,
              item_ids: change.itemIds,
              ...(change.reason ? { reason: change.reason } : {}),
            },
          ],
        })
        return error ? rpcFailure('imports.setItems', error) : null
      }
      case 'channel_method': {
        const conn = await loadMpConnection(supabase, tenantId)
        const { error } = await supabase.rpc('acc_mp_save_connection', {
          p_tenant_id: tenantId,
          p_patch: { channel_methods: { [change.channel]: change.salesMethodId } },
          p_expected_updated_at: conn?.updatedAt ?? null,
        })
        return error ? rpcFailure('imports.channelMethod', error) : null
      }
      case 'pick_party':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        if (!catalog.parties.some((p) => p.id === change.partyId && p.active)) {
          return accFailure('party_not_found')
        }
        decide(change.proposalKey, { party_id: change.partyId })
        return null
      case 'pick_treasury':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        if (!catalog.treasuries.some((t) => t.id === change.treasuryAccountId && t.active)) {
          return accFailure('treasury_not_found')
        }
        decide(change.proposalKey, { treasury_id: change.treasuryAccountId })
        return null
      case 'pick_account':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        if (!catalog.accounts.some((a) => a.id === change.accountId && a.postable && a.active)) {
          return accFailure('account_not_found')
        }
        decide(
          change.proposalKey,
          change.tax
            ? { tax_accounts: { [change.tax]: change.accountId } }
            : { counterpart_account_id: change.accountId },
        )
        return null
      case 'link_credit_note':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        decide(change.proposalKey, { credit_note_document_id: change.documentId })
        return null
      case 'settles_commissions': {
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        decide(change.proposalKey, { settles_commissions: change.value })
        if (!change.value) return null
        // La factura mensual de comisiones va a nombre del partícipe de sistema: le carga la CUIT.
        const mp = catalog.parties.find((p) => p.systemKey === 'mercado_pago')
        const detail = asRecord(asRecord(existing.get(change.proposalKey)?.summary)?.detail)
        const cuit = textOf(detail?.cuit)
        if (mp && !mp.taxId && cuit && parseCuit(cuit).ok) {
          return editParty(supabase, tenantId, catalog, mp.id, {
            tax_id_type: 'cuit',
            tax_id: cuit,
          })
        }
        return null
      }
      case 'accept_warning': {
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        acks.set(change.proposalKey, [...(acks.get(change.proposalKey) ?? []), change.warning])
        return null
      }
      case 'confirm':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        decide(change.proposalKey, { confirmed: [change.need] })
        return null
      case 'reset':
        if (!known(change.proposalKey)) return invalidChange('Recargá la página y probá de nuevo.')
        resets.add(change.proposalKey)
        decisions.delete(change.proposalKey)
        acks.delete(change.proposalKey)
        return null
      case 'reimport': {
        const current = existing.get(change.proposalKey)
        if (current?.status !== 'voided')
          return invalidChange('Recargá la página y probá de nuevo.')
        if (current.attempt >= MAX_ATTEMPT) {
          return invalidChange('Ya se volvió a cargar demasiadas veces: cargalo a mano.')
        }
        rearm.add(change.proposalKey)
        return null
      }
    }
  }

  for (const change of changes) {
    const failure = await applyChange(change)
    if (failure) return failure
  }
  const result = await rebuildBatch(auth, batchId, { decisions, acks, resets, rearm })
  if (result.ok) revalidateAdministracion(auth.slug)
  return result
}

/** «Recordar para este proveedor»: una regla por proveedor (se edita si ya hay una). */
async function saveOtherTaxesRule(
  supabase: Supabase,
  tenantId: string,
  catalog: PostingCatalog,
  change: Extract<ImportChange, { kind: 'other_taxes_as' }>,
): Promise<AccFailureState | null> {
  const partyId = change.partyId
  if (!partyId) return null
  const party = catalog.parties.find((p) => p.id === partyId)
  if (!party) return accFailure('party_not_found')
  const rules = await loadRules(supabase, tenantId, 'arca_recibidos')
  const current = rules.find(
    (r) => asRecord(r.match)?.party_id === partyId && asRecord(r.action)?.kind === 'other_taxes',
  )
  const action: Record<string, unknown> = { kind: 'other_taxes', other_taxes_as: change.as }
  if (change.accountId) action.account_id = change.accountId
  if (change.jurisdictionCode !== null) action.jurisdiction_code = change.jurisdictionCode
  const rule: Record<string, unknown> = {
    label: `Otros tributos de ${party.tradeName ?? party.name}`.slice(0, 120),
    match: { party_id: partyId },
    action,
  }
  if (current) rule.id = current.id
  else rule.source = 'arca_recibidos'
  const { error } = await supabase.rpc('acc_import_save_rule', {
    p_tenant_id: tenantId,
    p_rule: rule,
    p_expected_updated_at: current?.updatedAt ?? null,
  })
  return error ? rpcFailure('imports.saveRule', error) : null
}

// ─── Proveedores nuevos ──────────────────────────────────────────────────────

/**
 * «Crear N proveedores»: uno por CUIT, con su cuenta habitual
 * (`default_account_id`). Si la CUIT ya existe (otra pestaña la creó), se le
 * completa la cuenta habitual si no tenía. Después vuelve a armar el lote.
 */
export async function createImportSuppliersFor(
  auth: AccountingAuthorized,
  raw: unknown,
): Promise<AccSimpleState<CreateImportSuppliersResult>> {
  const parsed = createImportSuppliersSchema.safeParse(raw)
  if (!parsed.success) return invalidState(parsed.error)
  const { batchId, suppliers } = parsed.data
  const tenantId = auth.tenantId
  const supabase = await createClient()
  const batch = await loadBatch(supabase, tenantId, batchId)
  if (!reviewable(batch)) return accFailure('import_batch_closed')
  let catalog: PostingCatalog
  try {
    catalog = await loadPostingCatalog(tenantId)
  } catch (error) {
    if (error instanceof AccountingContextError) return error.state
    throw error
  }

  const created: CreateImportSuppliersResult['created'] = []
  const failed: CreateImportSuppliersResult['failed'] = []
  const done = new Set<string>()
  for (const s of suppliers) {
    if (done.has(s.cuit)) continue
    done.add(s.cuit)
    if (!parseCuit(s.cuit).ok) {
      failed.push({ cuit: s.cuit, message: 'El CUIT no es válido: revisá el último número.' })
      continue
    }
    if (!isPurchaseAccount(catalog, s.accountId)) {
      failed.push({ cuit: s.cuit, message: 'Elegí una cuenta de compras o gastos.' })
      continue
    }
    const existingParty = catalog.parties.find((p) => p.taxId === s.cuit)
    if (existingParty) {
      if (!existingParty.defaultAccountId) {
        const err = await editParty(supabase, tenantId, catalog, existingParty.id, {
          default_account_id: s.accountId,
        })
        if (err) {
          failed.push({ cuit: s.cuit, message: err.message })
          continue
        }
      }
      created.push({ cuit: s.cuit, partyId: existingParty.id, name: existingParty.name })
      continue
    }
    const { data, error } = await supabase.rpc('acc_save_party', {
      p_tenant_id: tenantId,
      p_party: {
        kind: 'supplier',
        name: s.name,
        tax_id_type: 'cuit',
        tax_id: s.cuit,
        iva_condition: s.ivaCondition,
        payment_term_days: s.paymentTermDays,
        default_account_id: s.accountId,
      },
      p_expected_updated_at: null,
    })
    if (error) {
      failed.push({ cuit: s.cuit, message: mapAccError(error).message })
      continue
    }
    const id = textOf(asRecord(data)?.id)
    if (id) created.push({ cuit: s.cuit, partyId: id, name: s.name })
  }

  const rebuilt = created.length > 0 ? await rebuildBatch(auth, batchId) : null
  revalidateAdministracion(auth.slug)
  const n = created.length
  return {
    ok: true,
    data: { created, failed, build: rebuilt?.ok ? rebuilt.data : null },
    message:
      failed.length > 0
        ? `${n} ${n === 1 ? 'proveedor listo' : 'proveedores listos'}; ${failed.length} no se pudieron crear.`
        : `${n} ${n === 1 ? 'proveedor listo' : 'proveedores listos'}.`,
  }
}

// Para los tests: la forma exacta de lo que se escribe.
export const __test = { putPayloads, sameAsStored, dedupeParties, itemOfKey, withAttemptNote }
