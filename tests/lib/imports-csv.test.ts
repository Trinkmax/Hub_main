import { describe, expect, it } from 'vitest'
import { isBlankRow, parseCsv, sniffDelimiter } from '@/lib/imports/csv'
import { G3_RECIBIDOS_TITLES } from '@/tests/fixtures/imports/synth'

describe('parseCsv', () => {
  it('comillas, comillas dobladas, separador y salto de línea adentro', () => {
    const text = '"a";"b ""c""";"d;e"\n"línea 1\nlínea 2";x;\n'
    expect(parseCsv(text, ';')).toEqual([
      ['a', 'b "c"', 'd;e'],
      ['línea 1\nlínea 2', 'x', ''],
    ])
  })

  it('CRLF, LF y CR solo; sin salto al final; con salto al final no agrega una fila', () => {
    expect(parseCsv('a,b\r\nc,d\re,f\ng,h', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
    expect(parseCsv('a;b\n', ';')).toEqual([['a', 'b']])
    expect(parseCsv('', ';')).toEqual([])
  })

  it('las líneas en blanco quedan (así el índice + 1 es la línea del archivo)', () => {
    const rows = parseCsv('Banco\n\nFecha;Importe\n01/10;5\n', ';')
    expect(rows).toEqual([['Banco'], [''], ['Fecha', 'Importe'], ['01/10', '5']])
    expect(isBlankRow(rows[1])).toBe(true)
    expect(isBlankRow(['', '  ', null])).toBe(true)
    expect(isBlankRow(['', 0])).toBe(false)
  })

  it('saca el BOM si quedó en el texto', () => {
    expect(parseCsv('﻿"Fecha";"Tipo"\n', ';')).toEqual([['Fecha', 'Tipo']])
  })

  it('una comilla en medio de un campo sin comillas es literal (el JSON de Mercado Pago con «;»)', () => {
    const line = '2026-10-04;release;[{"financial_entity":"debitos_creditos","amount":-120}];QR'
    expect(parseCsv(line, ';')).toEqual([
      ['2026-10-04', 'release', '[{"financial_entity":"debitos_creditos","amount":-120}]', 'QR'],
    ])
  })

  it('espacios antes de la comilla de apertura y texto después de cerrarla', () => {
    expect(parseCsv('a; "b;c" ;"d"e', ';')).toEqual([['a', 'b;c ', 'de']])
  })

  it('una comilla sin cerrar se toma hasta el final (tolerante)', () => {
    expect(parseCsv('a;"b\nc', ';')).toEqual([['a', 'b\nc']])
  })

  it('corta en maxRows', () => {
    expect(parseCsv('1\n2\n3\n4\n', ';', 2)).toEqual([['1'], ['2']])
  })
})

describe('sniffDelimiter', () => {
  const g3Header = G3_RECIBIDOS_TITLES.map((t) => `"${t}"`).join(';')

  it('la fila de títulos de ARCA: «;» (las comas de «IVA 2,5%» van entre comillas)', () => {
    expect(sniffDelimiter(g3Header)).toBe(';')
  })

  it('datos con coma decimal: gana «;» por columnas estables', () => {
    const data = [
      'Fecha;Tipo;Total',
      '2025-12-01;1;33500,00',
      '2025-12-01;3;22297,27',
      '2025-12-02;11;856492,00',
    ].join('\n')
    expect(sniffDelimiter(data)).toBe(';')
  })

  it('G1 todo entre comillas con «,», y Mercado Pago con el JSON entre comillas', () => {
    expect(
      sniffDelimiter('"Fecha","Tipo","Punto de Venta"\r\n"15/03/2022","1 - Factura A","00002"'),
    ).toBe(',')
    const mp = [
      'DATE,SOURCE_ID,RECORD_TYPE,TAXES_DISAGGREGATED,NET_CREDIT_AMOUNT',
      '2026-10-01T13:05:12.000-03:00,1,release,"[{financial_entity:debitos_creditos,amount:-406.80}]",66735.54',
      '2026-10-01T14:20:00.000-03:00,2,release,"[{a:1,b:2},{c:3}]",24357.50',
    ].join('\n')
    expect(sniffDelimiter(mp)).toBe(',')
  })

  it('«|» y tabulador; con metadatos antes de los títulos', () => {
    const pipe = [
      'Banco de la Nación Argentina',
      'Cuenta: 123',
      'FECHA|CONCEPTO|IMPORTE',
      '08/10/2026|X|-956,00',
      '09/10/2026|Y|1.000,00',
    ].join('\n')
    expect(sniffDelimiter(pipe)).toBe('|')
    expect(sniffDelimiter('Fecha\tImporte\n01/10\t1,5\n02/10\t2,5')).toBe('\t')
  })

  it('una sola columna: «;» por defecto', () => {
    expect(sniffDelimiter('una\nsola\ncolumna')).toBe(';')
  })
})
