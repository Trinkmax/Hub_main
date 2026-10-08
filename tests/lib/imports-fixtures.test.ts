import { describe, expect, it } from 'vitest'
import { listZip, readZipEntry } from '@/lib/imports/zip'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import {
  bankBalanceCsv,
  bankDcCsv,
  bankHtml,
  bankSignedTxt,
  bankXlsxRows,
  encodeCp1252,
  G3_RECIBIDOS_TITLES_DEL_EMISOR,
  g1RecibidosCsv,
  g2Csv,
  g3RecibidosCsv,
  MC_DIC_SPEC,
  MC_G2_EMITIDOS_SPEC,
  MC_G2_RECIBIDOS_SPEC,
  MC_NOV_SPEC,
  MC_SMALL_SPEC,
  makeEmitidos,
  makeRecibidos,
  mcExcelRows,
  mpPanelCsv,
  mpReleaseCsv,
  portalIvaCsv,
  utf8,
  xlsxParts,
} from '@/tests/fixtures/imports/synth'

/**
 * Los fixtures son la salida de `scripts/imports/make-fixtures.mts`. Si alguien
 * cambia el generador y no los regenera (o los edita a mano), esto avisa. Se
 * compara el CONTENIDO (lo de adentro de cada ZIP), no los bytes comprimidos,
 * que pueden cambiar con la versión de zlib.
 */

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b))

async function zipContents(file: ImportFixture): Promise<Record<string, string>> {
  const bytes = importFixture(file)
  const out: Record<string, string> = {}
  for (const e of listZip(bytes))
    out[e.name] = new TextDecoder().decode(await readZipEntry(bytes, e))
  return out
}

describe('los fixtures están al día con el generador', () => {
  it('ZIP de Mis Comprobantes (un CSV adentro, con el nombre de ARCA)', async () => {
    const cases: Array<[ImportFixture, string]> = [
      [IMPORT_FIXTURES.mcG3Dic, g3RecibidosCsv(makeRecibidos(MC_DIC_SPEC))],
      [IMPORT_FIXTURES.mcG3Nov, g3RecibidosCsv(makeRecibidos(MC_NOV_SPEC))],
      [IMPORT_FIXTURES.mcG2Recibidos, g2Csv(makeRecibidos(MC_G2_RECIBIDOS_SPEC), 'recibidos')],
      [IMPORT_FIXTURES.mcG2Emitidos, g2Csv(makeEmitidos(MC_G2_EMITIDOS_SPEC), 'emitidos')],
    ]
    for (const [file, csv] of cases) {
      const contents = Object.values(await zipContents(file))
      expect(contents).toEqual([csv])
    }
  })

  it('XLSX (cada parte del paquete)', async () => {
    expect(await zipContents(IMPORT_FIXTURES.mcXlsx)).toEqual(
      xlsxParts({ sheetName: 'Recibidos', rows: mcExcelRows(), merge: 'A1:AD1' }),
    )
    expect(await zipContents(IMPORT_FIXTURES.bankXlsx)).toEqual(
      xlsxParts({ sheetName: 'Movimientos', rows: bankXlsxRows() }),
    )
  })

  it('textos (UTF-8 y Windows-1252)', () => {
    const small = makeRecibidos(MC_SMALL_SPEC)
    const cases: Array<[ImportFixture, Uint8Array]> = [
      [IMPORT_FIXTURES.mcG1, utf8(g1RecibidosCsv())],
      [
        IMPORT_FIXTURES.mcCp1252,
        encodeCp1252(g3RecibidosCsv(small, { titles: G3_RECIBIDOS_TITLES_DEL_EMISOR })),
      ],
      [
        IMPORT_FIXTURES.mcExcelResaved,
        encodeCp1252(g3RecibidosCsv(small, { excel: true, eol: '\r\n' })),
      ],
      [IMPORT_FIXTURES.pivaViejo, utf8(portalIvaCsv(2511, 8, 5))],
      [IMPORT_FIXTURES.pivaNuevo, utf8(portalIvaCsv(2512, 4, 5))],
      [IMPORT_FIXTURES.mpRelease, utf8(mpReleaseCsv())],
      [IMPORT_FIXTURES.mpPanel, utf8(mpPanelCsv())],
      [IMPORT_FIXTURES.bankDc, encodeCp1252(bankDcCsv())],
      [IMPORT_FIXTURES.bankSigned, utf8(bankSignedTxt())],
      [IMPORT_FIXTURES.bankBalance, utf8(bankBalanceCsv())],
      [IMPORT_FIXTURES.bankHtml, utf8(bankHtml())],
    ]
    for (const [file, expected] of cases)
      expect({ file, same: same(importFixture(file), expected) }).toEqual({ file, same: true })
  })
})
