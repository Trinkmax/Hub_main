import 'server-only'

/**
 * Confirmar (diseño §4.0, «Confirmar en tandas»): las propuestas elegidas, de a
 * hasta 15 por llamada, cada una con SU `acc_post_bundle` (un comprobante por
 * bundle) y después `acc_import_mark_posted`.
 *
 * - **Reanudable y sin duplicar.** Antes de armar nada se busca el bundle por
 *   el `client_ref` de la propuesta: si un intento anterior se cortó después de
 *   guardar, se marca y listo. `acc_post_bundle` es idempotente por
 *   `client_ref` (mismo pedido → `replayed`); dos pestañas a la vez chocan en
 *   `abd_client_ref_uq` y la segunda ve lo de la primera.
 * - **«Lo que se ve es lo que se guarda» (E.7).** Cada propuesta se vuelve a
 *   armar con el contexto DE LA BASE y su `form_values`. Si el hash no es el que
 *   vio la persona → `stale` con el hash nuevo (se vuelve a mostrar).
 * - **Avisos.** Los que se aceptan por lote llegan en `acceptWarnings` (el
 *   resumen previo los mostró); los demás, y los que solo ve la base
 *   (`warning_requires_ack`), dejan la propuesta en `needs_input`.
 * - **Transferencias.** Justo antes de cargar se vuelve a buscar la misma
 *   transferencia ya cargada (±3 días): un retiro que entró por el otro
 *   importador mientras tanto no se carga dos veces.
 * - Cada propuesta termina `posted`, `stale`, `needs_input`, `skipped` o `error`
 *   con el motivo en palabras simples (`error.message`). Una `voided` (su
 *   comprobante se anuló) no se carga: se vuelve a armar con «Volver a cargar».
 *
 * Con la sesión del usuario: `acc_post_bundle` exige un escritor (D7: el cron
 * nunca contabiliza). Nunca se loguean datos: solo la operación y la clave.
 */

import type { AccountingAuthorized } from '@/lib/accounting/access'
import {
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { accFailure, asRecord, rpcFailure, textOf } from '@/lib/accounting/actions/support'
import {
  AccountingContextError,
  loadPostingCatalog,
  type PostingContextRefs,
  tryLoadPostingContext,
} from '@/lib/accounting/context'
import { engineErrorsState, mapAccError, type PgLikeError } from '@/lib/accounting/errors'
import { toRpcPayload } from '@/lib/accounting/posting'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import {
  buildPrimary,
  isDocumentForm,
  type ParsedDocumentForm,
  parseDocumentForm,
} from '@/lib/accounting/server/document-forms'
import {
  dbWarnings,
  logFailure,
  revalidateAdministracion,
} from '@/lib/accounting/server/post-document'
import { parsePostBundleResult } from '@/lib/accounting/server/rpc-results'
import type { PostingResult, WarningKey } from '@/lib/accounting/types'
import { createClient } from '@/lib/supabase/server'
import { findPostedTransfer } from './proposals/mp'
import {
  type ExistingProposal,
  PROPOSAL_COLUMNS,
  parseExistingProposal,
  putProposals,
} from './propose'
import {
  batchStatusOf,
  loadBatch,
  loadPostedTransfers,
  pagedRows,
  parseBatchCounts,
  type Supabase,
} from './stage'
import {
  type ImportBatchCounts,
  type ImportBatchStatus,
  type ImportNeed,
  NEED_KEYS,
  type PostImportResult,
  type PostItemResult,
  PROPOSAL_VOIDED_TEXT,
  type ProposalError,
  postImportProposalsSchema,
  SKIP_REASON_TEXT,
  type SkipReason,
} from './types'

// ─── Lecturas ────────────────────────────────────────────────────────────────

async function loadByKeys(
  supabase: Supabase,
  tenantId: string,
  batchId: string,
  keys: readonly string[],
): Promise<Map<string, ExistingProposal>> {
  const out = new Map<string, ExistingProposal>()
  if (keys.length === 0) return out
  const rows = await pagedRows((a, b) =>
    supabase
      .from('acc_import_proposals')
      .select(PROPOSAL_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('batch_id', batchId)
      .in('key', [...keys])
      .order('key')
      .range(a, b),
  )
  for (const r of rows) {
    const p = parseExistingProposal(r)
    if (p) out.set(p.key, p)
  }
  return out
}

type BundleRow = { id: string; clientRef: string; result: unknown }

/** Los bundles ya guardados con estos `client_ref` (lo que un intento anterior dejó hecho). */
async function loadBundles(
  supabase: Supabase,
  tenantId: string,
  clientRefs: readonly string[],
): Promise<Map<string, BundleRow>> {
  const out = new Map<string, BundleRow>()
  if (clientRefs.length === 0) return out
  const { data, error } = await supabase
    .from('acc_bundles')
    .select('id, client_ref, result')
    .eq('tenant_id', tenantId)
    .in('client_ref', [...new Set(clientRefs)])
  if (error) throw error
  for (const raw of Array.isArray(data) ? data : []) {
    const r = asRecord(raw)
    const id = textOf(r?.id)
    const clientRef = textOf(r?.client_ref)
    if (id && clientRef) out.set(clientRef, { id, clientRef, result: r?.result })
  }
  return out
}

/** El comprobante de un bundle de un solo comprobante. */
async function documentOfBundle(
  supabase: Supabase,
  tenantId: string,
  bundle: BundleRow,
): Promise<string | null> {
  const fromResult = parsePostBundleResult(bundle.result).documents[0]?.id
  if (fromResult) return fromResult
  const { data, error } = await supabase
    .from('acc_documents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('bundle_id', bundle.id)
    .order('seq')
    .limit(1)
  if (error) throw error
  return textOf(asRecord(Array.isArray(data) ? data[0] : null)?.id)
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

/** Dos envíos iguales a la vez: el segundo choca con el `client_ref` del primero. */
function isClientRefRace(error: PgLikeError): boolean {
  if (error.code !== '23505') return false
  return `${error.message ?? ''} ${error.details ?? ''}`.includes('abd_client_ref_uq')
}

function needsOf(raw: unknown): ImportNeed[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (n): n is ImportNeed =>
      typeof n === 'object' &&
      n !== null &&
      (NEED_KEYS as readonly unknown[]).includes((n as { key?: unknown }).key),
  )
}

function skipMessage(error: unknown): string {
  const reason = asRecord(error)?.reason
  return typeof reason === 'string' && Object.hasOwn(SKIP_REASON_TEXT, reason)
    ? SKIP_REASON_TEXT[reason as SkipReason]
    : SKIP_REASON_TEXT.nothing_to_load
}

/** La propuesta como la vuelve a escribir `acc_import_put_proposals` (solo cambia lo que se pasa). */
function rewrite(
  p: ExistingProposal,
  patch: {
    status: string
    preview_hash?: string | null
    needs?: ImportNeed[]
    warnings_ack?: readonly WarningKey[]
    error?: ProposalError | null
  },
): Record<string, unknown> {
  return {
    key: p.key,
    form: p.form,
    form_values: asRecord(p.formValues) ?? {},
    summary: asRecord(p.summary) ?? {},
    client_ref: p.clientRef,
    attempt: p.attempt,
    status: patch.status,
    preview_hash: patch.preview_hash === undefined ? p.previewHash : patch.preview_hash,
    needs: patch.needs ?? needsOf(p.needs),
    warnings_ack: [...(patch.warnings_ack ?? p.warningsAck)],
    error: patch.error === undefined ? null : patch.error,
  }
}

function postError(state: AccFailureState): ProposalError {
  const key = typeof state.detail?.key === 'string' ? state.detail.key : null
  return { reason: 'post_failed', key, message: state.message }
}

type Ready = {
  p: ExistingProposal
  built: Extract<PostingResult, { ok: true }>
  acks: WarningKey[]
}

// ─── Confirmar ───────────────────────────────────────────────────────────────

/** `postImportProposals`: una tanda (hasta 15) de propuestas del lote. */
export async function postImportProposalsFor(
  auth: AccountingAuthorized,
  raw: unknown,
): Promise<AccSimpleState<PostImportResult>> {
  const parsed = postImportProposalsSchema.safeParse(raw)
  if (!parsed.success) return invalidState(parsed.error)
  const { batchId, acceptWarnings } = parsed.data
  const tenantId = auth.tenantId
  const op = 'imports.post'
  const supabase = await createClient()
  const batch = await loadBatch(supabase, tenantId, batchId)
  if (!batch || batch.status === 'cancelled') return accFailure('import_batch_closed')

  const seen = new Set<string>()
  const items = parsed.data.items.filter((i) => {
    if (seen.has(i.key)) return false
    seen.add(i.key)
    return true
  })
  const proposals = await loadByKeys(
    supabase,
    tenantId,
    batchId,
    items.map((i) => i.key),
  )
  const bundles = await loadBundles(
    supabase,
    tenantId,
    [...proposals.values()].map((p) => p.clientRef),
  )

  const results = new Map<string, PostItemResult>()
  const finalMarks: Array<Record<string, unknown>> = []
  let counts: ImportBatchCounts | null = batch.counts
  let batchStatus: ImportBatchStatus | null = batch.status
  let postedCount = 0

  const markPosted = async (p: ExistingProposal, documentId: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('acc_import_mark_posted', {
      p_tenant_id: tenantId,
      p_batch_id: batchId,
      p_key: p.key,
      p_document_id: documentId,
    })
    if (error) {
      const state = rpcFailure(`${op}.mark`, error)
      return state.message
    }
    const r = asRecord(data)
    counts = parseBatchCounts(r?.counts) ?? counts
    batchStatus = batchStatusOf(r?.status) ?? batchStatus
    return null
  }

  // ── 1. Lo que ya está resuelto (o se cortó después de guardar) ──
  const toBuild: Array<{ previewHash: string; p: ExistingProposal }> = []
  for (const item of items) {
    const p = proposals.get(item.key)
    if (!p) {
      results.set(item.key, {
        key: item.key,
        outcome: 'not_found',
        message: 'No encontramos esa propuesta. Recargá la página.',
      })
      continue
    }
    if (p.status === 'posted') {
      results.set(p.key, {
        key: p.key,
        outcome: 'already_posted',
        ...(p.documentId ? { documentId: p.documentId } : {}),
      })
      continue
    }
    if (p.status === 'skipped') {
      results.set(p.key, { key: p.key, outcome: 'skipped', message: skipMessage(p.error) })
      continue
    }
    // Anulada: su client_ref ya generó el comprobante anulado; se carga con otro intento («Volver a cargar»).
    if (p.status === 'voided') {
      results.set(p.key, { key: p.key, outcome: 'skipped', message: PROPOSAL_VOIDED_TEXT })
      continue
    }
    const bundle = bundles.get(p.clientRef)
    if (bundle) {
      const documentId = await documentOfBundle(supabase, tenantId, bundle)
      if (!documentId) {
        results.set(p.key, {
          key: p.key,
          outcome: 'error',
          message: 'No pudimos ubicar el comprobante cargado. Recargá la página.',
        })
        continue
      }
      const failed = await markPosted(p, documentId)
      postedCount += failed ? 0 : 1
      results.set(p.key, {
        key: p.key,
        outcome: 'replayed',
        documentId,
        ...(failed ? { message: failed } : {}),
      })
      continue
    }
    if (p.status === 'needs_input') {
      results.set(p.key, { key: p.key, outcome: 'needs_input', needs: needsOf(p.needs) })
      continue
    }
    toBuild.push({ previewHash: item.previewHash, p })
  }

  // ── 2. Volver a armar con el contexto de la base ──
  const ready: Ready[] = []
  if (toBuild.length > 0) {
    const parsedForms = new Map<string, ParsedDocumentForm>()
    const acksByKey = new Map<string, WarningKey[]>()
    const lineIds = new Set<string>()
    const commissionParties = new Set<string>()
    for (const { previewHash, p } of toBuild) {
      const acks = [...new Set([...p.warningsAck, ...acceptWarnings])].sort()
      acksByKey.set(p.key, acks)
      if (!isDocumentForm(p.form)) {
        results.set(p.key, {
          key: p.key,
          outcome: 'error',
          message: 'No pudimos armar el asiento.',
        })
        finalMarks.push(
          rewrite(p, {
            status: 'error',
            error: {
              reason: 'post_failed',
              key: 'invalid_bundle',
              message: 'No pudimos armar el asiento.',
            },
          }),
        )
        continue
      }
      const form = parseDocumentForm(p.form, {
        ...(asRecord(p.formValues) ?? {}),
        clientRef: p.clientRef,
        previewHash,
        warningsAck: acks,
      })
      if (!form.ok) {
        const state = invalidState(form.error)
        console.error(`[${op}] valores guardados que no pasan el esquema`, p.form)
        results.set(p.key, { key: p.key, outcome: 'error', message: state.message })
        finalMarks.push(rewrite(p, { status: 'error', error: postError(state) }))
        continue
      }
      parsedForms.set(p.key, form.value)
      for (const id of form.value.refs.lineIds) lineIds.add(id)
      if (form.value.refs.commissionPartyId)
        commissionParties.add(form.value.refs.commissionPartyId)
    }

    let catalogPending: string | null = null
    if (commissionParties.size > 0) {
      try {
        const catalog = await loadPostingCatalog(tenantId)
        catalogPending =
          catalog.accounts.find((a) => a.systemKey === 'vat_credit_pending')?.id ?? null
      } catch (error) {
        if (error instanceof AccountingContextError) return error.state
        throw error
      }
    }
    const refs: PostingContextRefs = {
      lineIds: [...lineIds],
      openItemsOf: [...commissionParties].map((partyId) => ({
        partyId,
        accountId: catalogPending,
      })),
    }
    const [loaded, firstOpenDate] = await Promise.all([
      tryLoadPostingContext(tenantId, refs),
      loadFirstOpenDate(tenantId),
    ])
    if (!loaded.ok) return loaded.state
    const ctx = loaded.ctx

    // Transferencias ya cargadas (por el otro importador mientras tanto).
    const transferKeys = toBuild.filter(({ p }) => p.form === 'transfer' && parsedForms.has(p.key))
    const transferDates = transferKeys
      .map(({ p }) => textOf(asRecord(p.formValues)?.date))
      .filter((d): d is string => !!d)
      .sort()
    const transferTreasuries = new Set<string>()
    for (const { p } of transferKeys) {
      const v = asRecord(p.formValues)
      const from = textOf(v?.fromTreasuryId)
      const to = textOf(v?.toTreasuryId)
      if (from) transferTreasuries.add(from)
      if (to) transferTreasuries.add(to)
    }
    const postedTransfers =
      transferDates.length > 0
        ? await loadPostedTransfers(supabase, tenantId, {
            treasuryIds: [...transferTreasuries],
            from: transferDates[0] as string,
            to: transferDates[transferDates.length - 1] as string,
          })
        : []

    for (const { previewHash, p } of toBuild) {
      const form = parsedForms.get(p.key)
      if (!form) continue
      const acks = acksByKey.get(p.key) ?? []
      const built = buildPrimary(form, ctx, firstOpenDate)
      if (!built.ok) {
        const state = engineErrorsState(built.errors)
        logFailure(op, state)
        results.set(p.key, { key: p.key, outcome: 'error', message: state.message })
        finalMarks.push(rewrite(p, { status: 'error', error: postError(state) }))
        continue
      }
      if (built.hash !== previewHash) {
        results.set(p.key, {
          key: p.key,
          outcome: 'stale',
          hash: built.hash,
          message: 'Algo cambió desde la revisión: mirá el asiento nuevo y confirmá otra vez.',
        })
        finalMarks.push(rewrite(p, { status: 'stale', preview_hash: built.hash }))
        continue
      }
      const pending = [...new Set(built.warnings.map((w) => w.key))].filter(
        (k) => !acks.includes(k),
      )
      if (pending.length > 0) {
        const needs: ImportNeed[] = [{ key: 'accept_warning', warnings: pending }]
        results.set(p.key, { key: p.key, outcome: 'needs_input', needs })
        finalMarks.push(rewrite(p, { status: 'needs_input', preview_hash: built.hash, needs }))
        continue
      }
      if (p.form === 'transfer') {
        const v = asRecord(p.formValues)
        const from = textOf(v?.fromTreasuryId)
        const to = textOf(v?.toTreasuryId)
        const date = textOf(v?.date)
        const amount = typeof v?.amountCents === 'number' ? v.amountCents : null
        const dup =
          from && to && date && amount !== null
            ? findPostedTransfer(postedTransfers, from, to, amount, date)
            : null
        if (dup) {
          const error: ProposalError = {
            reason: 'already_loaded',
            document_id: dup.documentId,
            label: dup.label,
            date: dup.date,
          }
          results.set(p.key, {
            key: p.key,
            outcome: 'skipped',
            message: SKIP_REASON_TEXT.already_loaded,
          })
          finalMarks.push(rewrite(p, { status: 'skipped', preview_hash: null, needs: [], error }))
          continue
        }
      }
      ready.push({ p, built, acks })
    }

    // ── 3. Marcar «cargando» y cargar de a una ──
    if (ready.length > 0) {
      const marking = await putProposals(
        supabase,
        tenantId,
        batchId,
        ready.map(({ p, built, acks }) =>
          rewrite(p, { status: 'posting', preview_hash: built.hash, warnings_ack: acks }),
        ),
      )
      if (!marking.ok) return marking.state
      counts = marking.counts ?? counts
    }
    for (const { p, built, acks } of ready) {
      const args = {
        p_tenant_id: tenantId,
        p_client_ref: p.clientRef,
        p_bundle: toRpcPayload(built.bundle, built.hash),
      }
      let res = await supabase.rpc('acc_post_bundle', args)
      if (res.error && isClientRefRace(res.error)) res = await supabase.rpc('acc_post_bundle', args)
      if (res.error) {
        const state = mapAccError(res.error)
        const key = typeof state.detail?.key === 'string' ? state.detail.key : null
        if (key === 'warning_requires_ack') {
          const warnings = [
            ...new Set(dbWarnings(res.error.details, ctx).map((w) => w.key)),
          ].filter((k) => !acks.includes(k))
          const needs: ImportNeed[] =
            warnings.length > 0
              ? [{ key: 'accept_warning', warnings }]
              : [{ key: 'engine_error', error_key: key, message: state.message, field: null }]
          results.set(p.key, { key: p.key, outcome: 'needs_input', needs })
          finalMarks.push(
            rewrite(p, {
              status: 'needs_input',
              preview_hash: built.hash,
              needs,
              warnings_ack: acks,
            }),
          )
          continue
        }
        if (key === 'idempotency_conflict' || key === 'request_replayed') {
          // Otro intento ya lo guardó con este client_ref: se marca con lo que quedó.
          const again = (await loadBundles(supabase, tenantId, [p.clientRef])).get(p.clientRef)
          const documentId = again ? await documentOfBundle(supabase, tenantId, again) : null
          if (documentId) {
            const failed = await markPosted(p, documentId)
            postedCount += failed ? 0 : 1
            results.set(p.key, {
              key: p.key,
              outcome: 'replayed',
              documentId,
              ...(failed ? { message: failed } : {}),
            })
            continue
          }
        }
        logFailure(op, state, res.error.code)
        results.set(p.key, { key: p.key, outcome: 'error', message: state.message })
        finalMarks.push(
          rewrite(p, {
            status: 'error',
            preview_hash: built.hash,
            warnings_ack: acks,
            error: postError(state),
          }),
        )
        continue
      }
      const saved = parsePostBundleResult(res.data)
      const documentId = saved.documents[0]?.id ?? null
      if (!documentId) {
        console.error(`[${op}] acc_post_bundle sin comprobante`)
        results.set(p.key, {
          key: p.key,
          outcome: 'error',
          message: 'Se guardó, pero no pudimos marcarlo. Recargá la página.',
        })
        continue
      }
      const failed = await markPosted(p, documentId)
      postedCount += 1
      results.set(p.key, {
        key: p.key,
        outcome: saved.replayed ? 'replayed' : 'posted',
        documentId,
        // Ya está en los libros: si no se pudo marcar, el próximo intento lo marca solo.
        ...(failed ? { message: 'Quedó cargado. Recargá la página si no lo ves marcado.' } : {}),
      })
    }
  }

  // ── 4. Lo que no se cargó, con su motivo ──
  if (finalMarks.length > 0) {
    const put = await putProposals(supabase, tenantId, batchId, finalMarks)
    if (put.ok) counts = put.counts ?? counts
    else logFailure(`${op}.marks`, put.state)
  }
  if (postedCount > 0) revalidateAdministracion(auth.slug)

  const ordered = items.map(
    (i) => results.get(i.key) ?? { key: i.key, outcome: 'error' as const, message: 'No se cargó.' },
  )
  return {
    ok: true,
    data: { results: ordered, posted: postedCount, counts, batchStatus },
    message:
      postedCount === ordered.length
        ? postedCount === 1
          ? 'Se cargó 1 comprobante.'
          : `Se cargaron ${postedCount} comprobantes.`
        : `Se cargaron ${postedCount} de ${ordered.length}. Revisá los que quedaron.`,
  }
}
