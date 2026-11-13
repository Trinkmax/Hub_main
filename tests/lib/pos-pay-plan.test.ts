import { describe, expect, it } from 'vitest'
import {
  clampParts,
  defaultParts,
  equalProgress,
  MAX_PARTS,
  minParts,
  nextPart,
  partStubs,
  resumeParts,
} from '@/lib/pos/pay/plan'
import { payment, pesos } from './pos-pay-fixtures'

describe('partes iguales', () => {
  it('arranca en la cantidad de comensales', () => {
    expect(defaultParts(4, null, [])).toBe(4)
    expect(defaultParts(null, 8, [])).toBe(8)
    expect(defaultParts(null, null, [])).toBe(2)
    expect(defaultParts(1, null, [])).toBe(2)
    expect(defaultParts(400, null, [])).toBe(MAX_PARTS)
  })

  it('la primera parte es lo que falta dividido entre todos, al peso', () => {
    const part = nextPart(4, [], pesos(85_000))
    expect(part).toEqual({
      index: 1,
      parts: 4,
      left: 4,
      amountCents: pesos(21_250),
      label: 'Parte 1 de 4',
    })
    expect(nextPart(3, [], pesos(100_000)).amountCents).toBe(pesos(33_334))
  })

  it('lee de los cobros en qué parte va', () => {
    const paid = [
      payment('cash', 21_250, { payer_label: 'Parte 1 de 4' }),
      payment('debit', 21_250, { payer_label: 'Parte 2 de 4' }),
    ]
    expect(equalProgress(paid)).toEqual({ parts: 4, paid: 2, used: [1, 2] })
    expect(resumeParts(paid, pesos(42_500))).toBe(4)
    expect(nextPart(4, paid, pesos(42_500))).toMatchObject({
      index: 3,
      left: 2,
      amountCents: pesos(21_250),
      label: 'Parte 3 de 4',
    })
  })

  it('la última parte paga exactamente lo que falta', () => {
    const paid = [
      payment('cash', 33_334, { payer_label: 'Parte 1 de 3' }),
      payment('cash', 33_333, { payer_label: 'Parte 2 de 3' }),
    ]
    expect(nextPart(3, paid, pesos(33_333))).toMatchObject({
      index: 3,
      left: 1,
      amountCents: pesos(33_333),
    })
  })

  it('si en el medio baja la cuenta, lo que queda se reparte entre los que faltan', () => {
    const paid = [payment('cash', 25_000, { payer_label: 'Parte 1 de 4' })]
    // Se aprobó un descuento: en vez de 75.000 quedan 60.000 para tres.
    expect(nextPart(4, paid, pesos(60_000)).amountCents).toBe(pesos(20_000))
  })

  it('un cobro anulado libera su número de parte', () => {
    const paid = [
      payment('cash', 21_250, { payer_label: 'Parte 1 de 4' }),
      payment('cash', 21_250, { payer_label: 'Parte 2 de 4', status: 'voided' }),
      payment('qr', 21_250, { payer_label: 'Parte 3 de 4' }),
    ]
    expect(equalProgress(paid).paid).toBe(2)
    expect(nextPart(4, paid, pesos(42_500))).toMatchObject({ index: 2, left: 2 })
  })

  it('no se puede dividir entre menos de los que ya pagaron y uno más', () => {
    const paid = [
      payment('cash', 20_000, { payer_label: 'Parte 1 de 5' }),
      payment('cash', 20_000, { payer_label: 'Parte 2 de 5' }),
    ]
    expect(minParts(paid)).toBe(3)
    expect(clampParts(2, paid)).toBe(3)
    expect(clampParts(9, paid)).toBe(9)
    expect(minParts([])).toBe(2)
  })

  it('cambiar la cantidad a mitad de camino reparte lo que falta entre los nuevos', () => {
    const paid = [payment('cash', 25_000, { payer_label: 'Parte 1 de 4' })]
    // Eran cuatro, llegó uno más: los 75.000 que faltan ahora son de cuatro.
    expect(nextPart(5, paid, pesos(75_000))).toMatchObject({
      index: 2,
      parts: 5,
      left: 4,
      amountCents: pesos(18_750),
      label: 'Parte 2 de 5',
    })
  })

  it('los cobros que no son por partes no cuentan', () => {
    const paid = [payment('cash', 10_000), payment('qr', 5000, { payer_label: 'Juan' })]
    expect(equalProgress(paid)).toEqual({ parts: null, paid: 0, used: [] })
    expect(resumeParts(paid, pesos(50_000))).toBeNull()
  })

  it('no retoma un plan que ya terminó ni una mesa que no debe nada', () => {
    const all = [
      payment('cash', 10_000, { payer_label: 'Parte 1 de 2' }),
      payment('cash', 10_000, { payer_label: 'Parte 2 de 2' }),
    ]
    expect(resumeParts(all, pesos(5000))).toBeNull()
    expect(resumeParts([payment('cash', 10_000, { payer_label: 'Parte 1 de 2' })], 0)).toBeNull()
  })

  it('sigue con la cantidad del último cobro por partes', () => {
    const paid = [
      payment('cash', 20_000, {
        payer_label: 'Parte 1 de 4',
        created_at: '2026-11-13T02:00:00.000+00:00',
      }),
      payment('cash', 15_000, {
        payer_label: 'Parte 2 de 5',
        created_at: '2026-11-13T02:05:00.000+00:00',
      }),
    ]
    expect(equalProgress(paid).parts).toBe(5)
    expect(defaultParts(4, null, paid)).toBe(5)
  })

  it('arma los talones: cobrados, el que toca y los que faltan', () => {
    const paid = [payment('cash', 21_250, { payer_label: 'Parte 1 de 4' })]
    expect(partStubs(4, paid).map((s) => s.state)).toEqual(['paid', 'now', 'todo', 'todo'])
    expect(partStubs(2, []).map((s) => s.number)).toEqual([1, 2])
  })

  it('si no alcanza para un peso por cabeza no inventa plata', () => {
    expect(nextPart(3, [], pesos(2)).amountCents).toBe(pesos(1))
    expect(nextPart(3, [], 0).amountCents).toBe(0)
  })
})
