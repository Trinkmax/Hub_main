/**
 * Subir (diseño §4.0, WP6): el lote idempotente por archivo, las filas
 * revalidadas con el zod estricto de su origen, los avisos compactados para que
 * entren en los 4 KB de la base, y las tandas dentro de los topes de la SQL.
 * Con la base y el permiso simulados (sin red).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import type { AccountingAuthorized } from '@/lib/accounting/access'
import { mcNaturalKey } from '@/lib/imports/arca/mis-comprobantes'
import { bankNaturalKey } from '@/lib/imports/bank/statement'
import { estimateJsonbSize } from '@/lib/imports/server/proposals/common'
import {
  addImportItemsFor,
  checkStagedRow,
  compactIssues,
  createImportBatchFor,
  ISSUES_MAX_BYTES,
  loadManualBankExpenses,
  loadManualMpDays,
  loadPostedTransfers,
  parseBatchCounts,
} from '@/lib/imports/server/stage'
import type { BankItem, ImportIssue, McItem } from '@/lib/imports/types'
import { createClient } from '@/lib/supabase/server'
import { SAS_CUIT } from '@/tests/fixtures/imports/synth'
import { fixedUuid } from './accounting-core-context'
import { FakeDb, KIT_BATCH, KIT_TENANT } from './imports-kit'

const AUTH = {
  ok: true,
  tenantId: KIT_TENANT,
  userId: fixedUuid(1),
  slug: 'hub',
  access: {} as never,
} as AccountingAuthorized

const SHA = 'a'.repeat(64)
const TREASURY = fixedUuid(55)

function mc(n: number): McItem {
  return {
    kind: 'mc',
    issueDate: '2026-10-05',
    code: 1,
    pointOfSale: 3,
    number: n,
    numberTo: n,
    authCode: '76412345678901',
    issuerCuit: '30501234563',
    issuerName: 'DISTRIBUIDORA SA',
    receiverDocType: 80,
    receiverDoc: SAS_CUIT,
    currency: 'ARS',
    fxRate: '1',
    net: { r0: 0, r25: 0, r5: 0, r105: 0, r21: 100_000, r27: 0 },
    vat: { r25: 0, r5: 0, r105: 0, r21: 21_000, r27: 0 },
    netTotal: 100_000,
    nonTaxed: 0,
    exempt: 0,
    otherTaxes: 0,
    vatTotal: 21_000,
    total: 121_000,
    generation: 'g3',
  }
}

const mcRow = (n: number, issues: unknown[] = []) => ({
  rowNo: n,
  naturalKey: mcNaturalKey('recibidos', mc(n)),
  data: mc(n),
  issues,
})

let db: FakeDb

function batchRow(status = 'staging', source = 'arca_recibidos', treasury: string | null = null) {
  return {
    id: KIT_BATCH,
    tenant_id: KIT_TENANT,
    source,
    status,
    treasury_account_id: treasury,
    period_from: '2026-10-01',
    period_to: '2026-10-31',
    counts: { items: 0 },
    created_at: '2026-10-08T10:00:00Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeDb()
  vi.mocked(createClient).mockResolvedValue(db.client() as never)
})

describe('tamaños: la estimación del jsonb nunca da de menos (medido en Postgres)', () => {
  const issue = (
    code: ImportIssue['code'],
    level: ImportIssue['level'],
    extra = {},
  ): ImportIssue => ({
    level,
    code,
    row: 12,
    ...extra,
  })
  it('contra lo que mide pg_column_size', () => {
    const long = {
      level: 'review',
      code: 'mp_unknown_description',
      row: 1_234_567,
      field: 'PAYOUT_BANK_ACCOUNT_NUMBER',
      cents: -123_456_789_012,
    }
    const short = { level: 'info', code: 'mc_rounding', row: 12, cents: 5 }
    // Medidos con `select pg_column_size('…'::jsonb)` en la base (solo lectura).
    expect(
      estimateJsonbSize([
        {
          level: 'review',
          code: 'mc_total_gap',
          row: 1_234_567,
          field: 'total_cents_x',
          cents: -123_456_789_012,
        },
      ]),
    ).toBeGreaterThanOrEqual(135)
    expect(estimateJsonbSize(Array.from({ length: 25 }, () => long))).toBeGreaterThanOrEqual(3708)
    expect(estimateJsonbSize(Array.from({ length: 50 }, () => short))).toBeGreaterThanOrEqual(4608)
    expect(estimateJsonbSize(mc(110_266))).toBeGreaterThanOrEqual(828)
  })

  it('compacta: sin repetidos, los más graves primero, dentro del tope', () => {
    const many: ImportIssue[] = [
      ...Array.from({ length: 30 }, (_, i) =>
        issue('mc_rounding', 'info', { row: i + 1, cents: 5 }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        issue('mp_unknown_description', 'review', {
          row: i + 1,
          field: 'PAYOUT_BANK_ACCOUNT_NUMBER',
        }),
      ),
      issue('mc_rounding', 'info', { row: 1, cents: 5 }),
    ]
    const { issues, trimmed } = compactIssues(many)
    expect(estimateJsonbSize(issues)).toBeLessThanOrEqual(ISSUES_MAX_BYTES)
    expect(issues.length + trimmed).toBe(many.length)
    expect(issues[0]?.level).toBe('review')
    expect(issues.length).toBeLessThanOrEqual(50)
    const ids = issues.map((i) => JSON.stringify(i))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pocos avisos pasan tal cual', () => {
    const few = [issue('mc_rounding', 'info'), issue('mc_total_gap', 'review', { cents: 500 })]
    expect(compactIssues(few)).toEqual({ issues: [few[1], few[0]], trimmed: 0 })
  })
})

describe('cada fila, revalidada en el servidor', () => {
  it('una fila de Mis Comprobantes con su clave natural', () => {
    const r = checkStagedRow('arca_recibidos', null, mcRow(7))
    expect(r).toMatchObject({ ok: true, trimmed: 0 })
    if (r.ok) expect(r.row.natural_key).toBe(`mc:R:30501234563:1:3:7`)
  })

  it('una clave que no es la de los datos, una clave de más o avisos raros: se rechaza', () => {
    expect(
      checkStagedRow('arca_recibidos', null, { ...mcRow(7), naturalKey: 'mc:R:otra:1:3:7' }),
    ).toEqual({
      ok: false,
      rowNo: 7,
      reason: 'key',
    })
    expect(
      checkStagedRow('arca_recibidos', null, {
        ...mcRow(7),
        data: { ...mc(7), receiverName: 'JUAN PEREZ' },
      }),
    ).toMatchObject({ ok: false, reason: 'data' })
    expect(
      checkStagedRow(
        'arca_recibidos',
        null,
        mcRow(7, [{ level: 'info', code: 'inventado', row: 1 }]),
      ),
    ).toMatchObject({ ok: false, reason: 'issues' })
  })

  it('el banco necesita su caja (va en la clave)', () => {
    const item: BankItem = {
      kind: 'bank',
      date: '2026-10-01',
      valueDate: null,
      description: 'COMISION',
      voucher: null,
      amount: -100,
      balance: null,
      counterpartyCuit: null,
      counterpartyName: null,
      reference: null,
      ordinal: 0,
      fingerprint: 'b'.repeat(64),
      direction: 'sign',
      balanceOk: null,
    }
    const row = { rowNo: 1, naturalKey: bankNaturalKey(TREASURY, item), data: item, issues: [] }
    expect(checkStagedRow('bank_statement', TREASURY, row).ok).toBe(true)
    expect(checkStagedRow('bank_statement', null, row).ok).toBe(false)
  })
})

describe('createImportBatchFor', () => {
  it('crea el lote con la lista blanca exacta de la RPC', async () => {
    db.on('acc_import_create_batch', () => ({
      data: { id: KIT_BATCH, status: 'staging', created_at: '2026-10-08T10:00:00Z' },
      error: null,
    }))
    const state = await createImportBatchFor(AUTH, {
      source: 'arca_recibidos',
      fileName: 'comprobantes.zip',
      fileSha256: SHA,
      fileSize: 1234,
      detectedFormat: 'mc_g3',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      meta: { generation: 'g3', rows: 10, titleCuit: SAS_CUIT },
    })
    expect(state).toMatchObject({ ok: true, data: { batchId: KIT_BATCH, status: 'staging' } })
    expect(db.rpcCalls('acc_import_create_batch')[0]).toEqual({
      p_tenant_id: KIT_TENANT,
      p_batch: {
        source: 'arca_recibidos',
        file_sha256: SHA,
        file_size: 1234,
        meta: { generation: 'g3', rows: 10, titleCuit: SAS_CUIT },
        file_name: 'comprobantes.zip',
        detected_format: 'mc_g3',
        period_from: '2026-10-01',
        period_to: '2026-10-31',
      },
    })
  })

  it('un archivo repetido: «Ya importaste…» con la fecha y quién; si quedó a medio subir, se puede seguir', async () => {
    db.table('acc_import_batches').push(batchRow('staging'))
    db.on('acc_import_create_batch', () => ({
      data: null,
      error: {
        code: 'P0001',
        message: 'import_file_already',
        details: JSON.stringify({ batch_id: KIT_BATCH, name: 'Nacho', date: '2026-10-03' }),
      },
    }))
    const state = await createImportBatchFor(AUTH, {
      source: 'arca_recibidos',
      fileSha256: SHA,
      fileSize: 10,
    })
    expect(state.ok).toBe(false)
    if (state.ok) return
    expect(state.code).toBe('conflict')
    expect(state.message).toBe(
      'Ese archivo ya se importó el 03/10/2026 (lo subió Nacho). Abrí ese lote para seguir.',
    )
    expect(state.detail).toMatchObject({
      key: 'import_file_already',
      batch_id: KIT_BATCH,
      status: 'staging',
      resumable: true,
    })
  })

  it('el extracto del banco exige su cuenta; Emitidos todavía no', async () => {
    const bank = await createImportBatchFor(AUTH, {
      source: 'bank_statement',
      fileSha256: SHA,
      fileSize: 10,
    })
    expect(bank).toMatchObject({ ok: false, code: 'invalid' })
    const emitidos = await createImportBatchFor(AUTH, {
      source: 'arca_emitidos' as never,
      fileSha256: SHA,
      fileSize: 10,
    })
    expect(emitidos).toMatchObject({ ok: false, code: 'invalid' })
    expect(db.calls).toEqual([])
  })

  it('un meta con datos de más se rechaza (lista blanca)', async () => {
    const state = await createImportBatchFor(AUTH, {
      source: 'mp_release',
      fileSha256: SHA,
      fileSize: 10,
      meta: { payerName: 'JUAN' } as never,
    })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('addImportItemsFor', () => {
  it('de a 500 por llamada (la base acepta 1000), sumando nuevas, repetidas y reenvíos', async () => {
    db.table('acc_import_batches').push(batchRow())
    let call = 0
    db.on('acc_import_add_items', (args) => {
      call++
      const n = (args.p_items as unknown[]).length
      return {
        data: {
          new: call === 1 ? n - 3 : n,
          duplicate: call === 1 ? 2 : 0,
          skipped: call === 1 ? 1 : 0,
          counts: { items: 1000, new: 997, duplicate: 2 },
        },
        error: null,
      }
    })
    const rows = Array.from({ length: 1000 }, (_, i) => mcRow(i + 1))
    const state = await addImportItemsFor(AUTH, { batchId: KIT_BATCH, items: rows })
    expect(state).toMatchObject({
      ok: true,
      data: { inserted: 997, duplicates: 2, skipped: 1, issuesTrimmed: 0 },
    })
    const calls = db.rpcCalls('acc_import_add_items')
    expect(calls).toHaveLength(2)
    expect((calls[0]?.p_items as unknown[]).length).toBe(500)
    expect((calls[0]?.p_items as Array<Record<string, unknown>>)[0]).toEqual({
      row_no: 1,
      natural_key: mcNaturalKey('recibidos', mc(1)),
      data: mc(1),
      issues: [],
    })
    if (state.ok) expect(state.data.counts?.duplicate).toBe(2)
  })

  it('un lote que ya no está subiendo: «cerrado», sin tocar la base', async () => {
    db.table('acc_import_batches').push(batchRow('review'))
    const state = await addImportItemsFor(AUTH, { batchId: KIT_BATCH, items: [mcRow(1)] })
    expect(state).toMatchObject({ ok: false, detail: { key: 'import_batch_closed' } })
    expect(db.rpcCalls('acc_import_add_items')).toEqual([])
  })

  it('una fila mala corta la tanda con su número (y no manda nada)', async () => {
    db.table('acc_import_batches').push(batchRow())
    const state = await addImportItemsFor(AUTH, {
      batchId: KIT_BATCH,
      items: [mcRow(1), { ...mcRow(2), naturalKey: 'mc:R:x:1:3:2' }],
    })
    expect(state).toMatchObject({
      ok: false,
      code: 'invalid',
      detail: { row_no: 2, reason: 'key' },
    })
    expect(db.rpcCalls('acc_import_add_items')).toEqual([])
  })

  it('más de 1000 filas por llamada no pasa el zod', async () => {
    db.table('acc_import_batches').push(batchRow())
    const rows = Array.from({ length: 1001 }, (_, i) => mcRow(i + 1))
    const state = await addImportItemsFor(AUTH, { batchId: KIT_BATCH, items: rows })
    expect(state).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('contra lo cargado a mano (lecturas)', () => {
  const wallet = fixedUuid(61)
  const bank = fixedUuid(62)
  const doc = (
    id: number,
    kind: string,
    date: string,
    total: number,
    party: string | null = null,
  ) => ({
    id: fixedUuid(id),
    tenant_id: KIT_TENANT,
    status: 'posted',
    kind,
    accounting_date: date,
    total_cents: total,
    description: `${kind} ${date}`,
    party_id: party,
  })
  const line = (docId: number, treasury: string, side: 'debit' | 'credit') => ({
    tenant_id: KIT_TENANT,
    document_id: fixedUuid(docId),
    treasury_account_id: treasury,
    side,
    role: 'treasury',
    line_no: side === 'debit' ? 1 : 2,
  })

  it('días de Mercado Pago con cobros o ajustes a mano (los importados no cuentan)', async () => {
    const mp = fixedUuid(70)
    db.table('acc_documents').push(
      doc(1, 'collection', '2026-10-02', 500, mp),
      doc(2, 'treasury_adjustment', '2026-10-03', 100),
      doc(3, 'collection', '2026-10-04', 700, mp),
    )
    db.table('acc_document_lines').push(line(2, wallet, 'debit'))
    db.table('acc_import_proposals').push({ tenant_id: KIT_TENANT, document_id: fixedUuid(3) })
    const days = await loadManualMpDays(db.client() as never, KIT_TENANT, {
      partyIds: [mp],
      walletId: wallet,
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect([...days].sort()).toEqual(['2026-10-02', '2026-10-03'])
  })

  it('transferencias ya cargadas con sus dos cajas', async () => {
    db.table('acc_documents').push(doc(10, 'transfer', '2026-10-02', 1_000_000))
    db.table('acc_document_lines').push(line(10, bank, 'debit'), line(10, wallet, 'credit'))
    const list = await loadPostedTransfers(db.client() as never, KIT_TENANT, {
      treasuryIds: [bank],
      from: '2026-10-04',
      to: '2026-10-05',
    })
    expect(list).toEqual([
      {
        documentId: fixedUuid(10),
        date: '2026-10-02',
        amountCents: 1_000_000,
        fromTreasuryId: wallet,
        toTreasuryId: bank,
        label: 'transfer 2026-10-02',
      },
    ])
  })

  it('gastos bancarios a mano de esa cuenta: día y total', async () => {
    db.table('acc_documents').push(
      doc(20, 'bank_expense', '2026-10-06', 8_556_000),
      doc(21, 'bank_expense', '2026-10-07', 110_500),
    )
    db.table('acc_document_lines').push(line(20, bank, 'credit'), line(21, wallet, 'credit'))
    const set = await loadManualBankExpenses(db.client() as never, KIT_TENANT, {
      treasuryId: bank,
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect([...set]).toEqual(['2026-10-06:8556000'])
  })
})

describe('los conteos del lote', () => {
  it('snake_case de la base → camelCase, lo que falta en cero', () => {
    expect(parseBatchCounts({ items: '5', new: 2, posted_items: 1, needs_input: 3 })).toMatchObject(
      {
        items: 5,
        new: 2,
        postedItems: 1,
        needsInput: 3,
        ready: 0,
      },
    )
    expect(parseBatchCounts(null)).toBeNull()
  })
})
