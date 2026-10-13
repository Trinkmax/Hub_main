/**
 * El exporte de Compras › Comprobantes filtrado por «con / sin factura»
 * (12/10/2026): el mismo subdiario de compras, pero solo las filas del filtro
 * y con sus totales. El tipo de cada comprobante se lee aparte (la base no
 * cambió); una anulación va al grupo del comprobante que anula.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const FACTURA = '00000000-0000-4000-8000-0000000000d1'
const REMITO = '00000000-0000-4000-8000-0000000000d2'
const OTRO = '00000000-0000-4000-8000-0000000000d3'
const ANULACION = '00000000-0000-4000-8000-0000000000d4'

type DocRow = { id: string; voucher_type: string | null; reverses_document_id: string | null }

const db = vi.hoisted(() => ({
  subledger: [] as Array<Record<string, unknown>>,
  documents: [] as Array<{
    id: string
    voucher_type: string | null
    reverses_document_id: string | null
  }>,
  rpcCalls: [] as Array<Record<string, unknown>>,
  documentReads: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (_name: string, params: Record<string, unknown>) => {
      db.rpcCalls.push(params)
      const limit = Number(params.p_limit)
      return { data: db.subledger.slice(0, limit), error: null }
    },
    from: (_table: string) => {
      let ids: string[] = []
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (_column: string, wanted: string[]) => {
          ids = wanted
          return chain
        },
        // biome-ignore lint/suspicious/noThenProperty: imita el builder de supabase-js, que se espera con `await`
        then: (resolve: (value: { data: DocRow[]; error: null }) => void) => {
          db.documentReads += 1
          resolve({ data: db.documents.filter((d) => ids.includes(d.id)), error: null })
        },
      }
      return chain
    },
  }),
}))

import { purchasesByInvoicePlan } from '@/lib/accounting/queries/purchases-invoice-export'
import { csvMoney } from '@/lib/csv/write'

function line(seq: number, documentId: string, label: string, totalCents: number) {
  return {
    row: {
      row_kind: 'line',
      date: '2026-10-05',
      seq,
      document_id: documentId,
      kind_label: 'Compra',
      document_label: label,
      party_name: 'Proveedor',
      total_cents: totalCents,
      open_cents: 0,
    },
    cursor: { d: '2026-10-05', s: seq },
    total_rows: 4,
  }
}

const SPEC = {
  libro: 'subdiario-compras',
  from: '2026-10-01',
  to: '2026-10-31',
  month: '2026-10-01',
  asOf: '2026-10-31',
  accountId: null,
  partyId: null,
  treasuryId: null,
  beforeFyResult: false,
} as const

async function collect(filter: 'con' | 'sin') {
  const plan = purchasesByInvoicePlan('tenant-1', SPEC, filter)
  const rows: Array<readonly unknown[]> = []
  for await (const row of plan.rows()) rows.push(row)
  return { plan, rows }
}

beforeEach(() => {
  db.rpcCalls = []
  db.documentReads = 0
  db.subledger = [
    line(1, FACTURA, 'Factura A 0003-00001290', 1_210_000),
    line(2, REMITO, 'Compra', 500_000),
    line(3, OTRO, 'Otro comprobante 0001-00000007', 300_000),
    // La anulación del remito: en el subdiario va en negativo y no lleva tipo propio.
    line(4, ANULACION, 'Anulación · Compra', -500_000),
  ]
  db.documents = [
    { id: FACTURA, voucher_type: 'factura_a', reverses_document_id: null },
    { id: REMITO, voucher_type: 'sin_comprobante', reverses_document_id: null },
    { id: OTRO, voucher_type: 'otro_comprobante', reverses_document_id: null },
    { id: ANULACION, voucher_type: null, reverses_document_id: REMITO },
  ]
})

describe('subdiario de compras con / sin factura', () => {
  it('«sin factura»: el remito y su anulación, con sus totales', async () => {
    const { plan, rows } = await collect('sin')
    const label = plan.headers.indexOf('Comprobante')
    const total = plan.headers.indexOf('Total')
    expect(rows.slice(0, -1).map((r) => r[label])).toEqual(['Compra', 'Anulación · Compra'])
    const totals = rows.at(-1)
    expect(totals?.[0]).toBe('Totales')
    // $ 5.000 − $ 5.000 = $ 0
    expect(totals?.[total]).toEqual(csvMoney(0))
  })

  it('«con factura»: la factura y el «otro comprobante» (lleva número y va al Libro IVA)', async () => {
    const { plan, rows } = await collect('con')
    const label = plan.headers.indexOf('Comprobante')
    const total = plan.headers.indexOf('Total')
    expect(rows.slice(0, -1).map((r) => r[label])).toEqual([
      'Factura A 0003-00001290',
      'Otro comprobante 0001-00000007',
    ])
    // $ 12.100 + $ 3.000 = $ 15.100
    expect(rows.at(-1)?.[total]).toEqual(csvMoney(1_510_000))
  })

  it('las mismas columnas que el subdiario entero, y el conteo previo es una cota superior', async () => {
    const plan = purchasesByInvoicePlan('tenant-1', SPEC, 'sin')
    expect(plan.headers).toContain('Proveedor')
    expect(plan.headers).toContain('Pendiente')
    expect(await plan.count()).toBe(4)
    expect(db.rpcCalls[0]).toMatchObject({ p_kind: 'purchases', p_from: '2026-10-01', p_limit: 1 })
  })

  it('un comprobante que ya no se puede leer no entra en ninguno de los dos', async () => {
    db.documents = db.documents.filter((d) => d.id !== OTRO)
    const sin = await collect('sin')
    const con = await collect('con')
    const label = sin.plan.headers.indexOf('Comprobante')
    expect(sin.rows.map((r) => r[label])).not.toContain('Otro comprobante 0001-00000007')
    expect(con.rows.map((r) => r[label])).not.toContain('Otro comprobante 0001-00000007')
  })
})
