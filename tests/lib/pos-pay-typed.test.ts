import { describe, expect, it } from 'vitest'
import { NBSP } from '@/lib/money'
import {
  amountWindow,
  discountWindow,
  judgeTyped,
  tenderWindow,
  tipWindow,
  typedQuestion,
} from '@/lib/pos/pay/typed'
import { pesos } from './pos-pay-fixtures'

const BILLS = [20000, 10000, 2000, 1000, 500, 200, 100]

describe('el cuidado de los ceros', () => {
  it('vacío no es cero', () => {
    expect(judgeTyped(null, amountWindow(pesos(85_000)))).toEqual({ kind: 'empty' })
    expect(judgeTyped(0, amountWindow(pesos(85_000)))).toEqual({ kind: 'empty' })
  })

  it('«129» por $ 129.000: pregunta y propone los miles', () => {
    const verdict = judgeTyped(pesos(129), amountWindow(pesos(250_000)))
    expect(verdict).toEqual({
      kind: 'ask',
      cents: pesos(129),
      why: 'low',
      suggestedCents: pesos(129_000),
      canKeep: true,
    })
    if (verdict.kind !== 'ask') throw new Error('tenía que preguntar')
    // Entre el signo y el número va un espacio duro: el importe no se parte en dos renglones.
    expect(typedQuestion(verdict)).toBe(`¿$${NBSP}129 o $${NBSP}129.000?`)
  })

  it('un monto razonable pasa sin preguntar', () => {
    expect(judgeTyped(pesos(20_000), amountWindow(pesos(85_000)))).toEqual({
      kind: 'ok',
      cents: pesos(20_000),
    })
    expect(judgeTyped(pesos(85_000), amountWindow(pesos(85_000))).kind).toBe('ok')
  })

  it('si los miles no entran en lo que falta, pregunta sin proponer', () => {
    const verdict = judgeTyped(pesos(129), amountWindow(pesos(85_000)))
    expect(verdict).toMatchObject({ kind: 'ask', suggestedCents: null, canKeep: true })
    if (verdict.kind !== 'ask') throw new Error('tenía que preguntar')
    expect(typedQuestion(verdict)).toBe(`¿Seguro que $${NBSP}129?`)
  })

  it('más de lo que falta no se puede dejar', () => {
    const verdict = judgeTyped(pesos(850_000), amountWindow(pesos(85_000)))
    expect(verdict).toMatchObject({
      kind: 'ask',
      why: 'high',
      canKeep: false,
      suggestedCents: pesos(85_000),
    })
  })

  it('en una cuenta chica, un monto chico es normal', () => {
    expect(judgeTyped(pesos(800), amountWindow(pesos(800))).kind).toBe('ok')
  })
})

describe('con cuánto paga', () => {
  const window = tenderWindow(pesos(47_000), BILLS)

  it('«50» para una cuenta de $ 47.000 son $ 50.000', () => {
    expect(judgeTyped(pesos(50), window)).toEqual({
      kind: 'ask',
      cents: pesos(50),
      why: 'low',
      suggestedCents: pesos(50_000),
      canKeep: false,
    })
  })

  it('justo y con un billete más grande pasan', () => {
    expect(judgeTyped(pesos(47_000), window).kind).toBe('ok')
    expect(judgeTyped(pesos(50_000), window).kind).toBe('ok')
    expect(judgeTyped(pesos(100_000), window).kind).toBe('ok')
  })

  it('un cero de más: «500000» por $ 50.000', () => {
    expect(judgeTyped(pesos(500_000), window)).toMatchObject({
      kind: 'ask',
      why: 'high',
      suggestedCents: pesos(50_000),
      canKeep: true,
    })
  })

  it('pagar algo chico con el billete más grande es normal', () => {
    expect(judgeTyped(pesos(20_000), tenderWindow(pesos(1500), BILLS)).kind).toBe('ok')
  })

  it('lo que no alcanza y no tiene arreglo, no se puede dejar', () => {
    expect(judgeTyped(pesos(30_000), window)).toMatchObject({
      kind: 'ask',
      canKeep: false,
      suggestedCents: null,
    })
  })
})

describe('la propina y el descuento en pesos', () => {
  it('«5» de propina en una cuenta de $ 47.000 son $ 5.000', () => {
    expect(judgeTyped(pesos(5), tipWindow(pesos(47_000)))).toMatchObject({
      kind: 'ask',
      why: 'low',
      suggestedCents: pesos(5000),
    })
  })

  it('una propina del 10 % pasa; una del 100 % se pregunta', () => {
    expect(judgeTyped(pesos(4700), tipWindow(pesos(47_000))).kind).toBe('ok')
    expect(judgeTyped(pesos(47_000), tipWindow(pesos(47_000)))).toMatchObject({
      kind: 'ask',
      why: 'high',
      suggestedCents: pesos(4700),
      canKeep: true,
    })
  })

  it('en un café, $ 500 de propina no se discuten', () => {
    expect(judgeTyped(pesos(500), tipWindow(pesos(2500))).kind).toBe('ok')
  })

  it('«5» de descuento sobre $ 165.000 son $ 5.000', () => {
    expect(judgeTyped(pesos(5), discountWindow(pesos(165_000), pesos(85_000)))).toMatchObject({
      kind: 'ask',
      suggestedCents: pesos(5000),
    })
  })

  it('un descuento no puede pasar lo que falta cobrar', () => {
    expect(judgeTyped(pesos(90_000), discountWindow(pesos(165_000), pesos(85_000)))).toMatchObject({
      kind: 'ask',
      canKeep: false,
    })
    expect(judgeTyped(pesos(85_000), discountWindow(pesos(165_000), pesos(85_000))).kind).toBe('ok')
  })
})
