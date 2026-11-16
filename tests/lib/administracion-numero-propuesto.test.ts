import { describe, expect, it } from 'vitest'
import {
  padPos,
  voucherParts,
} from '@/app/(manager)/[tenantSlug]/administracion/compras/_components/voucher-number-input'
import { voucherNumberIncomplete } from '@/lib/accounting/voucher-types'

/**
 * El número de factura es opcional (pedido de los socios, 16/11/2026). El sistema propone el punto
 * de venta de la última factura del proveedor: si nadie escribe el número, ese punto de venta no
 * cuenta y el comprobante se guarda sin número, sin trabar con «le falta la mitad».
 */
describe('el punto de venta propuesto no traba guardar sin número', () => {
  const half = (value: { pos: string; number: string }, suggested: string | null) => {
    const parts = voucherParts(value, suggested)
    return { ...parts, incomplete: voucherNumberIncomplete(parts.pointOfSale, parts.number) }
  }

  it('propuesto y sin número: va sin ninguno de los dos', () => {
    const proposed = padPos('12')
    expect(half({ pos: proposed, number: '' }, proposed)).toEqual({
      pointOfSale: null,
      number: null,
      incomplete: false,
    })
  })

  it('propuesto y con número: van los dos', () => {
    expect(half({ pos: '0012', number: '00413504' }, '0012')).toEqual({
      pointOfSale: 12,
      number: 413504,
      incomplete: false,
    })
  })

  it('un punto de venta escrito a mano sin número sigue a medias, y se avisa', () => {
    // No había propuesta, o la persona escribió otro.
    expect(half({ pos: '0003', number: '' }, null).incomplete).toBe(true)
    expect(half({ pos: '0003', number: '' }, '0012').incomplete).toBe(true)
  })

  it('un número sin punto de venta también queda a medias', () => {
    expect(half({ pos: '', number: '00001290' }, '0012')).toEqual({
      pointOfSale: null,
      number: 1290,
      incomplete: true,
    })
  })

  it('todo vacío: sin número', () => {
    expect(half({ pos: '', number: '' }, null)).toEqual({
      pointOfSale: null,
      number: null,
      incomplete: false,
    })
    // Una propuesta vacía no convierte nada en propuesto.
    expect(half({ pos: '', number: '' }, '')).toEqual({
      pointOfSale: null,
      number: null,
      incomplete: false,
    })
  })
})
