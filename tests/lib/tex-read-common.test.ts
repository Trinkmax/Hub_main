import { describe, expect, it } from 'vitest'
import {
  cappedBySize,
  compact,
  moneyIf,
  newestFirst,
  plain,
  shortText,
  sideBalance,
  texMonth,
  texPeriod,
} from '@/lib/tex/tools/read/common'

const TODAY = '2026-11-05'

describe('texPeriod', () => {
  it('sin nada, el mes en curso', () => {
    expect(texPeriod({}, TODAY)).toEqual({
      ok: true,
      from: '2026-11-01',
      to: '2026-11-30',
      month: '2026-11',
      label: 'Noviembre 2026',
    })
  })

  it('un mes entero', () => {
    expect(texPeriod({ mes: '2026-02' }, TODAY)).toEqual({
      ok: true,
      from: '2026-02-01',
      to: '2026-02-28',
      month: '2026-02',
      label: 'Febrero 2026',
    })
  })

  it('un rango', () => {
    expect(texPeriod({ desde: '2026-10-01', hasta: '2026-10-15' }, TODAY)).toMatchObject({
      ok: true,
      from: '2026-10-01',
      to: '2026-10-15',
      month: null,
      label: '01/10 – 15/10/2026',
    })
  })

  it('con una sola punta completa la otra, como lo dice la gente', () => {
    // «desde el 15 de octubre»: hasta hoy.
    expect(texPeriod({ desde: '2026-10-15' }, TODAY)).toMatchObject({
      from: '2026-10-15',
      to: TODAY,
    })
    // «hasta el 20»: desde el 1 de ese mes.
    expect(texPeriod({ hasta: '2026-10-20' }, TODAY)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-20',
    })
    // Un «desde» futuro no da un rango al revés.
    expect(texPeriod({ desde: '2026-12-10' }, TODAY)).toMatchObject({
      from: '2026-12-10',
      to: '2026-12-10',
    })
  })

  it('lo que no existe vuelve con el mensaje de las pantallas', () => {
    expect(texPeriod({ mes: '2026-13' }, TODAY)).toEqual({
      ok: false,
      message: 'Ese mes no existe. Elegilo de nuevo.',
    })
    expect(texPeriod({ desde: '2026-02-30', hasta: '2026-03-10' }, TODAY)).toEqual({
      ok: false,
      message: 'Esa fecha no existe.',
    })
    expect(texPeriod({ desde: '2026-02-30' }, TODAY)).toEqual({
      ok: false,
      message: 'Esa fecha no existe.',
    })
    expect(texPeriod({ hasta: '2026-02-30' }, TODAY)).toEqual({
      ok: false,
      message: 'Esa fecha no existe.',
    })
    expect(texPeriod({ desde: '2026-10-15', hasta: '2026-10-01' }, TODAY)).toEqual({
      ok: false,
      message: 'El «hasta» no puede ser anterior al «desde».',
    })
    expect(texPeriod({ desde: '2024-01-01', hasta: '2026-01-01' }, TODAY)).toEqual({
      ok: false,
      message: 'El período puede tener hasta 400 días. Elegí uno más corto.',
    })
  })
})

describe('texMonth', () => {
  it('sin mes, el de hoy', () => {
    expect(texMonth(undefined, TODAY)).toEqual({ ok: true, month: '2026-11' })
  })

  it('un mes real', () => {
    expect(texMonth('2026-10', TODAY)).toEqual({ ok: true, month: '2026-10' })
  })

  it('un mes que no existe', () => {
    expect(texMonth('2026-13', TODAY)).toEqual({
      ok: false,
      message: 'Ese mes no existe. Elegilo de nuevo.',
    })
  })
})

describe('los textos', () => {
  it('saca los espacios duros de los textos de pantalla', () => {
    expect(plain('Pagaste $ 1.000')).toBe('Pagaste $ 1.000')
  })

  it('un importe solo si hay algo', () => {
    expect(moneyIf(150_000)).toBe('$ 1.500')
    expect(moneyIf(0)).toBeUndefined()
    expect(moneyIf(null)).toBeUndefined()
  })

  it('un saldo con su lado, sin menos', () => {
    expect(sideBalance(150_000)).toBe('$ 1.500 deudor')
    expect(sideBalance(-150_000)).toBe('$ 1.500 acreedor')
    expect(sideBalance(0)).toBe('$ 0')
  })

  it('una fila sin lo que no tiene dato, sin tocar el cero ni el false', () => {
    expect(compact({ a: null, b: undefined, c: 0, d: false, e: '' })).toEqual({
      c: 0,
      d: false,
      e: '',
    })
  })

  it('un texto corto', () => {
    expect(shortText(null)).toBeUndefined()
    expect(shortText('   ')).toBeUndefined()
    expect(shortText('  hola ')).toBe('hola')
    expect(shortText('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('las listas', () => {
  it('lo último primero, con el tope', () => {
    expect(newestFirst([1, 2, 3], 2)).toEqual({ filas: [3, 2], hay_mas: true })
    expect(newestFirst([1, 2], 2)).toEqual({ filas: [2, 1], hay_mas: false })
  })

  it('no toca la lista original', () => {
    const rows = [1, 2, 3]
    newestFirst(rows, 5)
    expect(rows).toEqual([1, 2, 3])
  })

  it('corta por cantidad', () => {
    expect(cappedBySize([1, 2, 3], 2, 1000)).toEqual({ filas: [1, 2], hay_mas: true })
    expect(cappedBySize([1, 2], 2, 1000)).toEqual({ filas: [1, 2], hay_mas: false })
  })

  it('corta por tamaño, con filas enteras', () => {
    const big = { text: 'x'.repeat(100) }
    expect(cappedBySize([big, big, big], 10, 250)).toEqual({ filas: [big, big], hay_mas: true })
  })

  it('la primera fila va siempre, aunque sola se pase', () => {
    const huge = { text: 'x'.repeat(1000) }
    expect(cappedBySize([huge, huge], 10, 100)).toEqual({ filas: [huge], hay_mas: true })
  })
})
