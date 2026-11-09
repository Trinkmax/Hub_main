/**
 * El `.xlsx` escrito a mano (`lib/xlsx/write.ts`): lo que se escribe se vuelve a leer igual con el lector de
 * los importadores, comprimido o no; el ZIP es válido (CRC incluido); y el XML de la hoja respeta el orden
 * del estándar, porque si no Excel ofrece «reparar» el archivo.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readWorkbookSheet } from '@/lib/imports/xlsx'
import { listZip, readZipEntry } from '@/lib/imports/zip'
import {
  buildXlsx,
  columnName,
  type XlsxSheetSpec,
  XlsxWriteError,
  xmlText,
  zipFiles,
} from '@/lib/xlsx/write'

const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(data))
const inflate = async (data: Uint8Array) => new Uint8Array(inflateRawSync(data))
const decoder = new TextDecoder()

const SHEETS: XlsxSheetSpec[] = [
  {
    name: 'Insumos',
    header: true,
    columns: [
      { width: 11, style: 'text' },
      { width: 30 },
      { width: 10 },
      { width: 38, hidden: true },
    ],
    rows: [
      ['Código', 'Insumo', 'Objetivo', 'Clave HUB'],
      ['INS-006', 'Bondiola de cerdo', 10, 'f0000000-0000-4000-8000-000000000001'],
      ['INS-007', 'Salsa <picante> & "ahumada"', 2.5, null],
      [null, 'Ñoquis   con   espacios ', 0, ''],
    ],
    validations: [
      {
        range: 'B2:B1000',
        source: { sheet: 'Listas', range: 'A2:A3' },
        strict: true,
        error: { title: 'No está', text: 'Elegí uno de la lista.' },
      },
      { range: 'C2:C1000', source: { sheet: 'Mis listas', range: 'B2:B9' }, strict: false },
    ],
  },
  { name: 'Cómo usarla', rows: [[{ value: 'Título', style: 'title' }], [null], ['• Una línea']] },
  { name: 'Listas', hidden: true, rows: [['Zonas'], ['Freezer'], ['Cámara']] },
  { name: 'Mis listas', hidden: true, rows: [['Unidades'], ['kg']] },
]

async function entryText(bytes: Uint8Array, name: string): Promise<string> {
  const entry = listZip(bytes).find((e) => e.name === name)
  if (!entry) throw new Error(`no está ${name}`)
  return decoder.decode(await readZipEntry(bytes, entry, inflate))
}

describe('ida y vuelta con el lector de los importadores', () => {
  it.each([
    ['comprimido', deflateRaw],
    ['sin comprimir', undefined],
  ] as const)('%s: la primera hoja vuelve igual', async (_name, deflate) => {
    const bytes = buildXlsx(SHEETS, { deflateRaw: deflate })
    const sheet = await readWorkbookSheet(bytes, inflate)
    expect(sheet.name).toBe('Insumos')
    expect(sheet.rows).toEqual([
      ['Código', 'Insumo', 'Objetivo', 'Clave HUB'],
      ['INS-006', 'Bondiola de cerdo', 10, 'f0000000-0000-4000-8000-000000000001'],
      ['INS-007', 'Salsa <picante> & "ahumada"', 2.5],
      [null, 'Ñoquis   con   espacios ', 0],
    ])
  })

  it('comprimido pesa menos', () => {
    expect(buildXlsx(SHEETS, { deflateRaw }).length).toBeLessThan(buildXlsx(SHEETS).length)
  })

  it('el ZIP tiene las partes de un libro y cada CRC cierra', async () => {
    const bytes = buildXlsx(SHEETS, { deflateRaw })
    const names = listZip(bytes).map((e) => e.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
      'xl/worksheets/sheet4.xml',
    ])
    // readZipEntry verifica el CRC-32 de cada uno.
    for (const entry of listZip(bytes)) await readZipEntry(bytes, entry, inflate)
  })
})

describe('el XML', () => {
  it('la hoja va en el orden del estándar', async () => {
    const xml = await entryText(buildXlsx(SHEETS), 'xl/worksheets/sheet1.xml')
    const order = [
      '<dimension',
      '<sheetViews',
      '<sheetFormatPr',
      '<cols',
      '<sheetData',
      '<autoFilter',
      '<dataValidations',
      '<pageMargins',
    ].map((tag) => xml.indexOf(tag))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('títulos fijos, columna oculta, listas con referencias absolutas', async () => {
    const xml = await entryText(buildXlsx(SHEETS), 'xl/worksheets/sheet1.xml')
    expect(xml).toContain('state="frozen"')
    expect(xml).toContain('<col min="4" max="4" width="38" hidden="1" customWidth="1"/>')
    expect(xml).toContain('<col min="1" max="1" width="11" style="4" customWidth="1"/>')
    expect(xml).toContain('<formula1>Listas!$A$2:$A$3</formula1>')
    expect(xml).toContain("<formula1>'Mis listas'!$B$2:$B$9</formula1>")
    expect(xml).toContain(
      'showErrorMessage="1" errorTitle="No está" error="Elegí uno de la lista."',
    )
    expect(xml).toMatch(/showErrorMessage="0" sqref="C2:C1000"/)
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr">')
    expect(xml).toContain('Salsa &lt;picante&gt; &amp; &quot;ahumada&quot;')
  })

  it('el libro: hojas ocultas y el rango del filtro', async () => {
    const xml = await entryText(buildXlsx(SHEETS), 'xl/workbook.xml')
    expect(xml).toContain('<sheet name="Listas" sheetId="3" state="hidden" r:id="rId3"/>')
    expect(xml).toContain('<sheet name="Cómo usarla" sheetId="2" r:id="rId2"/>')
    expect(xml).toContain(
      '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Insumos!$A$1:$D$4</definedName>',
    )
  })

  it('saca lo que no puede ir en un XML', () => {
    expect(xmlText('a\u0001b\u0008c\td\ne')).toBe('abc\td\ne')
  })
})

describe('las columnas y los errores', () => {
  it('nombres de columna', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ])
  })

  it('no arma un libro roto', () => {
    expect(() => buildXlsx([])).toThrow(XlsxWriteError)
    expect(() => buildXlsx([{ name: 'a/b', rows: [] }])).toThrow(XlsxWriteError)
    expect(() => buildXlsx([{ name: 'Oculta', hidden: true, rows: [] }])).toThrow(XlsxWriteError)
    expect(() =>
      buildXlsx([
        { name: 'Uno', rows: [] },
        { name: 'uno', rows: [] },
      ]),
    ).toThrow(XlsxWriteError)
    expect(() =>
      buildXlsx([
        {
          name: 'Uno',
          rows: [],
          validations: [
            {
              range: 'A1:A2',
              source: { sheet: 'Uno', range: 'B1:B2' },
              strict: true,
              error: { title: 'x', text: 'y'.repeat(256) },
            },
          ],
        },
      ]),
    ).toThrow(XlsxWriteError)
    expect(() => buildXlsx([{ name: 'Uno', rows: [[Number.NaN]] }])).toThrow(XlsxWriteError)
  })

  it('un ZIP guardado cuando comprimir no achica', async () => {
    const data = new Uint8Array([1, 2, 3])
    const bytes = zipFiles([{ name: 'a.bin', data }], { deflateRaw })
    const [entry] = listZip(bytes)
    expect(entry?.method).toBe(0)
    if (entry) expect(await readZipEntry(bytes, entry, inflate)).toEqual(data)
  })
})
