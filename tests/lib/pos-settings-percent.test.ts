// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NBSP } from '@/lib/money'
import { creditSurcharge } from '@/lib/pos/cash/bill'
import {
  formatPercent,
  percentFieldText,
  readPercent,
  SURCHARGE_MAX_BP,
} from '@/lib/pos/settings/percent'

/**
 * El recargo de crédito se escribe en por ciento y se guarda en puntos básicos (1000 = 10 %),
 * que es con lo que la base hace la cuenta.
 */

describe('readPercent', () => {
  it('lee enteros y decimales, con coma o con punto', () => {
    expect(readPercent('10')).toEqual({ kind: 'ok', bp: 1000 })
    expect(readPercent('12,5')).toEqual({ kind: 'ok', bp: 1250 })
    expect(readPercent('12.5')).toEqual({ kind: 'ok', bp: 1250 })
    expect(readPercent('7,25')).toEqual({ kind: 'ok', bp: 725 })
    expect(readPercent('0')).toEqual({ kind: 'ok', bp: 0 })
    expect(readPercent('0,05')).toEqual({ kind: 'ok', bp: 5 })
  })

  it('perdona el signo, los espacios y la coma al final', () => {
    expect(readPercent(' 10 % ')).toEqual({ kind: 'ok', bp: 1000 })
    expect(readPercent(`10${NBSP}%`)).toEqual({ kind: 'ok', bp: 1000 })
    expect(readPercent('10,')).toEqual({ kind: 'ok', bp: 1000 })
  })

  it('vacío no es cero', () => {
    expect(readPercent('')).toEqual({ kind: 'empty' })
    expect(readPercent('  % ')).toEqual({ kind: 'empty' })
  })

  it('no acepta letras, negativos ni más de dos decimales', () => {
    expect(readPercent('diez')).toEqual({ kind: 'invalid' })
    expect(readPercent('-5')).toEqual({ kind: 'invalid' })
    expect(readPercent('10,125')).toEqual({ kind: 'invalid' })
    expect(readPercent('1.000')).toEqual({ kind: 'invalid' })
    expect(readPercent('1e2')).toEqual({ kind: 'invalid' })
  })

  it('frena en el tope de la base: 50 %', () => {
    expect(readPercent('50')).toEqual({ kind: 'ok', bp: SURCHARGE_MAX_BP })
    expect(readPercent('50,01')).toEqual({ kind: 'too_high', maxBp: SURCHARGE_MAX_BP })
    expect(readPercent('100')).toEqual({ kind: 'too_high', maxBp: SURCHARGE_MAX_BP })
  })

  it('no se confunde con la coma flotante: 0,07 son 7 puntos, no 6,99', () => {
    expect(readPercent('0,07')).toEqual({ kind: 'ok', bp: 7 })
    expect(readPercent('8,7')).toEqual({ kind: 'ok', bp: 870 })
    expect(readPercent('19,99')).toEqual({ kind: 'ok', bp: 1999 })
  })
})

describe('percentFieldText y formatPercent', () => {
  it('sin ceros de más y con coma', () => {
    expect(percentFieldText(1000)).toBe('10')
    expect(percentFieldText(1250)).toBe('12,5')
    expect(percentFieldText(725)).toBe('7,25')
    expect(percentFieldText(5)).toBe('0,05')
    expect(percentFieldText(0)).toBe('0')
  })

  it('un dato roto se muestra como cero, no como «NaN»', () => {
    expect(percentFieldText(Number.NaN)).toBe('0')
    expect(percentFieldText(-300)).toBe('0')
  })

  it('con el signo y un espacio que no se corta', () => {
    expect(formatPercent(1000)).toBe(`10${NBSP}%`)
    expect(formatPercent(1250)).toBe(`12,5${NBSP}%`)
  })

  it('lo que se muestra se vuelve a leer igual', () => {
    for (const bp of [0, 5, 50, 100, 725, 1000, 1250, 1999, 5000]) {
      expect(readPercent(percentFieldText(bp)), String(bp)).toEqual({ kind: 'ok', bp })
      expect(readPercent(formatPercent(bp)), String(bp)).toEqual({ kind: 'ok', bp })
    }
  })
})

describe('el ejemplo de la pantalla usa la cuenta de la caja', () => {
  it('10 % sobre $ 20.000 son $ 2.000', () => {
    const read = readPercent('10')
    if (read.kind !== 'ok') throw new Error('tenía que leerse')
    expect(creditSurcharge(2_000_000, read.bp)).toBe(200_000)
  })
})
