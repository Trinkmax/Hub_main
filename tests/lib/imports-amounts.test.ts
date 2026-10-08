import { describe, expect, it } from 'vitest'
import {
  convertCents,
  detectDecimalMark,
  parseAmount,
  parseAmountToCents,
  parseDecimal,
} from '@/lib/imports/amounts'

describe('parseAmount con el decimal del archivo', () => {
  it('coma decimal (Mis Comprobantes): sin miles, con miles y vacío', () => {
    expect(parseAmountToCents('33500,00', ',')).toBe(3_350_000)
    expect(parseAmountToCents('5814,05', ',')).toBe(581_405)
    expect(parseAmountToCents('1.234.567,89', ',')).toBe(123_456_789)
    expect(parseAmountToCents('0,00', ',')).toBe(0)
    expect(parseAmountToCents('1.234', ',')).toBe(123_400)
    expect(parseAmount('', ',')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmount('   ', ',')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmount(null, ',')).toEqual({ ok: false, reason: 'empty' })
  })

  it('punto decimal (Mercado Pago)', () => {
    expect(parseAmountToCents('225.96', '.')).toBe(22_596)
    expect(parseAmountToCents('-813360.45', '.')).toBe(-81_336_045)
    expect(parseAmountToCents('1,234.56', '.')).toBe(123_456)
    expect(parseAmountToCents('0.00', '.')).toBe(0)
  })

  it('un punto decimal en un archivo con coma es ambiguo (no se adivina)', () => {
    expect(parseAmount('1234.56', ',')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(parseAmount('12,34', '.')).toEqual({ ok: false, reason: 'ambiguous' })
  })

  it('negativos: adelante, al final (BNA), entre paréntesis (Excel) y con el símbolo', () => {
    expect(parseAmountToCents('-1.234,56', ',')).toBe(-123_456)
    expect(parseAmountToCents('12.239.301,29-', ',')).toBe(-1_223_930_129)
    expect(parseAmountToCents('(1.234,56)', ',')).toBe(-123_456)
    expect(parseAmountToCents('$ (1.234,56)', ',')).toBe(-123_456)
    expect(parseAmountToCents('$ -5', ',')).toBe(-500)
    expect(parseAmountToCents('−$ 5,10', ',')).toBe(-510)
    expect(parseAmountToCents('+5,10', ',')).toBe(510)
  })

  it('símbolos de moneda, espacios duros y la fórmula de texto de Excel', () => {
    expect(parseAmountToCents('$ 1.234,56', ',')).toBe(123_456)
    expect(parseAmountToCents('U$S 264,26', ',')).toBe(26_426)
    expect(parseAmountToCents('264,26 USD', ',')).toBe(26_426)
    expect(parseAmountToCents('ARS 1.000,00', ',')).toBe(100_000)
    expect(parseAmountToCents('1 234,56', ',')).toBe(123_456)
    expect(parseAmountToCents('="1234,50"', ',')).toBe(123_450)
  })

  it('rechaza la notación científica: es la marca de un CSV que pasó por Excel', () => {
    expect(parseAmount('7,54833E+13', ',')).toEqual({ ok: false, reason: 'scientific' })
    expect(parseAmount('1.5e3', 'auto')).toEqual({ ok: false, reason: 'scientific' })
  })

  it('texto entre los dígitos o un CUIT pegado no es plata', () => {
    expect(parseAmount('20-12345678-6', ',')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('12 abc', ',')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('1,2,3', ',')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('1.23,45', ',')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('más de dos decimales: redondea la mitad lejos del cero y avisa', () => {
    expect(parseAmount('1,005', ',')).toEqual({ ok: true, cents: 101, rounded: true })
    expect(parseAmount('-1,005', ',')).toEqual({ ok: true, cents: -101, rounded: true })
    expect(parseAmount('1,004', ',')).toEqual({ ok: true, cents: 100, rounded: true })
    expect(parseAmount('1,0000', ',')).toEqual({ ok: true, cents: 100, rounded: false })
  })

  it('tope de 1e15 centavos (los CHECK de acc_*)', () => {
    expect(parseAmount('99999999999999999,99', ',')).toEqual({ ok: false, reason: 'out_of_range' })
    expect(parseAmountToCents('9999999999999,99', ',')).toBe(999_999_999_999_999)
  })
})

describe('parseAmount en modo auto (un valor suelto de banco)', () => {
  it('con los dos signos manda el último', () => {
    expect(parseAmountToCents('1.234,56', 'auto')).toBe(123_456)
    expect(parseAmountToCents('1,234.56', 'auto')).toBe(123_456)
  })
  it('con uno solo: 1 o 2 dígitos atrás es decimal; 3 son miles', () => {
    expect(parseAmountToCents('12,5', 'auto')).toBe(1_250)
    expect(parseAmountToCents('12.50', 'auto')).toBe(1_250)
    expect(parseAmountToCents('1.234', 'auto')).toBe(123_400)
    expect(parseAmountToCents('1.234.567', 'auto')).toBe(123_456_700)
  })
  it('lo ambiguo se rechaza', () => {
    expect(parseAmount('1234.5678', 'auto')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(parseAmount('0,125', 'auto')).toEqual({ ok: false, reason: 'ambiguous' })
  })
})

describe('parseAmount con números de un XLSX', () => {
  it('usa la representación decimal más corta, no Math.round(v * 100)', () => {
    expect(parseAmountToCents(5814.05)).toBe(581_405)
    expect(parseAmountToCents(33500)).toBe(3_350_000)
    expect(parseAmountToCents(-0.015)).toBe(-2)
    // Math.round(1.005 * 100) da 100: el valor que muestra Excel es 1,01.
    expect(parseAmount(1.005)).toEqual({ ok: true, cents: 101, rounded: true })
    expect(parseAmountToCents(1e-7)).toBe(0)
  })
  it('no finitos o enormes', () => {
    expect(parseAmount(Number.NaN)).toEqual({ ok: false, reason: 'out_of_range' })
    expect(parseAmount(1e21)).toEqual({ ok: false, reason: 'out_of_range' })
    expect(parseAmount(true)).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('detectDecimalMark', () => {
  it('vota por columna o archivo', () => {
    expect(detectDecimalMark(['150.000,00', '900,00', '1.249.100,00'])).toBe(',')
    expect(detectDecimalMark(['66735.54', '-406.80', '0.00'])).toBe('.')
    expect(detectDecimalMark(['1.234', '15.000'])).toBe(',')
    expect(detectDecimalMark(['1,234', '15,000'])).toBe('.')
    expect(detectDecimalMark(['', null, 5, 'abc'])).toBeNull()
  })
})

describe('parseDecimal y convertCents (tipo de cambio)', () => {
  it('decimal exacto y canónico', () => {
    expect(parseDecimal('1475,006', ',')).toBe('1475.006')
    expect(parseDecimal('1,00', ',')).toBe('1')
    expect(parseDecimal('1465,0222', 'auto')).toBe('1465.0222')
    expect(parseDecimal('1438.43498', 'auto')).toBe('1438.43498')
    expect(parseDecimal(1438.43498)).toBe('1438.43498')
    expect(parseDecimal('0001,500', ',')).toBe('1.5')
    expect(parseDecimal('abc', ',')).toBeNull()
    expect(parseDecimal('1,4E+3', ',')).toBeNull()
  })

  it('centavos × tipo de cambio, redondeando la mitad lejos del cero', () => {
    expect(convertCents(26_426, '1465.0222')).toBe(38_714_677)
    expect(convertCents(100, '1')).toBe(100)
    expect(convertCents(1, '0.5')).toBe(1)
    expect(convertCents(-1, '0.5')).toBe(-1)
    expect(convertCents(64_137, '1475.006')).toBe(94_602_460)
    expect(() => convertCents(100, '1,5')).toThrow(RangeError)
  })
})
