import { describe, expect, it } from 'vitest'
import { parseMisComprobantes } from '@/lib/imports/arca/mis-comprobantes'
import { parseBankStatement } from '@/lib/imports/bank/statement'
import { openTable } from '@/lib/imports/detect'
import { parseReleaseReport } from '@/lib/imports/mercadopago/release'
import {
  type BankItem,
  bankItemSchema,
  IMPORT_ISSUE_TEXT,
  type ImportIssueCode,
  importIssuesSchema,
  issue,
  issueText,
  type McItem,
  type MpItem,
  mcItemSchema,
  mpItemSchema,
} from '@/lib/imports/types'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import { OWN_CBU, SAS_CUIT, TREASURY_ID } from '@/tests/fixtures/imports/synth'

async function rowsOf(file: ImportFixture) {
  const opened = await openTable({ bytes: importFixture(file), fileName: file })
  if (!opened.ok) throw new Error(opened.issue.code)
  return opened.table
}

// Lo que devuelve un esquema es un ítem válido del tipo (control en tiempo de compilación).
const asMc = (x: unknown): McItem => mcItemSchema.parse(x)
const asMp = (x: unknown): MpItem => mpItemSchema.parse(x)
const asBank = (x: unknown): BankItem => bankItemSchema.parse(x)

describe('lo que sale de los parsers pasa los esquemas estrictos', () => {
  it('Mis Comprobantes y Portal IVA', async () => {
    const files: ImportFixture[] = [
      IMPORT_FIXTURES.mcG3Dic,
      IMPORT_FIXTURES.mcG3Nov,
      IMPORT_FIXTURES.mcG2Recibidos,
      IMPORT_FIXTURES.mcG2Emitidos,
      IMPORT_FIXTURES.mcXlsx,
      IMPORT_FIXTURES.mcG1,
      IMPORT_FIXTURES.mcCp1252,
      IMPORT_FIXTURES.mcExcelResaved,
      IMPORT_FIXTURES.pivaViejo,
      IMPORT_FIXTURES.pivaNuevo,
    ]
    let n = 0
    for (const file of files) {
      const table = await rowsOf(file)
      const r = parseMisComprobantes(table.rows, {
        sasCuit: SAS_CUIT,
        fileName: table.entryName ?? file,
        container: table.cellKind,
      })
      for (const x of r.items) {
        expect(asMc(x.item)).toEqual(x.item)
        expect(importIssuesSchema.safeParse(x.issues).success).toBe(true)
        n++
      }
      expect(importIssuesSchema.safeParse(r.fileIssues).success).toBe(true)
    }
    expect(n).toBe(513 + 539 + 1094 + 3543 + 3 + 1 + 6 + 6 + 8 + 4)
  })

  it('Mercado Pago', async () => {
    for (const file of [IMPORT_FIXTURES.mpRelease, IMPORT_FIXTURES.mpPanel]) {
      const r = parseReleaseReport((await rowsOf(file)).rows, {
        sasCuit: SAS_CUIT,
        ownCbus: [OWN_CBU],
      })
      for (const x of r.items) {
        expect(asMp(x.item)).toEqual(x.item)
        expect(importIssuesSchema.safeParse(x.issues).success).toBe(true)
      }
    }
  })

  it('banco', async () => {
    for (const file of [
      IMPORT_FIXTURES.bankDc,
      IMPORT_FIXTURES.bankSigned,
      IMPORT_FIXTURES.bankBalance,
      IMPORT_FIXTURES.bankXlsx,
      IMPORT_FIXTURES.bankHtml,
    ]) {
      const table = await rowsOf(file)
      const r = parseBankStatement(table.rows, null, {
        treasuryAccountId: TREASURY_ID,
        delimiter: table.signatureDelimiter,
      })
      expect(r.items.length).toBeGreaterThan(0)
      for (const x of r.items) {
        expect(asBank(x.item)).toEqual(x.item)
        expect(importIssuesSchema.safeParse(x.issues).success).toBe(true)
      }
    }
  })
})

describe('los esquemas rechazan claves de más (así no entra ningún dato personal)', () => {
  it('una clave extra o un valor fuera de forma', async () => {
    const mc = parseMisComprobantes((await rowsOf(IMPORT_FIXTURES.mcG1)).rows).items[0]?.item
    expect(mcItemSchema.safeParse({ ...mc, receiverName: 'PERSONA' }).success).toBe(false)
    expect(mcItemSchema.safeParse({ ...mc, total: -1 }).success).toBe(false)
    expect(mcItemSchema.safeParse({ ...mc, total: 1.5 }).success).toBe(false)

    const mp = parseReleaseReport((await rowsOf(IMPORT_FIXTURES.mpRelease)).rows).items[0]?.item
    expect(mpItemSchema.safeParse({ ...mp, payerIdNumber: '23456789' }).success).toBe(false)
    expect(mpItemSchema.safeParse({ ...mp, signals: { payerName: 'X' } }).success).toBe(false)

    const table = await rowsOf(IMPORT_FIXTURES.bankSigned)
    const bank = parseBankStatement(table.rows, null, { treasuryAccountId: TREASURY_ID }).items[0]
      ?.item
    expect(bankItemSchema.safeParse({ ...bank, amount: 0 }).success).toBe(false)
    expect(bankItemSchema.safeParse({ ...bank, cbu: OWN_CBU }).success).toBe(false)
  })
})

describe('textos de los avisos', () => {
  it('todos los códigos tienen texto y se arma la frase', () => {
    for (const code of Object.keys(IMPORT_ISSUE_TEXT) as ImportIssueCode[]) {
      expect(IMPORT_ISSUE_TEXT[code].length).toBeGreaterThan(10)
    }
    expect(issueText(issue('review', 'mc_total_gap', 12, { cents: 150_000 }))).toBe(
      'Fila 12: El total supera la suma de sus partes: seguramente tiene percepciones que ARCA no detalla. (diferencia: $ 1.500,00)',
    )
    expect(issueText(issue('info', 'mp_open_reserve', null, { cents: -2_500 }))).toBe(
      'Hay dinero retenido que no se liberó dentro del período. ($ 25,00)',
    )
    expect(issue('error', 'file_empty', null)).toEqual({
      level: 'error',
      code: 'file_empty',
      row: null,
    })
  })
})
