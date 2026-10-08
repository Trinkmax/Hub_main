/**
 * Del archivo al plan de subida (WP10), con los fixtures sintéticos de
 * `tests/fixtures/imports/`: se abre como en el navegador, se reconoce, se
 * parsea y se arma lo que viaja. Lo importante: el `meta` y cada fila pasan la
 * MISMA validación del servidor (`createImportBatchSchema`, `checkStagedRow`,
 * `addImportItemsSchema`), así que la subida no se rechaza por la forma. Y los
 * archivos equivocados se frenan con un texto que dice qué hacer.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { layoutToMapping } from '@/lib/imports/bank/statement'
import type { OpenedTable } from '@/lib/imports/detect'
import { checkStagedRow } from '@/lib/imports/server/stage'
import { addImportItemsSchema, createImportBatchSchema } from '@/lib/imports/server/types'
import {
  findSavedLayout,
  guessAssignment,
  headerRowOptions,
  layoutFromAssignment,
  mappingPreview,
  mappingProblems,
} from '@/lib/imports/ui/bank-mapping'
import { chunkByRowsAndBytes } from '@/lib/imports/ui/chunks'
import {
  openImportFile,
  planBank,
  planMercadoPago,
  planMisComprobantes,
  type UploadPlan,
  wrongPlace,
} from '@/lib/imports/ui/upload'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
  nodeInflateRaw,
} from '@/tests/fixtures/imports/fixtures'
import { OWN_CBU, SAS_CUIT, TREASURY_ID } from '@/tests/fixtures/imports/synth'

const SHA = 'b'.repeat(64)
const BATCH = '11111111-2222-4333-8444-555555555555'

async function open(file: ImportFixture) {
  const bytes = importFixture(file)
  const opened = await openImportFile({ bytes, fileName: file, inflateRaw: nodeInflateRaw })
  if (!opened.ok) throw new Error(opened.message)
  return { ...opened, size: bytes.length, name: file }
}

/** Lo que haría la pantalla con el plan: el lote y las tandas, validados como en el servidor. */
function expectServerAccepts(plan: UploadPlan, treasuryId: string | null) {
  const batch = createImportBatchSchema.safeParse({
    source: plan.source,
    fileName: plan.fileName,
    fileSha256: SHA,
    fileSize: plan.fileSize,
    detectedFormat: plan.detectedFormat,
    periodFrom: plan.periodFrom,
    periodTo: plan.periodTo,
    treasuryAccountId: treasuryId,
    meta: plan.meta,
  })
  expect(batch.success, JSON.stringify(batch.error?.issues ?? [])).toBe(true)
  for (const row of plan.rows) {
    const check = checkStagedRow(plan.source, treasuryId, row)
    expect(check.ok, `fila ${row.rowNo}: ${check.ok ? '' : check.reason}`).toBe(true)
  }
  for (const chunk of chunkByRowsAndBytes(plan.rows)) {
    const parsed = addImportItemsSchema.safeParse({ batchId: BATCH, items: chunk })
    expect(parsed.success).toBe(true)
  }
}

describe('Mis Comprobantes (Recibidos)', () => {
  it('el ZIP de diciembre: se reconoce, se resume y el servidor lo acepta tal cual', async () => {
    const f = await open(IMPORT_FIXTURES.mcG3Dic)
    expect(f.detected).toBe('arca_recibidos')
    expect(wrongPlace('arca_recibidos', f.detected)).toBeNull()
    const r = planMisComprobantes(
      f.table,
      { fileName: f.name, fileSize: f.size },
      { sasCuit: SAS_CUIT },
    )
    if (!r.ok || !('plan' in r)) throw new Error('no armó el plan')
    expect(r.plan.rows.length).toBeGreaterThan(10)
    expect(r.plan.detectedFormat).toBe('mc_g3')
    expect(r.plan.periodFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.plan.facts.map((x) => x.label)).toEqual(
      expect.arrayContaining(['Qué es', 'Período', 'Comprobantes', 'Total en pesos']),
    )
    expectServerAccepts(r.plan, null)
  })

  it('el Excel y el CSV en Windows-1252 también pasan', async () => {
    for (const file of [
      IMPORT_FIXTURES.mcXlsx,
      IMPORT_FIXTURES.mcCp1252,
      IMPORT_FIXTURES.mcG2Recibidos,
    ]) {
      const f = await open(file)
      const r = planMisComprobantes(
        f.table,
        { fileName: f.name, fileSize: f.size },
        { sasCuit: SAS_CUIT },
      )
      if (!r.ok || !('plan' in r)) throw new Error(`${file}: no armó el plan`)
      expectServerAccepts(r.plan, null)
    }
  })

  it('Emitidos, Portal IVA y Mercado Pago no van acá: el texto dice qué hacer', async () => {
    const emitidos = await open(IMPORT_FIXTURES.mcG2Emitidos)
    expect(wrongPlace('arca_recibidos', emitidos.detected)?.message).toMatch(/Emitidos/)
    const piva = await open(IMPORT_FIXTURES.pivaNuevo)
    expect(wrongPlace('arca_recibidos', piva.detected)?.message).toMatch(/Portal IVA/)
    const mp = await open(IMPORT_FIXTURES.mpRelease)
    expect(wrongPlace('arca_recibidos', mp.detected)).toEqual({
      message: expect.stringMatching(/Mercado Pago/),
      goTo: 'mp_release',
    })
  })

  it('un CSV que pasó por Excel se frena: hay que subir el ZIP original', async () => {
    const f = await open(IMPORT_FIXTURES.mcExcelResaved)
    const r = planMisComprobantes(
      f.table,
      { fileName: f.name, fileSize: f.size },
      { sasCuit: SAS_CUIT },
    )
    expect(r.ok).toBe(false)
    expect('message' in r ? r.message : '').toMatch(/Excel/)
  })

  it('el archivo de otra CUIT se frena', async () => {
    const f = await open(IMPORT_FIXTURES.mcG3Dic)
    const r = planMisComprobantes(
      f.table,
      { fileName: f.name, fileSize: f.size },
      { sasCuit: '20123456786' },
    )
    expect(r.ok).toBe(false)
    expect('message' in r ? r.message : '').toMatch(/otra CUIT/)
  })
})

describe('Mercado Pago (Liquidaciones)', () => {
  it('se reconoce, controla saldos y el servidor lo acepta', async () => {
    const f = await open(IMPORT_FIXTURES.mpRelease)
    expect(wrongPlace('mp_release', f.detected)).toBeNull()
    const r = planMercadoPago(
      f.table,
      { fileName: f.name, fileSize: f.size },
      { sasCuit: SAS_CUIT, ownCbus: [OWN_CBU], cutoffHour: 0 },
    )
    if (!r.ok || !('plan' in r)) throw new Error('no armó el plan')
    expect(r.plan.meta.cutoffHour).toBe(0)
    expect(r.plan.facts.find((x) => x.label === 'Movimientos')).toBeDefined()
    expectServerAccepts(r.plan, null)
  })

  it('con el corte del día de servicio cambia el día contable y sigue pasando', async () => {
    const f = await open(IMPORT_FIXTURES.mpPanel)
    const r = planMercadoPago(
      f.table,
      { fileName: f.name, fileSize: f.size },
      { sasCuit: SAS_CUIT, ownCbus: [OWN_CBU], cutoffHour: 5 },
    )
    if (!r.ok || !('plan' in r)) throw new Error('no armó el plan')
    expect(r.plan.meta.cutoffHour).toBe(5)
    expectServerAccepts(r.plan, null)
  })
})

describe('Banco', () => {
  it('los extractos que se reconocen solos pasan con la caja elegida', async () => {
    for (const file of [
      IMPORT_FIXTURES.bankDc,
      IMPORT_FIXTURES.bankSigned,
      IMPORT_FIXTURES.bankBalance,
      IMPORT_FIXTURES.bankXlsx,
      IMPORT_FIXTURES.bankHtml,
    ]) {
      const f = await open(file)
      expect(wrongPlace('bank_statement', f.detected), file).toBeNull()
      const r = planBank(
        f.table,
        { fileName: f.name, fileSize: f.size },
        { treasuryAccountId: TREASURY_ID, layout: null },
      )
      if (!r.ok || !('plan' in r)) throw new Error(`${file}: no armó el plan`)
      expect(r.plan.detectedFormat).toMatch(/^bank:[0-9a-f]{64}$/)
      expectServerAccepts(r.plan, TREASURY_ID)
    }
  })

  it('un archivo de ARCA en el banco dice adónde ir', async () => {
    const f = await open(IMPORT_FIXTURES.mcG3Nov)
    expect(wrongPlace('bank_statement', f.detected)?.goTo).toBe('arca_recibidos')
  })

  describe('«Contanos qué es cada columna»', () => {
    const rows = [
      ['Banco de prueba · movimientos'],
      ['Columna A', 'Columna B', 'Columna C', 'Columna D'],
      ['01/10/2026', 'TRANSF', '-1.000,00', '9.000,00'],
      ['02/10/2026', 'CR TRANSF', '500,00', '9.500,00'],
    ]
    const table: OpenedTable = {
      container: 'csv',
      cellKind: 'csv',
      rows,
      entryName: null,
      encoding: 'utf-8',
      delimiter: ';',
      signatureDelimiter: ';',
      issues: [],
    }

    it('sin títulos conocidos, pide el mapeo con la fila de títulos sugerida', () => {
      const r = planBank(
        table,
        { fileName: 'x.csv', fileSize: 10 },
        { treasuryAccountId: TREASURY_ID, layout: null },
      )
      expect(r).toEqual({ ok: false, needsMapping: true, candidateHeaderRow: 1 })
      expect(headerRowOptions(rows).map((o) => o.index)).toEqual([1, 2, 3])
      expect(guessAssignment(rows, 1)).toEqual({ 0: null, 1: null, 2: null, 3: null })
      expect(mappingPreview(rows, 1)).toEqual({
        columns: [
          { index: 0, title: 'Columna A' },
          { index: 1, title: 'Columna B' },
          { index: 2, title: 'Columna C' },
          { index: 3, title: 'Columna D' },
        ],
        sample: [
          ['01/10/2026', 'TRANSF', '-1.000,00', '9.000,00'],
          ['02/10/2026', 'CR TRANSF', '500,00', '9.500,00'],
        ],
      })
    })

    it('dice qué falta, y con lo elegido arma el formato, lo usa y lo reconoce la próxima vez', () => {
      expect(mappingProblems({ 0: 'date' })).toEqual([
        'Falta elegir la columna de la descripción o el concepto.',
        'Falta elegir dónde está la plata: una columna de Importe, o Débito y Crédito.',
      ])
      expect(mappingProblems({ 0: 'date', 1: 'description', 2: 'debit' })).toEqual([
        'Elegiste solo una de Débito o Crédito: marcá las dos, o una columna de Importe.',
      ])
      expect(mappingProblems({ 0: 'date', 1: 'date', 2: 'description', 3: 'amount' })).toEqual([
        'Hay dos columnas con lo mismo: dejá una sola.',
      ])
      const assignment = { 0: 'date', 1: 'description', 2: 'amount', 3: 'balance' } as const
      const layout = layoutFromAssignment(1, assignment, 'dmy')
      expect(layout).not.toBeNull()
      const r = planBank(
        table,
        { fileName: 'x.csv', fileSize: 10 },
        { treasuryAccountId: TREASURY_ID, layout },
      )
      if (!r.ok || !('plan' in r)) throw new Error('no armó el plan')
      expect(r.plan.rows.map((x) => (x.data as { amount: number }).amount)).toEqual([
        -100_000, 50_000,
      ])
      expectServerAccepts(r.plan, TREASURY_ID)

      // Lo que se guarda (`saveImportLayout`) vuelve a encontrarse por la firma, aunque el banco
      // agregue un renglón arriba de los títulos.
      const signature = r.plan.detectedFormat?.slice('bank:'.length) ?? ''
      const saved = [
        {
          id: 'l1',
          signature,
          mapping: layoutToMapping(
            layout ?? { headerRow: 1, columns: {}, decimal: null, dateOrder: 'dmy' },
          ),
        },
      ]
      const shifted = [['Exportado hoy'], ...rows]
      const found = findSavedLayout(shifted, ';', saved)
      expect(found?.layoutId).toBe('l1')
      expect(found?.layout.headerRow).toBe(2)
      expect(findSavedLayout(rows, ',', saved)).toBeNull()
    })
  })
})

describe('archivos rotos', () => {
  it('vacío, PDF o demasiado grande: un texto claro, sin tirar', async () => {
    const empty = await openImportFile({ bytes: new Uint8Array(), fileName: 'x.csv' })
    expect(empty).toEqual({ ok: false, message: 'El archivo está vacío.' })
    const pdf = await openImportFile({
      bytes: new TextEncoder().encode('%PDF-1.7 algo'),
      fileName: 'resumen.pdf',
    })
    expect(pdf.ok).toBe(false)
    expect('message' in pdf ? pdf.message : '').toMatch(/PDF/)
    const big = await openImportFile({ bytes: new Uint8Array(21 * 1024 * 1024), fileName: 'x.csv' })
    expect('message' in big ? big.message : '').toMatch(/20 MB/)
  })
})
