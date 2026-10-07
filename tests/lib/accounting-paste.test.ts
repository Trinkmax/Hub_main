import { describe, expect, it } from 'vitest'
import {
  isPastedColumn,
  parsePastedColumn,
  parseRange,
  parseVoucherNumber,
  splitPastedVoucher,
} from '@/lib/accounting/paste'

describe('parsePastedColumn: una columna del cierre de caja de Thinkeon', () => {
  it('etiqueta + importe con tab, «$», miles, filas vacías y el salto final del portapapeles', () => {
    const pasted = [
      'Efectivo\t$ 350.000,00',
      'Transferencia\t$ 180.000,00',
      'QR Mercado Pago\t$ 220.000,00',
      'Débito\t410.000',
      'Crédito\t$ 330.000,00',
      'PedidosYa\t150.000,00',
      'Rappi\t',
      'Cuenta corriente\t-',
      '',
    ].join('\n')
    expect(parsePastedColumn(pasted)).toEqual({
      values: [35_000_000, 18_000_000, 22_000_000, 41_000_000, 33_000_000, 15_000_000, null, null],
      errors: [],
    })
  })

  it('una columna de números sola, con CRLF y decimales', () => {
    expect(parsePastedColumn('350000\r\n180000,50\r\n\r\n6.000\r\n').values).toEqual([
      35_000_000,
      18_000_050,
      null,
      600_000,
    ])
  })

  it('las filas vacías del medio se conservan: nada se corre', () => {
    expect(parsePastedColumn('100\n\n\n300').values).toEqual([10_000, null, null, 30_000])
  })

  it('toma la última celda que es un importe (el monto va a la derecha)', () => {
    expect(parsePastedColumn('3\tCafé\t$ 4.500,00').values).toEqual([450_000])
  })

  it('formato inglés pegado de una planilla', () => {
    expect(parsePastedColumn('1,234.50\n2,000').values).toEqual([123_450, 200_000])
  })

  it('un negativo o algo ilegible es un error de esa fila, con el mensaje del campo de plata', () => {
    const result = parsePastedColumn('100\n-50\nhola\n200')
    expect(result.values).toEqual([10_000, null, null, 20_000])
    expect(result.errors).toEqual([
      { index: 1, raw: '-50', message: 'Tiene que ser un importe positivo.' },
      { index: 2, raw: 'hola', message: 'No entendemos «hola». Escribilo como 1.234,50.' },
    ])
  })

  it('¿es una columna o un solo importe?', () => {
    expect(isPastedColumn('350.000')).toBe(false)
    expect(isPastedColumn('350.000\n')).toBe(false)
    expect(isPastedColumn('350.000\n180.000')).toBe(true)
  })
})

describe('parseVoucherNumber: «0003-00001290»', () => {
  it('separa punto de venta y número', () => {
    expect(parseVoucherNumber('0003-00001290')).toEqual({ pointOfSale: 3, number: 1290 })
    expect(parseVoucherNumber('00003-00001290')).toEqual({ pointOfSale: 3, number: 1290 })
    expect(parseVoucherNumber('Factura A 0003-00001290')).toEqual({ pointOfSale: 3, number: 1290 })
    expect(parseVoucherNumber('000300001290')).toEqual({ pointOfSale: 3, number: 1290 })
    expect(splitPastedVoucher('3-1290')).toEqual({ pointOfSale: 3, number: 1290 })
  })

  it('lo que no se lee da null', () => {
    expect(parseVoucherNumber('hola')).toBeNull()
    expect(parseVoucherNumber('0003-00000000')).toBeNull()
    expect(parseVoucherNumber('')).toBeNull()
  })
})

describe('parseRange: «0003-00014501 a 0003-00014662»', () => {
  it('la fila facturada del cierre (E8)', () => {
    expect(parseRange('0003-00014501 a 0003-00014662')).toEqual({
      ok: true,
      pointOfSale: 3,
      from: 14_501,
      to: 14_662,
      count: 162,
    })
    expect(parseRange('0004-00002101 al 00002130')).toEqual({
      ok: true,
      pointOfSale: 4,
      from: 2_101,
      to: 2_130,
      count: 30,
    })
    expect(parseRange('Factura B 0003-00014663 hasta 0003-00014720')).toMatchObject({
      ok: true,
      count: 58,
    })
  })

  it('errores con su mensaje', () => {
    expect(parseRange('0003-00014662 a 0003-00014501')).toEqual({
      ok: false,
      reason: 'invertido',
      message: 'El «hasta» no puede ser menor que el «desde».',
    })
    expect(parseRange('0003-00014501 a 0004-00014662')).toMatchObject({
      ok: false,
      reason: 'puntos-distintos',
    })
    expect(parseRange('cualquier cosa')).toEqual({
      ok: false,
      reason: 'ilegible',
      message: 'Escribí el rango como 0003-00014501 a 0003-00014662.',
    })
  })
})
