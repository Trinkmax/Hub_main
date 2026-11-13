// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkPriceJump, guardQuestion } from '@/lib/menu/prices/guard'
import { NBSP } from '@/lib/money'

/**
 * El cuidado de los ceros: «12» por «12.000» (o un cero de más) no se guarda sin preguntar.
 * Se pregunta cuando el precio nuevo queda a menos del 20 % del anterior o a más de 5 veces.
 */

const pesos = (n: number) => n * 100

describe('checkPriceJump', () => {
  it('un cambio normal se guarda sin preguntar', () => {
    expect(checkPriceJump(pesos(12_500), pesos(13_900))).toEqual({ kind: 'ok' })
    expect(checkPriceJump(pesos(12_500), pesos(9_000))).toEqual({ kind: 'ok' })
    expect(checkPriceJump(pesos(12_500), pesos(25_000))).toEqual({ kind: 'ok' })
  })

  it('justo en el borde no pregunta: 20 % y 5 veces todavía valen', () => {
    expect(checkPriceJump(pesos(10_000), pesos(2_000))).toEqual({ kind: 'ok' })
    expect(checkPriceJump(pesos(10_000), pesos(50_000))).toEqual({ kind: 'ok' })
    expect(checkPriceJump(pesos(10_000), pesos(1_999)).kind).toBe('confirm')
    expect(checkPriceJump(pesos(10_000), pesos(50_001)).kind).toBe('confirm')
  })

  it('«12» por «12.000»: pregunta y propone agregar los ceros', () => {
    expect(checkPriceJump(pesos(12_500), pesos(12))).toEqual({
      kind: 'confirm',
      why: 'low',
      typedCents: pesos(12),
      suggestedCents: pesos(12_000),
    })
  })

  it('propone la cantidad de ceros que deja el precio más cerca del anterior', () => {
    expect(checkPriceJump(pesos(12_500), pesos(139))).toMatchObject({
      suggestedCents: pesos(13_900),
    })
    expect(checkPriceJump(pesos(12_500), pesos(1_390))).toMatchObject({
      suggestedCents: pesos(13_900),
    })
    expect(checkPriceJump(pesos(1_500), pesos(15))).toMatchObject({ suggestedCents: pesos(1_500) })
    expect(checkPriceJump(pesos(80_000), pesos(85))).toMatchObject({
      suggestedCents: pesos(85_000),
    })
  })

  it('un cero de más: pregunta y propone sacarlo', () => {
    expect(checkPriceJump(pesos(12_500), pesos(139_000))).toEqual({
      kind: 'confirm',
      why: 'high',
      typedCents: pesos(139_000),
      suggestedCents: pesos(13_900),
    })
    expect(checkPriceJump(pesos(1_500), pesos(170_000))).toMatchObject({
      suggestedCents: pesos(1_700),
    })
  })

  it('una cifra de más que no es un cero: propone sacar la última', () => {
    expect(checkPriceJump(pesos(12_500), pesos(125_001))).toMatchObject({
      why: 'high',
      suggestedCents: pesos(12_500),
    })
  })

  it('dejar un precio en $ 0 se pregunta, sin proponer otro número', () => {
    expect(checkPriceJump(pesos(12_500), 0)).toEqual({
      kind: 'confirm',
      why: 'low',
      typedCents: 0,
      suggestedCents: null,
    })
  })

  it('sin precio anterior (o en $ 0) no hay contra qué comparar: se guarda', () => {
    expect(checkPriceJump(null, pesos(12))).toEqual({ kind: 'ok' })
    expect(checkPriceJump(0, pesos(12_000))).toEqual({ kind: 'ok' })
  })

  it('dejar el mismo precio nunca pregunta', () => {
    expect(checkPriceJump(pesos(12_500), pesos(12_500))).toEqual({ kind: 'ok' })
  })
})

describe('guardQuestion', () => {
  it('pregunta con los dos números, lo tipeado primero', () => {
    const jump = checkPriceJump(pesos(12_500), pesos(12))
    if (jump.kind !== 'confirm') throw new Error('tenía que preguntar')
    expect(guardQuestion(jump)).toBe(`¿$${NBSP}12 o $${NBSP}12.000?`)
  })

  it('sin un número para proponer, pregunta si es eso', () => {
    const jump = checkPriceJump(pesos(12_500), 0)
    if (jump.kind !== 'confirm') throw new Error('tenía que preguntar')
    expect(guardQuestion(jump)).toBe(`¿Seguro que $${NBSP}0?`)
  })
})
