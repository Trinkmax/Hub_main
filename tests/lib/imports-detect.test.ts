import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  detectSource,
  detectTableSource,
  IMPORT_MAX_FILE_BYTES,
  openTable,
} from '@/lib/imports/detect'
import { inflateRawSync } from '@/lib/imports/zip'
import {
  IMPORT_FIXTURES,
  type ImportFixture,
  importFixture,
} from '@/tests/fixtures/imports/fixtures'
import { encodeCp1252, utf8, xlsxParts } from '@/tests/fixtures/imports/synth'
import { buildZip } from '@/tests/fixtures/imports/zip-writer'

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data))

describe('detectSource con cada fixture', () => {
  const cases: Array<[ImportFixture, string, string, string | null, string | null]> = [
    // archivo, origen, contenedor, codificación, separador
    [IMPORT_FIXTURES.mcG3Dic, 'arca_recibidos', 'zip_csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.mcG3Nov, 'arca_recibidos', 'zip_csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.mcG2Recibidos, 'arca_recibidos', 'zip_csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.mcG2Emitidos, 'arca_emitidos', 'zip_csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.mcXlsx, 'arca_recibidos', 'xlsx', null, null],
    [IMPORT_FIXTURES.mcG1, 'arca_recibidos', 'csv', 'utf-8', ','],
    [IMPORT_FIXTURES.mcCp1252, 'arca_recibidos', 'csv', 'windows-1252', ';'],
    [IMPORT_FIXTURES.mcExcelResaved, 'arca_recibidos', 'csv', 'windows-1252', ';'],
    [IMPORT_FIXTURES.pivaViejo, 'portal_iva_compras', 'csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.pivaNuevo, 'portal_iva_compras', 'csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.mpRelease, 'mp_release', 'csv', 'utf-8', ','],
    [IMPORT_FIXTURES.mpPanel, 'mp_release', 'csv', 'utf-8', ';'],
    [IMPORT_FIXTURES.bankDc, 'bank', 'csv', 'windows-1252', ';'],
    [IMPORT_FIXTURES.bankSigned, 'bank', 'csv', 'utf-8', '|'],
    [IMPORT_FIXTURES.bankBalance, 'bank', 'csv', 'utf-8', ','],
    [IMPORT_FIXTURES.bankXlsx, 'bank', 'xlsx', null, null],
    [IMPORT_FIXTURES.bankHtml, 'bank', 'html', 'utf-8', null],
  ]
  for (const [file, source, container, encoding, delimiter] of cases) {
    it(`${file} → ${source}`, async () => {
      const r = await detectSource({ bytes: importFixture(file), fileName: file })
      expect(r.issue).toBeNull()
      expect(r.source).toBe(source)
      expect(r.table).toMatchObject({ container, encoding, delimiter })
    })
  }

  it('el CSV de adentro del ZIP trae su nombre (Recibidos/Emitidos, CUIT de quien consultó)', async () => {
    const r = await detectSource({
      bytes: importFixture(IMPORT_FIXTURES.mcG2Emitidos),
      fileName: 'x.zip',
    })
    expect(r.table?.entryName).toMatch(/^comprobantes_consulta_csv_emitidos_\d+_20123456786_/)
    expect(r.table?.cellKind).toBe('csv')
  })

  it('sin DecompressionStream (inflate propio) da lo mismo', async () => {
    const bytes = importFixture(IMPORT_FIXTURES.mcG3Dic)
    const a = await openTable({ bytes })
    const b = await openTable({ bytes, inflateRaw: inflateRawSync })
    expect(a.ok && b.ok && a.table.rows.length === b.table.rows.length).toBe(true)
  })
})

describe('openTable: lo que no se puede leer', () => {
  const issueOf = async (bytes: Uint8Array) => {
    const r = await openTable({ bytes })
    return r.ok ? null : r.issue.code
  }

  it('vacío, .xls viejo, PDF, binario y demasiado grande', async () => {
    expect(await issueOf(new Uint8Array())).toBe('file_empty')
    expect(
      await issueOf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])),
    ).toBe('file_xls_biff')
    expect(await issueOf(utf8('%PDF-1.4\n...'))).toBe('file_pdf')
    expect(await issueOf(Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 32))).toBe(
      'file_not_table',
    )
    expect(await issueOf(new Uint8Array(IMPORT_MAX_FILE_BYTES + 1))).toBe('file_too_big')
    expect(await issueOf(utf8('\n\n  \n'))).toBe('file_empty')
  })

  it('ZIP vacío, con varios archivos, con contraseña o roto', async () => {
    expect(await issueOf(buildZip([], { deflateRaw: deflate }))).toBe('file_zip_empty')
    const two = buildZip(
      [
        { name: 'a.csv', data: utf8('x') },
        { name: 'b.csv', data: utf8('y') },
      ],
      { deflateRaw: deflate },
    )
    expect(await issueOf(two)).toBe('file_zip_many')
    const enc = buildZip([{ name: 'a.csv', data: utf8('x') }], {
      deflateRaw: deflate,
      encrypted: true,
    })
    expect(await issueOf(enc)).toBe('file_zip_encrypted')
    const ok = buildZip([{ name: 'a.csv', data: utf8('Fecha;Tipo\n') }], { deflateRaw: deflate })
    expect(await issueOf(ok.subarray(0, ok.length - 10))).toBe('file_zip_corrupt')
    const xls = buildZip(
      [
        {
          name: 'viejo.xls',
          data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        },
      ],
      {
        deflateRaw: deflate,
      },
    )
    expect(await issueOf(xls)).toBe('file_xls_biff')
  })

  it('un ZIP con un CSV y basura de macOS, o con un .xlsx adentro', async () => {
    const withJunk = buildZip(
      [
        { name: '__MACOSX/._recibidos.csv', data: utf8('junk') },
        {
          name: 'recibidos.csv',
          data: utf8('"Fecha";"Tipo";"Punto de Venta";"Imp. Total"\n2025-12-01;1;3;10,00\n'),
        },
      ],
      { deflateRaw: deflate },
    )
    const r = await detectSource({ bytes: withJunk })
    expect(r.source).toBe('arca_recibidos')
    expect(r.table?.entryName).toBe('recibidos.csv')

    const inner = buildZip(
      Object.entries(xlsxParts({ sheetName: 'H', rows: [[{ t: 's', v: 'hola' }]] })).map(
        ([name, t]) => ({
          name,
          data: utf8(t),
        }),
      ),
      { deflateRaw: deflate },
    )
    const nested = buildZip([{ name: 'movimientos.xlsx', data: inner, method: 0 }], {
      deflateRaw: deflate,
    })
    const n = await openTable({ bytes: nested })
    expect(n.ok && n.table.container).toBe('zip_xlsx')
    expect(n.ok && n.table.rows).toEqual([['hola']])
  })

  it('tildes rotas: se arreglan y se avisa', async () => {
    const broken = utf8(
      '"Fecha de EmisiÃ³n";"Tipo de Comprobante";"Punto de Venta";"Imp. Total"\n2025-12-01;1;3;10,00\n',
    )
    const r = await openTable({ bytes: broken })
    expect(r.ok && r.table.rows[0]?.[0]).toBe('Fecha de Emisión')
    expect(r.ok && r.table.issues.map((i) => i.code)).toEqual(['file_mojibake_repaired'])
  })
})

describe('detectTableSource', () => {
  it('el reporte equivocado de Mercado Pago y lo desconocido', () => {
    expect(
      detectTableSource([
        ['DATE', 'SOURCE_ID', 'TRANSACTION_TYPE', 'TRANSACTION_AMOUNT', 'SETTLEMENT_NET_AMOUNT'],
      ]),
    ).toBe('mp_settlement')
    expect(
      detectTableSource([
        ['Nombre', 'Apellido'],
        ['a', 'b'],
      ]),
    ).toBe('unknown')
  })

  it('sin columnas del emisor ni del receptor, decide el título o el nombre del archivo', () => {
    const rows = [
      ['Mis Comprobantes Emitidos - CUIT 30712345671'],
      ['Fecha', 'Tipo', 'Punto de Venta', 'Imp. Total'],
    ]
    expect(detectTableSource(rows)).toBe('arca_emitidos')
    expect(
      detectTableSource(rows.slice(1), 'comprobantes_consulta_csv_emitidos_1_20123456786_x.csv'),
    ).toBe('arca_emitidos')
    expect(detectTableSource(rows.slice(1))).toBe('arca_recibidos')
  })

  it('un CSV de Windows-1252 de un banco', async () => {
    const r = await detectSource({
      bytes: encodeCp1252('Fecha;Descripción;Débito;Crédito;Saldo\n01/10/2026;X;1,00;;5,00\n'),
    })
    expect(r.source).toBe('bank')
  })
})
