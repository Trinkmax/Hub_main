/**
 * Revisar (diseño §4.0, WP6): armar las propuestas del lote desde la base,
 * escribir solo lo que cambió, conservar las decisiones de la persona entre
 * «Revisar de nuevo», saltear lo que ya no sale del armado y dar de alta los
 * proveedores nuevos. Con una base en memoria y el contexto simulado.
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

import type { AccountingAuthorized } from '@/lib/accounting/access'
import { loadPostingCatalog, tryLoadPostingContext } from '@/lib/accounting/context'
import { loadFirstOpenDate } from '@/lib/accounting/server/document-context'
import type { PartyRef } from '@/lib/accounting/types'
import { mcNaturalKey } from '@/lib/imports/arca/mis-comprobantes'
import { importClientRef } from '@/lib/imports/hash'
import type { EvaluatedProposal } from '@/lib/imports/server/proposals/common'
import {
  __test,
  createImportSuppliersFor,
  rebuildBatch,
  resolveImportNeedsFor,
} from '@/lib/imports/server/propose'
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
const NEWCO = makeCuit('30', 60_999_888)

function mc(number: number, issuerCuit: string, extra: Partial<McItem> = {}): McItem {
  const otherTaxes = extra.otherTaxes ?? 0
  return {
    kind: 'mc',
    issueDate: '2026-10-05',
    code: 1,
    pointOfSale: 3,
    number,
    numberTo: number,
    authCode: '76412345678901',
    issuerCuit,
    issuerName: 'CERVECERIA DEL SUR SRL',
    receiverDocType: 80,
    receiverDoc: SAS_CUIT,
    currency: 'ARS',
    fxRate: '1',
    net: { r0: 0, r25: 0, r5: 0, r105: 0, r21: 1_000_000, r27: 0 },
    vat: { r25: 0, r5: 0, r105: 0, r21: 210_000, r27: 0 },
    netTotal: 1_000_000,
    nonTaxed: 0,
    exempt: 0,
    otherTaxes,
    vatTotal: 210_000,
    total: 1_210_000 + otherTaxes,
    generation: 'g3',
    ...extra,
  }
}

const A = mc(1, COCA)
const B = mc(2, NEWCO)
const C = mc(3, COCA, { otherTaxes: 30_000 })
const key = (it: McItem) => mcNaturalKey('recibidos', it)

let db: FakeDb
let kit: Kit

function counts(): Row {
  const props = db.table('acc_import_proposals')
  const by = (s: string) => props.filter((p) => p.status === s).length
  return {
    items: db.table('acc_import_items').length,
    proposals: props.length,
    needs_input: by('needs_input'),
    ready: by('ready'),
    posting: by('posting'),
    posted: by('posted'),
    stale: by('stale'),
    error: by('error'),
    skipped: by('skipped'),
    voided: by('voided'),
  }
}

function wire() {
  db.table('acc_import_batches').push({
    id: KIT_BATCH,
    tenant_id: KIT_TENANT,
    source: 'arca_recibidos',
    status: 'staging',
    treasury_account_id: null,
    period_from: '2026-10-01',
    period_to: '2026-10-31',
    counts: {},
    created_at: '2026-10-08T09:00:00Z',
  })
  ;[A, B, C].forEach((item, i) => {
    db.table('acc_import_items').push({
      id: fixedUuid(8_000 + i),
      tenant_id: KIT_TENANT,
      batch_id: KIT_BATCH,
      row_no: i + 2,
      natural_key: key(item),
      data: item,
      status: 'new',
      issues: [],
      proposal_keys: [],
    })
  })
  db.on('acc_import_match_purchases', () => ({ data: [], error: null }))
  db.on('acc_import_put_proposals', (args) => {
    const table = db.table('acc_import_proposals')
    for (const p of args.p_proposals as Row[]) {
      const row = table.find((r) => r.key === p.key)
      const fields = {
        form: p.form,
        form_values: p.form_values,
        summary: p.summary,
        preview_hash: p.preview_hash,
        status: p.status,
        needs: p.needs,
        warnings_ack: p.warnings_ack,
        error: p.error,
      }
      if (row?.status === 'posted') continue
      if (row?.status === 'voided') {
        // Como la base (20261008120340): una anulada solo se rearma con un intento mayor.
        if (Number(p.attempt) <= Number(row.attempt)) continue
        Object.assign(row, {
          client_ref: p.client_ref,
          attempt: p.attempt,
          previous_document_id: row.document_id,
          document_id: null,
        })
      }
      if (!row) {
        table.push({
          tenant_id: KIT_TENANT,
          batch_id: args.p_batch_id,
          key: p.key,
          client_ref: p.client_ref,
          attempt: p.attempt,
          document_id: null,
          updated_at: '2026-10-08T09:00:00Z',
          ...fields,
        })
      } else Object.assign(row, fields)
      for (const id of (p.item_ids as string[]) ?? []) {
        const item = db.table('acc_import_items').find((i) => i.id === id)
        if (item) item.proposal_keys = [...new Set([...(item.proposal_keys as string[]), p.key])]
      }
    }
    // Como la base: el lote pasa a revisión y guarda sus conteos.
    const batch = db.table('acc_import_batches')[0]
    if (batch) {
      if (batch.status === 'staging') batch.status = 'review'
      batch.counts = counts()
    }
    return { data: { counts: counts() }, error: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeDb()
  kit = makeKit({ suppliers: [{ cuit: COCA, name: 'DISTRIBUIDORA SA' }] })
  vi.mocked(createClient).mockResolvedValue(db.client() as never)
  vi.mocked(loadPostingCatalog).mockImplementation(async () => kit.catalog)
  vi.mocked(tryLoadPostingContext).mockImplementation(async () => ({ ok: true, ctx: kit.ctx }))
  vi.mocked(loadFirstOpenDate).mockResolvedValue(null)
  wire()
})

const stored = (k: string) => {
  const row = db.table('acc_import_proposals').find((r) => r.key === k)
  if (!row) throw new Error(`Falta ${k}`)
  return row
}

describe('armar el lote', () => {
  it('una propuesta por fila, con su client_ref determinístico y lo que falta', async () => {
    const state = await rebuildBatch(AUTH, KIT_BATCH)
    expect(state).toMatchObject({
      ok: true,
      data: { written: 3, unchanged: 0, byStatus: { ready: 1, needs_input: 2 } },
      message: 'Listo: 1 para cargar y 2 para revisar.',
    })
    expect(stored(key(A))).toMatchObject({
      status: 'ready',
      client_ref: importClientRef(KIT_TENANT, key(A), 1),
      attempt: 1,
    })
    expect((stored(key(B)).needs as Row[])[0]).toMatchObject({ key: 'new_supplier', cuit: NEWCO })
    expect((stored(key(C)).needs as Row[])[0]).toMatchObject({
      key: 'other_taxes_as',
      amount_cents: 30_000,
    })
    expect(db.table('acc_import_items')[0]?.proposal_keys).toEqual([key(A)])
    expect(db.table('acc_import_batches')[0]?.status).toBe('review')
  })

  it('«Revisar de nuevo» sin cambios no escribe nada', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const before = db.rpcCalls('acc_import_put_proposals').length
    const again = await rebuildBatch(AUTH, KIT_BATCH)
    expect(again).toMatchObject({ ok: true, data: { written: 0, unchanged: 3 } })
    expect(db.rpcCalls('acc_import_put_proposals')).toHaveLength(before)
  })

  it('un lote cerrado no se arma', async () => {
    db.first('acc_import_batches').status = 'done'
    expect(await rebuildBatch(AUTH, KIT_BATCH)).toMatchObject({
      ok: false,
      detail: { key: 'import_batch_closed' },
    })
  })

  it('una fila marcada «no es nuestro»: su propuesta queda salteada con ese motivo', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    db.first('acc_import_items').status = 'ignored'
    const state = await rebuildBatch(AUTH, KIT_BATCH)
    expect(state).toMatchObject({ ok: true, data: { written: 1 } })
    expect(stored(key(A))).toMatchObject({ status: 'skipped', error: { reason: 'ignored' } })
  })

  it('las propuestas ya cargadas no se tocan', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    Object.assign(stored(key(A)), { status: 'posted', document_id: fixedUuid(77) })
    db.first('acc_import_items').status = 'posted'
    const state = await rebuildBatch(AUTH, KIT_BATCH)
    expect(state).toMatchObject({ ok: true, data: { written: 0 } })
    expect(stored(key(A)).status).toBe('posted')
  })
})

describe('resolver lo que falta', () => {
  it('«otros tributos» de una propuesta: queda lista y la decisión sobrevive a «Revisar de nuevo»', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'other_taxes_as', proposalKey: key(C), as: 'perc_iibb' }],
    })
    expect(state).toMatchObject({ ok: true, data: { byStatus: { ready: 2, needs_input: 1 } } })
    expect(stored(key(C))).toMatchObject({
      status: 'ready',
      summary: { decisions: { other_taxes_as: 'perc_iibb' } },
    })
    const again = await rebuildBatch(AUTH, KIT_BATCH)
    expect(again).toMatchObject({ ok: true, data: { written: 0 } })
    expect(stored(key(C)).status).toBe('ready')
  })

  it('«Recordar para este proveedor» guarda una regla (y la usan las demás de ese proveedor)', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const party = kit.supplier(COCA).id
    db.on('acc_import_save_rule', (args) => {
      const rule = args.p_rule as Row
      db.table('acc_import_rules').push({
        id: fixedUuid(3_000),
        tenant_id: KIT_TENANT,
        source: 'arca_recibidos',
        active: true,
        priority: 100,
        label: rule.label,
        match: rule.match,
        action: rule.action,
        updated_at: '2026-10-08T10:00:00Z',
      })
      return { data: { id: fixedUuid(3_000) }, error: null }
    })
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'other_taxes_as', partyId: party, as: 'perc_iva', remember: true }],
    })
    expect(state.ok).toBe(true)
    expect(db.rpcCalls('acc_import_save_rule')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_rule: {
        label: 'Otros tributos de DISTRIBUIDORA SA',
        match: { party_id: party },
        action: { kind: 'other_taxes', other_taxes_as: 'perc_iva' },
        source: 'arca_recibidos',
      },
      p_expected_updated_at: null,
    })
    expect(stored(key(C)).status).toBe('ready')
  })

  it('cuenta habitual de un proveedor: edita SOLO ese campo, con su token de concurrencia', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    db.on('acc_save_party', () => ({ data: { id: kit.supplier(COCA).id }, error: null }))
    const account = kit.sys('purchases_alcohol')
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'supplier_account', partyId: kit.supplier(COCA).id, accountId: account }],
    })
    expect(state.ok).toBe(true)
    expect(db.rpcCalls('acc_save_party')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_party: { id: kit.supplier(COCA).id, default_account_id: account },
      p_expected_updated_at: '2026-10-01T12:00:00.000Z',
    })
  })

  it('una cuenta que no es de compras se rechaza antes de tocar la base', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [
        {
          kind: 'supplier_account',
          partyId: kit.supplier(COCA).id,
          accountId: kit.sys('vat_credit'),
        },
      ],
    })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
    expect(db.rpcCalls('acc_save_party')).toEqual([])
  })

  it('una propuesta que no es del lote: «recargá la página»', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'confirm', proposalKey: 'mc:R:otra:1:1:1', need: 'possible_duplicate' }],
    })
    expect(state).toMatchObject({
      ok: false,
      code: 'invalid',
      message: 'Recargá la página y probá de nuevo.',
    })
  })

  it('«no es nuestro» y el medio de un canal de Mercado Pago van a sus RPC', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    db.on('acc_import_set_items', () => ({ data: { changed: 1 }, error: null }))
    db.on('acc_mp_save_connection', () => ({ data: { id: fixedUuid(4) }, error: null }))
    const itemId = fixedUuid(8_000)
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [
        { kind: 'ignore', itemIds: [itemId], reason: 'Es de otro local' },
        { kind: 'channel_method', channel: 'point', salesMethodId: kit.f.method('debit').id },
      ],
    })
    expect(state.ok).toBe(true)
    expect(db.rpcCalls('acc_import_set_items')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_batch_id: KIT_BATCH,
      p_changes: [{ kind: 'ignore', item_ids: [itemId], reason: 'Es de otro local' }],
    })
    expect(db.rpcCalls('acc_mp_save_connection')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_patch: { channel_methods: { point: kit.f.method('debit').id } },
      p_expected_updated_at: null,
    })
  })
})

describe('lo anulado', () => {
  /** Como el trigger de la base: anular el comprobante deja la propuesta `voided` y la fila en revisión. */
  async function voidA() {
    await rebuildBatch(AUTH, KIT_BATCH)
    Object.assign(stored(key(A)), {
      status: 'voided',
      document_id: fixedUuid(77),
      warnings_ack: ['vat_diff'],
    })
    db.first('acc_import_items').status = 'review'
  }

  it('«Revisar de nuevo» no la vuelve a proponer sola', async () => {
    await voidA()
    const state = await rebuildBatch(AUTH, KIT_BATCH)
    expect(state).toMatchObject({ ok: true, data: { written: 0 } })
    expect(stored(key(A))).toMatchObject({
      status: 'voided',
      attempt: 1,
      client_ref: importClientRef(KIT_TENANT, key(A), 1),
    })
  })

  it('«Volver a cargar»: otro intento con su client_ref nuevo, sin los avisos aceptados y con la nota', async () => {
    await voidA()
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'reimport', proposalKey: key(A) }],
    })
    expect(state).toMatchObject({ ok: true, data: { written: 1 } })
    const put = db.rpcCalls('acc_import_put_proposals').at(-1)?.p_proposals as Row[]
    expect(put).toHaveLength(1)
    expect(put[0]).toMatchObject({
      key: key(A),
      attempt: 2,
      client_ref: importClientRef(KIT_TENANT, key(A), 2),
      status: 'ready',
      warnings_ack: [],
    })
    expect(stored(key(A))).toMatchObject({
      status: 'ready',
      attempt: 2,
      document_id: null,
      previous_document_id: fixedUuid(77),
      summary: { notes: ['reimport'] },
    })
    // Y queda: «Revisar de nuevo» no la vuelve a escribir.
    expect(await rebuildBatch(AUTH, KIT_BATCH)).toMatchObject({ ok: true, data: { written: 0 } })
  })

  it('solo se vuelve a cargar lo anulado', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const state = await resolveImportNeedsFor(AUTH, {
      batchId: KIT_BATCH,
      changes: [{ kind: 'reimport', proposalKey: key(A) }],
    })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
  })

  /** Un comprobante que ya cargó esa clave con ese intento (desde un lote cancelado). */
  function loadedBefore(n: number, attempt: number, status: 'posted' | 'voided', reversed = false) {
    const bundle = fixedUuid(6_000 + n)
    const doc = fixedUuid(6_100 + n)
    db.table('acc_bundles').push({
      id: bundle,
      tenant_id: KIT_TENANT,
      client_ref: importClientRef(KIT_TENANT, key(A), attempt),
    })
    db.table('acc_documents').push({
      id: doc,
      tenant_id: KIT_TENANT,
      bundle_id: bundle,
      status,
      reverses_document_id: null,
    })
    if (reversed) {
      db.table('acc_documents').push({
        id: fixedUuid(6_200 + n),
        tenant_id: KIT_TENANT,
        bundle_id: fixedUuid(6_300 + n),
        status: 'posted',
        reverses_document_id: doc,
      })
    }
  }

  it('la misma fila importada otra vez después de anular: usa el próximo intento libre', async () => {
    loadedBefore(1, 1, 'voided')
    loadedBefore(2, 2, 'posted', true)
    await rebuildBatch(AUTH, KIT_BATCH)
    expect(stored(key(A))).toMatchObject({
      status: 'ready',
      attempt: 3,
      client_ref: importClientRef(KIT_TENANT, key(A), 3),
      summary: { notes: ['reimport'] },
    })
    expect(stored(key(B)).attempt).toBe(1)
  })

  it('si lo cargado sigue vigente, conserva el intento: al confirmar se adopta ese comprobante', async () => {
    loadedBefore(1, 1, 'posted')
    await rebuildBatch(AUTH, KIT_BATCH)
    expect(stored(key(A))).toMatchObject({
      attempt: 1,
      client_ref: importClientRef(KIT_TENANT, key(A), 1),
    })
  })

  it('la nota de «carga nueva» va una sola vez', () => {
    const e = {
      key: 'k',
      form: 'purchase',
      formValues: {},
      summary: {
        kind: 'purchase',
        date: '2026-10-05',
        month: '2026-10',
        label: 'x',
        counterparty: null,
        total_cents: 1,
        item_count: 1,
        notes: ['reimport'],
      },
      status: 'ready',
      previewHash: null,
      needs: [],
      warningsAck: [],
      itemIds: [],
      error: null,
    } satisfies EvaluatedProposal
    expect(__test.withAttemptNote(e, 3).summary.notes).toEqual(['reimport'])
    expect(
      __test.withAttemptNote({ ...e, summary: { ...e.summary, notes: [] } }, 1).summary.notes,
    ).toEqual([])
  })
})

describe('proveedores nuevos', () => {
  it('se crean con su cuenta habitual y el lote se vuelve a armar', async () => {
    await rebuildBatch(AUTH, KIT_BATCH)
    const newId = fixedUuid(4_444)
    db.on('acc_save_party', (args) => {
      const p = args.p_party as Row
      const ref: PartyRef = {
        id: newId,
        kind: 'supplier',
        name: String(p.name),
        tradeName: null,
        taxIdType: 'cuit',
        taxId: String(p.tax_id),
        ivaCondition: 'responsable_inscripto',
        paymentTermDays: 0,
        payableAccountId: kit.sys('payable_suppliers'),
        receivableAccountId: kit.sys('receivable_customers'),
        commissionVatMode: 'none',
        rates: {
          commissionBp: null,
          iibbWithholdingBp: null,
          vatWithholdingBp: null,
          incomeTaxWithholdingBp: null,
          sircupaBp: null,
        },
        active: true,
      }
      ;(kit.ctx.parties as Map<string, PartyRef>).set(newId, ref)
      kit.catalog.parties.push({
        ...ref,
        systemKey: null,
        defaultAccountId: String(p.default_account_id),
        defaultVoucherType: null,
        updatedAt: null,
      })
      return { data: { id: newId, name: p.name }, error: null }
    })
    const account = kit.sys('purchases_alcohol')
    const state = await createImportSuppliersFor(AUTH, {
      batchId: KIT_BATCH,
      suppliers: [
        {
          cuit: NEWCO,
          name: 'CERVECERIA DEL SUR SRL',
          ivaCondition: 'responsable_inscripto',
          accountId: account,
        },
        {
          cuit: '30000000000',
          name: 'MALA',
          ivaCondition: 'responsable_inscripto',
          accountId: account,
        },
      ],
    })
    expect(state).toMatchObject({
      ok: true,
      data: {
        created: [{ cuit: NEWCO, partyId: newId }],
        failed: [
          { cuit: '30000000000', message: 'El CUIT no es válido: revisá el último número.' },
        ],
      },
      message: '1 proveedor listo; 1 no se pudieron crear.',
    })
    expect(db.rpcCalls('acc_save_party')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_party: {
        kind: 'supplier',
        name: 'CERVECERIA DEL SUR SRL',
        tax_id_type: 'cuit',
        tax_id: NEWCO,
        iva_condition: 'responsable_inscripto',
        payment_term_days: 0,
        default_account_id: account,
      },
      p_expected_updated_at: null,
    })
    expect(stored(key(B)).status).toBe('ready')
  })
})

describe('lo que se escribe', () => {
  it('más de 5000 filas en una propuesta: la misma clave en varias entradas', () => {
    const e = {
      key: 'mp:2026-10-01:cobro:x:b1',
      form: 'collection',
      formValues: {},
      summary: {
        kind: 'mp_collection',
        date: '2026-10-01',
        month: null,
        label: 'x',
        counterparty: null,
        total_cents: 1,
        item_count: 1,
      },
      status: 'needs_input',
      previewHash: null,
      needs: [],
      warningsAck: [],
      itemIds: Array.from({ length: 12_000 }, (_, i) => `id-${i}`),
      error: null,
    } satisfies EvaluatedProposal
    const payloads = __test.putPayloads(e, fixedUuid(1), 1)
    expect(payloads.map((p) => (p.item_ids as string[]).length)).toEqual([5000, 5000, 2000])
    expect(new Set(payloads.map((p) => p.key)).size).toBe(1)
  })

  it('pedir las partidas de un partícipe entero alcanza (no se repite por cuenta)', () => {
    expect(
      __test.dedupeParties([
        { partyId: 'a', accountId: 'x' },
        { partyId: 'a' },
        { partyId: 'b', accountId: 'y' },
        { partyId: 'b', accountId: 'y' },
      ]),
    ).toEqual([{ partyId: 'a' }, { partyId: 'b', accountId: 'y' }])
  })
})
