import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  columnIndex,
  formatKind,
  readFirstSheet,
  readSpreadsheetMl,
  readWorkbookSheet,
  richText,
  unescapeOoxml,
  XlsxError,
} from '@/lib/imports/xlsx'
import { inflateRawSync } from '@/lib/imports/zip'
import { parseXml } from '@/lib/xml/mini'
import { IMPORT_FIXTURES, importFixture, nodeInflateRaw } from '@/tests/fixtures/imports/fixtures'
import { excelSerial, SAS_CUIT, utf8, type XCell, xlsxParts } from '@/tests/fixtures/imports/synth'
import { buildZip } from '@/tests/fixtures/imports/zip-writer'

const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data))
const pack = (parts: Record<string, string>) =>
  buildZip(
    Object.entries(parts).map(([name, text]) => ({ name, data: utf8(text) })),
    { deflateRaw: deflate },
  )

describe('el Excel de Mis Comprobantes', () => {
  it('título combinado, títulos cortos y valores CRUDOS', async () => {
    const sheet = await readWorkbookSheet(importFixture(IMPORT_FIXTURES.mcXlsx))
    expect(sheet.name).toBe('Recibidos')
    expect(sheet.date1904).toBe(false)
    const [title, header, a, nc, c] = sheet.rows
    expect(title).toEqual([`Mis Comprobantes Recibidos - CUIT ${SAS_CUIT}`])
    expect(header?.slice(0, 3)).toEqual(['Fecha', 'Tipo', 'Punto de Venta'])
    expect(header).toHaveLength(30)
    // Fecha como texto, tipo con descripción, CAE numérico, nombre en «rich text» SIN la fonética.
    expect(a?.slice(0, 13)).toEqual([
      '01/12/2025',
      '1 - Factura A',
      3,
      110266,
      110266,
      75483269557186,
      'CUIT',
      expect.stringMatching(/^30\d{9}$/),
      'DISTRIBUIDORA EJEMPLO & CÍA SA',
      'CUIT',
      SAS_CUIT,
      1,
      '$',
    ])
    expect(a?.[20]).toBe(5814.05)
    expect(a?.[29]).toBe(33500)
    // Fecha como celda de fecha (formato propio dd/mm/yyyy) y Moneda como resultado de fórmula.
    expect(nc?.[0]).toBe('2025-12-02')
    expect(nc?.[12]).toBe('$')
    // Texto en línea.
    expect(c?.[8]).toBe('MONOTRIBUTISTA DE PRUEBA')
    expect(c?.[13]).toBe(0)
  })

  it('readFirstSheet da las mismas filas, con cualquier descompresor', async () => {
    const bytes = importFixture(IMPORT_FIXTURES.mcXlsx)
    const a = await readFirstSheet(bytes)
    expect(await readFirstSheet(bytes, inflateRawSync)).toEqual(a)
    expect(await readFirstSheet(bytes, nodeInflateRaw)).toEqual(a)
  })
})

describe('celdas', () => {
  const n = (v: number, s?: number): XCell => (s ? { t: 'n', v, s } : { t: 'n', v })

  it('booleanos, errores, fórmulas, vacíos intermedios y escapes _xHHHH_', async () => {
    const rows: XCell[][] = [
      [
        { t: 'b', v: true },
        { t: 'b', v: false },
        { t: 'e', v: '#N/A' },
        null,
        { t: 's', v: 'a_x000D_b' },
      ],
      [{ t: 'str', v: 'fórmula' }, n(-1.5e-2)],
    ]
    const sheet = await readWorkbookSheet(pack(xlsxParts({ sheetName: 'H', rows })))
    expect(sheet.rows).toEqual([
      [true, false, null, null, 'a\rb'],
      ['fórmula', -0.015],
    ])
  })

  it('el «Tipo Cambio» con formato que se come el punto: se lee el valor crudo', async () => {
    const sheet = await readWorkbookSheet(
      pack(xlsxParts({ sheetName: 'H', rows: [[n(1438.43498, 4)]] })),
    )
    expect(sheet.rows[0]?.[0]).toBe(1438.43498)
  })

  it('fechas: formato 14 y propio, con hora, y el sistema 1904', async () => {
    const serial = excelSerial('2025-12-01')
    const rows: XCell[][] = [[n(serial, 1), n(serial, 2), n(serial + 0.75, 1), n(serial, 3)]]
    const sheet = await readWorkbookSheet(pack(xlsxParts({ sheetName: 'H', rows })))
    expect(sheet.rows[0]).toEqual(['2025-12-01', '2025-12-01', '2025-12-01T18:00:00', serial])
    const mac = await readWorkbookSheet(
      pack(xlsxParts({ sheetName: 'H', rows: [[n(serial - 1462, 1)]], date1904: true })),
    )
    expect(mac.date1904).toBe(true)
    expect(mac.rows[0]?.[0]).toBe('2025-12-01')
  })

  it('filas y celdas sin el atributo r (otros generadores)', async () => {
    const rows: XCell[][] = [
      [
        { t: 's', v: 'Fecha' },
        { t: 's', v: 'Importe' },
      ],
      [n(1), n(2)],
    ]
    const sheet = await readWorkbookSheet(pack(xlsxParts({ sheetName: 'H', rows, omitRefs: true })))
    expect(sheet.rows).toEqual([
      ['Fecha', 'Importe'],
      [1, 2],
    ])
  })

  it('filas salteadas quedan vacías (el índice + 1 es la fila de la hoja)', async () => {
    const sheetXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>uno</t></is></c></row><row r="4"><c r="C4"><v>3</v></c></row></sheetData></worksheet>`
    const parts = xlsxParts({ sheetName: 'H', rows: [] })
    parts['xl/worksheets/sheet1.xml'] = sheetXml
    const sheet = await readWorkbookSheet(pack(parts))
    expect(sheet.rows).toEqual([['uno'], [], [], [null, null, 3]])
  })
})

describe('libro', () => {
  it('la primera hoja VISIBLE, por el r:id del libro', async () => {
    const parts = xlsxParts({ sheetName: 'Visible', rows: [[{ t: 's', v: 'visible' }]] })
    parts['xl/workbook.xml'] = parts['xl/workbook.xml']?.replace(
      '<sheets>',
      '<sheets><sheet name="Oculta" sheetId="9" state="hidden" r:id="rId9"/>',
    ) as string
    parts['xl/_rels/workbook.xml.rels'] = parts['xl/_rels/workbook.xml.rels']?.replace(
      '</Relationships>',
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/oculta.xml"/></Relationships>',
    ) as string
    parts['xl/worksheets/oculta.xml'] =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>oculta</t></is></c></row></sheetData></worksheet>'
    const sheet = await readWorkbookSheet(pack(parts))
    expect(sheet.name).toBe('Visible')
    expect(sheet.rows).toEqual([['visible']])
  })

  it('un ZIP sin libro, o con una parte ilegible', async () => {
    const notExcel = buildZip([{ name: 'word/document.xml', data: utf8('<w/>') }], {
      deflateRaw: deflate,
    })
    await expect(readWorkbookSheet(notExcel)).rejects.toBeInstanceOf(XlsxError)
    const parts = xlsxParts({ sheetName: 'H', rows: [[{ t: 's', v: 'x' }]] })
    parts['xl/worksheets/sheet1.xml'] = '<worksheet><sheetData><row></worksheet>'
    await expect(readWorkbookSheet(pack(parts))).rejects.toMatchObject({ code: 'xlsx_corrupt' })
  })
})

describe('utilidades', () => {
  it('columnIndex', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AA1')).toBe(26)
    expect(columnIndex('AD1')).toBe(29)
    expect(columnIndex('$B$2')).toBe(1)
    expect(columnIndex('1A')).toBeNull()
  })

  it('formatKind: fechas, horas y números', () => {
    expect(formatKind('dd/mm/yyyy')).toBe('date')
    expect(formatKind('[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy')).toBe('date')
    expect(formatKind('d/m/yy h:mm')).toBe('date')
    expect(formatKind('h:mm:ss')).toBe('time')
    expect(formatKind('[h]:mm')).toBe('time')
    expect(formatKind('mmm-yy')).toBe('date')
    expect(formatKind('General')).toBeNull()
    expect(formatKind('#,##0.00 "USD"')).toBeNull()
    expect(formatKind('[Red]-#,##0.00;0.00')).toBeNull()
    expect(formatKind('0.00E+00')).toBeNull()
    expect(formatKind('@')).toBeNull()
  })

  it('richText y unescapeOoxml', () => {
    const si = parseXml(
      '<si><r><t xml:space="preserve">Hola </t></r><r><t>mundo_x000A_</t></r><rPh sb="0" eb="1"><t>ホラ</t></rPh></si>',
    )
    expect(richText(si)).toBe('Hola mundo\n')
    expect(richText(null)).toBe('')
    expect(unescapeOoxml('a_x005F_x000D_b')).toBe('a_x000D_b')
  })
})

describe('XML de Excel 2003 (SpreadsheetML)', () => {
  it('índices, celdas combinadas, tipos y texto con formato HTML', () => {
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Movimientos">
  <Table>
   <Row><Cell ss:MergeAcross="2"><Data ss:Type="String">Banco de la Nación</Data></Cell><Cell><Data ss:Type="Boolean">1</Data></Cell></Row>
   <Row ss:Index="3"><Cell><Data ss:Type="DateTime">2026-10-01T00:00:00.000</Data></Cell><Cell ss:Index="3"><Data ss:Type="Number">-1234.5</Data></Cell><Cell><ss:Data ss:Type="String" xmlns="http://www.w3.org/TR/REC-html40"><B>COMISION</B> PAQUETES</ss:Data></Cell><Cell><Data ss:Type="Error">#N/A</Data></Cell></Row>
  </Table>
 </Worksheet>
</Workbook>`
    expect(readSpreadsheetMl(xml)).toEqual([
      ['Banco de la Nación', null, null, true],
      [],
      ['2026-10-01', null, -1234.5, 'COMISION PAQUETES', null],
    ])
  })

  it('sin hojas o mal formado', () => {
    expect(() => readSpreadsheetMl('<Workbook></Workbook>')).toThrow(XlsxError)
    expect(() => readSpreadsheetMl('<Workbook><Worksheet>')).toThrow(XlsxError)
  })
})
