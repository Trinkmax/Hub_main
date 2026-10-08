/**
 * Confirmar (diseño §4.0, WP6): un `acc_post_bundle` por propuesta, con su
 * `client_ref` determinístico; reanudable (lo que un intento anterior dejó
 * guardado se marca sin volver a cargar); lo que cambió vuelve `stale`; los
 * avisos que solo ve la base y los errores quedan con su motivo en palabras
 * simples. Con la base, el contexto y el permiso simulados (sin red).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/accounting/context', () => ({
  AccountingContextError: class AccountingContextError extends Error {},
  loadPostingCatalog: vi.fn(),
  tryLoadPostingContext: vi.fn(),
}))
vi.mock('@/lib/accounting/server/document-context', () => ({
  loadDocumentContext: vi.fn(),
  loadFirstOpenDate: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import type { AccountingAuthorized } from '@/lib/accounting/access'
import { loadPostingCatalog, tryLoadPostingContext } from '@/lib/accounting/context'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import { mcNaturalKey } from '@/lib/imports/arca/mis-comprobantes'
import { importClientRef } from '@/lib/imports/hash'
import { postImportProposalsFor } from '@/lib/imports/server/post'
import { buildArcaDrafts } from '@/lib/imports/server/proposals/arca'
import { type EvaluatedProposal, evaluateDraft } from '@/lib/imports/server/proposals/common'
import { PROPOSAL_VOIDED_TEXT } from '@/lib/imports/server/types'
import type { McItem } from '@/lib/imports/types'
import { createClient } from '@/lib/supabase/server'
import { makeCuit, SAS_CUIT } from '@/tests/fixtures/imports/synth'
import { fixedUuid } from './accounting-core-context'
import { FakeDb, KIT_BATCH, KIT_TENANT, type Kit, makeKit, type Row } from './imports-kit'

const AUTH = {
  ok: true,
  tenantId: KIT_TENANT,
  userId: fixedUuid(1),
  slug: 'hub',
  access: {} as never,
} as AccountingAuthorized

const COCA = makeCuit('30', 50_123_456)
const DOC = fixedUuid(4_242)
const COUNTS = { items: 1, proposals: 1, posted: 1, ready: 0 }

function mc(number: number, extra: Partial<McItem> = {}): McItem {
  return {
    kind: 'mc',
    issueDate: '2026-10-05',
    code: 1,
    pointOfSale: 3,
    number,
    numberTo: number,
    authCode: '76412345678901',
    issuerCuit: COCA,
    issuerName: 'DISTRIBUIDORA SA',
    receiverDocType: 80,
    receiverDoc: SAS_CUIT,
    currency: 'ARS',
    fxRate: '1',
    net: { r0: 0, r25: 0, r5: 0, r105: 0, r21: 1_000_000, r27: 0 },
    vat: { r25: 0, r5: 0, r105: 0, r21: 210_000, r27: 0 },
    netTotal: 1_000_000,
    nonTaxed: 0,
    exempt: 0,
    otherTaxes: 0,
    vatTotal: 210_000,
    total: 1_210_000,
    generation: 'g3',
    ...extra,
  }
}

let db: FakeDb
let kit: Kit

/** Una propuesta de compra lista, armada por el importador y guardada en la base de mentira. */
function storeProposal(item: McItem, patch: Partial<Row> = {}): EvaluatedProposal {
  const key = mcNaturalKey('recibidos', item)
  const [draft] = buildArcaDrafts({
    items: [{ id: fixedUuid(9_001), rowNo: 1, key, status: 'new', item, issues: [] }],
    catalog: kit.imp,
    rules: [],
    matches: new Map(),
    decisions: () => ({}),
  })
  if (!draft) throw new Error('sin borrador')
  const e = evaluateDraft(draft, kit.ctx, { firstOpenDate: null, warningsAck: [] })
  db.table('acc_import_proposals').push({
    tenant_id: KIT_TENANT,
    batch_id: KIT_BATCH,
    key,
    form: e.form,
    status: e.status,
    client_ref: importClientRef(KIT_TENANT, key, 1),
    attempt: 1,
    preview_hash: e.previewHash,
    form_values: e.formValues,
    summary: e.summary,
    needs: e.needs,
    warnings_ack: [],
    error: null,
    document_id: null,
    updated_at: '2026-10-08T10:00:00Z',
    ...patch,
  })
  return e
}

const savedBundle = (replayed = false) => ({
  bundle_id: fixedUuid(5_000),
  replayed,
  documents: [
    {
      ref: 'd1',
      id: DOC,
      seq: 7,
      entry_id: fixedUuid(5_001),
      provisional_number: 3,
      lines: [{ line_no: 1, journal_line_id: fixedUuid(5_002) }],
    },
  ],
  allocations: [],
})

/** La base de mentira: put_proposals pisa la fila, mark_posted la marca. */
function wireDb() {
  db.table('acc_import_batches').push({
    id: KIT_BATCH,
    tenant_id: KIT_TENANT,
    source: 'arca_recibidos',
    status: 'review',
    treasury_account_id: null,
    period_from: '2026-10-01',
    period_to: '2026-10-31',
    counts: { items: 1, proposals: 1, ready: 1 },
    created_at: '2026-10-08T09:00:00Z',
  })
  db.on('acc_import_put_proposals', (args) => {
    for (const p of args.p_proposals as Array<Record<string, unknown>>) {
      const row = db.table('acc_import_proposals').find((r) => r.key === p.key)
      if (row && row.status !== 'posted') Object.assign(row, p)
    }
    return { data: { counts: { ready: 0, posting: 1 } }, error: null }
  })
  db.on('acc_post_bundle', () => ({ data: savedBundle(), error: null }))
  db.on('acc_import_mark_posted', (args) => {
    const row = db.table('acc_import_proposals').find((r) => r.key === args.p_key)
    if (row) Object.assign(row, { status: 'posted', document_id: args.p_document_id })
    return { data: { status: 'done', counts: COUNTS, replayed: false }, error: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeDb()
  kit = makeKit({ suppliers: [{ cuit: COCA, name: 'DISTRIBUIDORA SA' }] })
  vi.mocked(createClient).mockResolvedValue(db.client() as never)
  vi.mocked(tryLoadPostingContext).mockResolvedValue({ ok: true, ctx: kit.ctx })
  vi.mocked(loadPostingCatalog).mockResolvedValue(kit.catalog)
  vi.mocked(loadFirstOpenDate).mockResolvedValue(null)
  wireDb()
})

describe('confirmar una tanda', () => {
  it('marca «cargando», guarda SU bundle con el client_ref de la propuesta y la marca cargada', async () => {
    const e = storeProposal(mc(1))
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: {
        posted: 1,
        batchStatus: 'done',
        results: [{ key: e.key, outcome: 'posted', documentId: DOC }],
      },
      message: 'Se cargó 1 comprobante.',
    })
    expect(db.calls.map((c) => c.fn)).toEqual([
      'acc_import_put_proposals',
      'acc_post_bundle',
      'acc_import_mark_posted',
    ])
    const marking = (db.rpcCalls('acc_import_put_proposals')[0]?.p_proposals as Row[])[0]
    expect(marking).toMatchObject({ key: e.key, status: 'posting', preview_hash: e.previewHash })
    const post = db.rpcCalls('acc_post_bundle')[0]
    expect(post?.p_client_ref).toBe(importClientRef(KIT_TENANT, e.key, 1))
    expect((post?.p_bundle as { preview_hash: string }).preview_hash).toBe(e.previewHash)
    expect(db.rpcCalls('acc_import_mark_posted')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_batch_id: KIT_BATCH,
      p_key: e.key,
      p_document_id: DOC,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/hub/administracion', 'layout')
  })

  it('reanudar después de un corte: si el bundle ya está guardado, solo se marca (sin cargar otra vez)', async () => {
    const e = storeProposal(mc(2), { status: 'posting' })
    db.table('acc_bundles').push({
      id: fixedUuid(5_000),
      tenant_id: KIT_TENANT,
      client_ref: importClientRef(KIT_TENANT, e.key, 1),
      result: savedBundle(),
    })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: { results: [{ outcome: 'replayed', documentId: DOC }] },
    })
    expect(db.rpcCalls('acc_post_bundle')).toEqual([])
    expect(db.rpcCalls('acc_import_mark_posted')).toHaveLength(1)
  })

  it('lo ya cargado o salteado no se vuelve a mandar', async () => {
    const posted = storeProposal(mc(3), { status: 'posted', document_id: DOC })
    const skipped = storeProposal(mc(4), { status: 'skipped', error: { reason: 'already_loaded' } })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [
        { key: posted.key, previewHash: posted.previewHash },
        { key: skipped.key, previewHash: skipped.previewHash },
        { key: 'mc:R:no:existe:1', previewHash: posted.previewHash },
      ],
    })
    expect(state).toMatchObject({
      ok: true,
      data: {
        posted: 0,
        results: [
          { outcome: 'already_posted', documentId: DOC },
          { outcome: 'skipped', message: 'Ya está cargado en los libros.' },
          { outcome: 'not_found' },
        ],
      },
    })
    expect(db.calls).toEqual([])
  })

  it('una anulada no se carga ni se marca con su comprobante anulado (va con «Volver a cargar»)', async () => {
    const e = storeProposal(mc(13), { status: 'voided', document_id: fixedUuid(4_243) })
    db.table('acc_bundles').push({
      id: fixedUuid(5_100),
      tenant_id: KIT_TENANT,
      client_ref: importClientRef(KIT_TENANT, e.key, 1),
      result: savedBundle(),
    })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: {
        posted: 0,
        results: [{ key: e.key, outcome: 'skipped', message: PROPOSAL_VOIDED_TEXT }],
      },
    })
    expect(db.calls.map((c) => c.fn)).toEqual([])
  })

  it('si algo cambió desde la revisión: `stale` con el hash nuevo, sin cargar', async () => {
    const e = storeProposal(mc(5))
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: 'f'.repeat(64) }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: { results: [{ outcome: 'stale', hash: e.previewHash }] },
    })
    expect(db.rpcCalls('acc_post_bundle')).toEqual([])
    const final = (db.rpcCalls('acc_import_put_proposals').at(-1)?.p_proposals as Row[])[0]
    expect(final).toMatchObject({ key: e.key, status: 'stale', preview_hash: e.previewHash })
  })

  it('una propuesta que pide algo no se carga', async () => {
    const e = storeProposal(mc(6), {
      status: 'needs_input',
      needs: [{ key: 'other_taxes_as', party_id: null, amount_cents: 100 }],
    })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: { results: [{ outcome: 'needs_input', needs: [{ key: 'other_taxes_as' }] }] },
    })
    expect(db.calls).toEqual([])
  })
})

describe('avisos', () => {
  it('los del motor que se aceptan por lote viajan en el bundle (y quedan en la propuesta)', async () => {
    const e = storeProposal(
      mc(7, { code: 6, net: mc(0).net, vat: mc(0).vat, netTotal: 0, vatTotal: 0 }),
    )
    expect(e.summary.warnings).toEqual(['voucher_condition'])
    const without = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(without).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            outcome: 'needs_input',
            needs: [{ key: 'accept_warning', warnings: ['voucher_condition'] }],
          },
        ],
      },
    })
    expect(db.rpcCalls('acc_post_bundle')).toEqual([])

    db.first('acc_import_proposals').status = 'ready'
    const accepted = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
      acceptWarnings: ['voucher_condition'],
    })
    expect(accepted).toMatchObject({ ok: true, data: { posted: 1 } })
    const bundle = db.rpcCalls('acc_post_bundle')[0]?.p_bundle as {
      documents: Array<{ warnings_ack: string[] }>
    }
    expect(bundle.documents[0]?.warnings_ack).toEqual(['voucher_condition'])
  })

  it('los que solo ve la base (caja en negativo) dejan la propuesta para revisar con el aviso', async () => {
    const e = storeProposal(mc(8))
    db.on('acc_post_bundle', () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'warning_requires_ack',
        details: JSON.stringify({
          warnings: [{ key: 'treasury_negative', treasury_id: kit.f.treasury('caja').id }],
        }),
      },
    }))
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: {
        posted: 0,
        results: [
          {
            outcome: 'needs_input',
            needs: [{ key: 'accept_warning', warnings: ['treasury_negative'] }],
          },
        ],
      },
    })
    const final = (db.rpcCalls('acc_import_put_proposals').at(-1)?.p_proposals as Row[])[0]
    expect(final).toMatchObject({ status: 'needs_input' })
    expect(db.rpcCalls('acc_import_mark_posted')).toEqual([])
  })
})

describe('errores y reintentos', () => {
  it('un error de la base queda en la propuesta con el motivo en palabras simples', async () => {
    const e = storeProposal(mc(9))
    db.on('acc_post_bundle', () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'period_closed',
        details: JSON.stringify({ month: '2026-10-01' }),
      },
    }))
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    const message =
      'Octubre está cerrado. Cargalo con fecha de un mes abierto o corregilo con una nota de crédito o un ajuste.'
    expect(state).toMatchObject({ ok: true, data: { results: [{ outcome: 'error', message }] } })
    const final = (db.rpcCalls('acc_import_put_proposals').at(-1)?.p_proposals as Row[])[0]
    expect(final).toMatchObject({
      status: 'error',
      error: { reason: 'post_failed', key: 'period_closed', message },
    })
  })

  it('dos pestañas a la vez: el choque de client_ref se reintenta y devuelve lo ya guardado', async () => {
    const e = storeProposal(mc(10))
    let n = 0
    db.on('acc_post_bundle', () => {
      n++
      return n === 1
        ? {
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "abd_client_ref_uq"',
            },
          }
        : { data: savedBundle(true), error: null }
    })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: { results: [{ outcome: 'replayed', documentId: DOC }] },
    })
    expect(db.rpcCalls('acc_post_bundle')).toHaveLength(2)
  })

  it('«ya se usó ese pedido»: si el bundle está, se marca con lo guardado', async () => {
    const e = storeProposal(mc(11))
    db.on('acc_post_bundle', () => {
      db.table('acc_bundles').push({
        id: fixedUuid(5_000),
        tenant_id: KIT_TENANT,
        client_ref: importClientRef(KIT_TENANT, e.key, 1),
        result: savedBundle(),
      })
      return { data: null, error: { code: 'P0001', message: 'idempotency_conflict' } }
    })
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({
      ok: true,
      data: { results: [{ outcome: 'replayed', documentId: DOC }] },
    })
  })

  it('un lote cancelado no se carga; más de 15 por llamada no pasa el zod', async () => {
    const e = storeProposal(mc(12))
    db.first('acc_import_batches').status = 'cancelled'
    const cancelled = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key: e.key, previewHash: e.previewHash }],
    })
    expect(cancelled).toMatchObject({ ok: false, detail: { key: 'import_batch_closed' } })
    const tooMany = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: Array.from({ length: 16 }, (_, i) => ({
        key: `k${i}xx`,
        previewHash: 'a'.repeat(64),
      })),
    })
    expect(tooMany).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('transferencias: la misma no se carga dos veces', () => {
  it('si mientras tanto entró por el otro importador (±3 días), queda salteada', async () => {
    const from = kit.f.treasury('mp').id
    const to = kit.f.treasury('banco').id
    const formValues = {
      fromTreasuryId: from,
      toTreasuryId: to,
      amountCents: 1_000_000,
      date: '2026-10-05',
      reference: null,
      notes: null,
    }
    const key = 'mp:abc:transfer'
    const e = evaluateDraft(
      {
        key,
        form: 'transfer',
        values: formValues,
        itemIds: [],
        needs: [],
        summary: {
          kind: 'mp_transfer',
          date: '2026-10-05',
          label: 'Retiro',
          counterparty: null,
          total_cents: 1_000_000,
          item_count: 1,
        },
      },
      kit.ctx,
      { firstOpenDate: null, warningsAck: [] },
    )
    db.table('acc_import_proposals').push({
      tenant_id: KIT_TENANT,
      batch_id: KIT_BATCH,
      key,
      form: 'transfer',
      status: 'ready',
      client_ref: importClientRef(KIT_TENANT, key, 1),
      attempt: 1,
      preview_hash: e.previewHash,
      form_values: e.formValues,
      summary: e.summary,
      needs: [],
      warnings_ack: [],
      error: null,
      document_id: null,
      updated_at: null,
    })
    db.table('acc_documents').push({
      id: fixedUuid(31),
      tenant_id: KIT_TENANT,
      status: 'posted',
      kind: 'transfer',
      accounting_date: '2026-10-06',
      total_cents: 1_000_000,
      description: 'Movimiento entre cuentas',
      party_id: null,
    })
    db.table('acc_document_lines').push(
      {
        tenant_id: KIT_TENANT,
        document_id: fixedUuid(31),
        treasury_account_id: to,
        side: 'debit',
        role: 'treasury',
        line_no: 1,
      },
      {
        tenant_id: KIT_TENANT,
        document_id: fixedUuid(31),
        treasury_account_id: from,
        side: 'credit',
        role: 'treasury',
        line_no: 2,
      },
    )
    const state = await postImportProposalsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [{ key, previewHash: e.previewHash }],
    })
    expect(state).toMatchObject({ ok: true, data: { results: [{ outcome: 'skipped' }] } })
    expect(db.rpcCalls('acc_post_bundle')).toEqual([])
    const final = (db.rpcCalls('acc_import_put_proposals').at(-1)?.p_proposals as Row[])[0]
    expect(final).toMatchObject({
      status: 'skipped',
      error: { reason: 'already_loaded', document_id: fixedUuid(31) },
    })
  })
})
