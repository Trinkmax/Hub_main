import { describe, expect, it } from 'vitest'
import { splitVoucherText } from '@/components/administracion/voucher-text'

describe('números de comprobante enteros (no se cortan en el guion)', () => {
  it('separa el número con guiones del resto del texto', () => {
    expect(splitVoucherText('Coca-Cola · Factura A 0003-00001100 · venció hace 6 días')).toEqual([
      { text: 'Coca-Cola · Factura A ', keep: false, start: 0 },
      { text: '0003-00001100', keep: true, start: 22 },
      { text: ' · venció hace 6 días', keep: false, start: 35 },
    ])
  })

  it('un CUIT también queda entero', () => {
    expect(splitVoucherText('CUIT 30-70111222-5').filter((p) => p.keep)).toEqual([
      { text: '30-70111222-5', keep: true, start: 5 },
    ])
  })

  it('sin números con guion devuelve el texto tal cual (un solo tramo)', () => {
    expect(splitVoucherText('Pago')).toEqual([{ text: 'Pago', keep: false, start: 0 }])
    expect(splitVoucherText('Gasto #10 del 06/10')).toEqual([
      { text: 'Gasto #10 del 06/10', keep: false, start: 0 },
    ])
    expect(splitVoucherText('')).toEqual([])
  })

  it('juntar los tramos devuelve el texto original', () => {
    const text = 'NC A 0003-00000077 y FA 0005-00004321'
    expect(
      splitVoucherText(text)
        .map((p) => p.text)
        .join(''),
    ).toBe(text)
  })
})
