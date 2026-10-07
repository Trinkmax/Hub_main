import { describe, expect, it } from 'vitest'
import {
  buildCsv,
  type CsvCell,
  csvCell,
  csvDate,
  csvEscape,
  csvFormulaGuard,
  csvMoney,
  csvNumber,
  csvRow,
  csvText,
  EXCEL_ES_AR,
  rowsToCsv,
  writeCsvStream,
} from '@/lib/csv'
import * as eventMarketing from '@/lib/salon/event-marketing'
import * as statsCsv from '@/lib/stats/csv'

/** Lee un stream entero: los bytes (para ver el BOM) y el texto (sin tragarse el BOM). */
async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<{ text: string; bytes: number[]; chunks: number }> {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  const bytes = parts.flatMap((p) => Array.from(p))
  // `ignoreBOM: true` lo deja en el texto (por defecto TextDecoder lo saca).
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(bytes))
  return { text, bytes, chunks: parts.length }
}

// ─── Guarda contra fórmulas ──────────────────────────────────────────────────

describe('csvFormulaGuard', () => {
  it('pone apóstrofo a lo que Excel ejecutaría (=, +, -, @, tab, CR)', () => {
    for (const text of ['=SUMA(A1)', '+54 351 555', '-3 días', '@campaña', '\tTab', '\rCR']) {
      expect(csvFormulaGuard(text)).toBe(`'${text}`)
    }
  })

  it('deja igual el texto común (un guion en el medio no es fórmula)', () => {
    for (const text of [
      'Reels 1/9',
      'Coca-Cola',
      '',
      ' =espacio adelante',
      'Factura A 0003-00001290',
    ]) {
      expect(csvFormulaGuard(text)).toBe(text)
    }
  })

  it('event-marketing reexporta la misma función', () => {
    expect(eventMarketing.csvFormulaGuard).toBe(csvFormulaGuard)
  })
})

// ─── El escritor de siempre (lib/stats/csv) ──────────────────────────────────

describe('rowsToCsv y csvEscape (compatibles con lib/stats/csv)', () => {
  it('lib/stats/csv reexporta las mismas funciones', () => {
    expect(statsCsv.rowsToCsv).toBe(rowsToCsv)
    expect(statsCsv.csvEscape).toBe(csvEscape)
  })

  it('el CSV viejo sigue igual: coma, sin BOM, LF', () => {
    expect(rowsToCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\n1,"x,y"')
    expect(rowsToCsv(['nombre', 'edad'], [['Juan', 30]])).toBe('nombre,edad\nJuan,30')
    expect(csvEscape('a;b')).toBe('a;b')
    expect(csvEscape('a;b', ';')).toBe('"a;b"')
    expect(csvEscape('di "hola"')).toBe('"di ""hola"""')
    expect(csvEscape(null)).toBe('')
  })

  it('con BOM: CRLF (lo que espera Excel), y `eol` lo puede pisar', () => {
    const csv = rowsToCsv(['a', 'b'], [['1', '2']], { separator: ';', bom: true })
    expect(csv).toBe('﻿a;b\r\n1;2')
    expect(rowsToCsv(['a'], [['1']], { bom: true, eol: '\n' })).toBe('﻿a\n1')
    expect(rowsToCsv(['a'], [['1']], { eol: '\r\n' })).toBe('a\r\n1')
  })
})

// ─── Celdas tipadas ──────────────────────────────────────────────────────────

describe('celdas tipadas', () => {
  it('el texto pasa por la guarda; la plata y los números nunca', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('-3 días')).toBe("'-3 días")
    expect(csvCell(csvMoney(-123450))).toBe('-1234,50')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(-5n)).toBe('-5')
    expect(csvCell(2.5)).toBe('2,5')
  })

  it('plata: coma decimal y sin miles; vacía si no hay dato', () => {
    expect(csvMoney(86000000)).toEqual({ csv: '860000,00' })
    expect(csvMoney(5)).toEqual({ csv: '0,05' })
    expect(csvMoney(null)).toEqual({ csv: '' })
    expect(csvMoney(123456789012345n)).toEqual({ csv: '1234567890123,45' })
  })

  it('fechas dd/MM/yyyy cortando el ISO; vacía si no hay', () => {
    expect(csvCell(csvDate('2026-10-03'))).toBe('03/10/2026')
    expect(csvCell(csvDate(null))).toBe('')
  })

  it('números que no son plata', () => {
    expect(csvNumber(1290)).toEqual({ csv: '1290' })
    expect(csvNumber(21.5)).toEqual({ csv: '21,5' })
    expect(csvNumber(Number.NaN)).toEqual({ csv: '' })
    expect(csvNumber(null)).toEqual({ csv: '' })
  })

  it('vacío es vacío', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell('')).toBe('')
  })

  it('escapa separador, comillas y saltos de línea', () => {
    expect(csvCell('Pérez; Juan')).toBe('"Pérez; Juan"')
    expect(csvCell('di "hola"')).toBe('"di ""hola"""')
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
    // Con coma como separador, la coma decimal de la plata obliga a comillas.
    expect(csvCell(csvMoney(123450), ',')).toBe('"1234,50"')
  })

  it('el CUIT va como texto, tal cual', () => {
    expect(csvCell('30-71876543-5')).toBe('30-71876543-5')
  })

  it('csvText guarda el texto para armar filas a mano con rowsToCsv', () => {
    expect(csvText('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(csvText(null)).toBe('')
  })

  it('csvRow junta con el separador', () => {
    expect(csvRow(['a', csvMoney(-100), 3, null])).toBe('a;-1,00;3;')
    expect(csvRow(['a', 'b'], ',')).toBe('a,b')
  })
})

// ─── buildCsv y writeCsvStream ───────────────────────────────────────────────

const JOURNAL_HEADERS = [
  'Fecha',
  'N° asiento',
  'Código de cuenta',
  'Cuenta',
  'Debe',
  'Haber',
  'Leyenda',
  'Comprobante',
  'CUIT',
  'Partícipe',
]

const JOURNAL_ROWS: CsvCell[][] = [
  [
    csvDate('2026-10-03'),
    12,
    '5.1.01',
    'Mercadería',
    csvMoney(71074380),
    null,
    'Factura A 0003-00001290',
    'FA 0003-00001290',
    '30-71876543-5',
    'Coca-Cola (distribuidor)',
  ],
  [
    csvDate('2026-10-03'),
    12,
    '2.1.01',
    'Proveedores',
    null,
    csvMoney(86000000),
    '=cmd|" /C calc"!A0',
    null,
    null,
    '+Proveedor raro',
  ],
]

describe('buildCsv', () => {
  it('Excel es-AR por defecto: BOM, `;`, CRLF y sin salto al final', () => {
    expect(EXCEL_ES_AR).toEqual({ separator: ';', bom: true, eol: '\r\n' })
    const csv = buildCsv(JOURNAL_HEADERS, JOURNAL_ROWS)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toEqual([
      'Fecha;N° asiento;Código de cuenta;Cuenta;Debe;Haber;Leyenda;Comprobante;CUIT;Partícipe',
      '03/10/2026;12;5.1.01;Mercadería;710743,80;;Factura A 0003-00001290;FA 0003-00001290;30-71876543-5;Coca-Cola (distribuidor)',
      `03/10/2026;12;2.1.01;Proveedores;;860000,00;"'=cmd|"" /C calc""!A0";;;'+Proveedor raro`,
    ])
    expect(csv.endsWith('\r\n')).toBe(false)
  })

  it('lo que no se pide sale como Excel es-AR; lo pedido gana', () => {
    expect(buildCsv(['a'], [['1']], { bom: false })).toBe('a\r\n1')
    expect(buildCsv(['a', 'b'], [['1', '2']], { separator: ',', bom: false, eol: '\n' })).toBe(
      'a,b\n1,2',
    )
    expect(buildCsv(['a'], [], { eol: undefined })).toBe('﻿a')
  })

  it('acepta cualquier iterable de filas', () => {
    function* rows(): Generator<CsvCell[]> {
      yield ['x']
      yield ['y']
    }
    expect(buildCsv(['h'], rows(), { bom: false })).toBe('h\r\nx\r\ny')
  })
})

describe('writeCsvStream', () => {
  it('da exactamente el mismo texto que buildCsv, con el BOM en los bytes', async () => {
    const { text, bytes } = await readStream(writeCsvStream(JOURNAL_HEADERS, JOURNAL_ROWS))
    expect(text).toBe(buildCsv(JOURNAL_HEADERS, JOURNAL_ROWS))
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
  })

  it('pide las filas de a poco a un generador asíncrono y manda pedazos', async () => {
    let produced = 0
    async function* pages(): AsyncGenerator<CsvCell[]> {
      // Como el exporte: páginas de 500 pedidas con cursor.
      for (let page = 0; page < 10; page++) {
        await Promise.resolve()
        for (let i = 0; i < 500; i++) {
          produced++
          yield [
            csvDate('2026-10-01'),
            `Concepto ${page}-${i} con un texto largo`,
            csvMoney(i * 101),
          ]
        }
      }
    }
    const headers = ['Fecha', 'Concepto', 'Importe']
    const stream = writeCsvStream(headers, pages())
    expect(produced).toBe(0)
    const { text, chunks } = await readStream(stream)
    expect(produced).toBe(5000)
    expect(chunks).toBeGreaterThan(1)
    const expectedRows: CsvCell[][] = []
    for (let page = 0; page < 10; page++) {
      for (let i = 0; i < 500; i++) {
        expectedRows.push([
          csvDate('2026-10-01'),
          `Concepto ${page}-${i} con un texto largo`,
          csvMoney(i * 101),
        ])
      }
    }
    expect(text).toBe(buildCsv(headers, expectedRows))
  })

  it('sin filas: solo el encabezado', async () => {
    const { text } = await readStream(writeCsvStream(['a', 'b'], []))
    expect(text).toBe('﻿a;b')
  })

  it('si la fuente falla, el stream termina con ese error (no un CSV cortado)', async () => {
    async function* broken(): AsyncGenerator<CsvCell[]> {
      yield ['1']
      throw new Error('se cayó la base')
    }
    await expect(readStream(writeCsvStream(['a'], broken()))).rejects.toThrow('se cayó la base')
  })

  it('cancelar el stream cierra la fuente', async () => {
    let closed = false
    async function* endless(): AsyncGenerator<CsvCell[]> {
      try {
        for (let i = 0; ; i++) yield [`fila ${i}`]
      } finally {
        closed = true
      }
    }
    const reader = writeCsvStream(['a'], endless()).getReader()
    await reader.read()
    await reader.cancel('el cliente cerró la pestaña')
    expect(closed).toBe(true)
  })
})
