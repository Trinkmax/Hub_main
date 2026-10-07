// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { centsToMoneyText, moneyBlurText, readMoneyText } from '@/components/ui/money-field'
import {
  checkNumberText,
  formatNumberText,
  numberSubmitValue,
  parseNumberText,
  stepNumberValue,
} from '@/components/ui/number-field'

/**
 * MoneyField y NumberField del kit (§3.2) como funciones puras: qué manda el
 * hidden en cada tecla, cómo queda el texto al salir del campo y qué error
 * dice. El parser de plata en sí (sin flotantes) lo prueban los tests de
 * lib/money; acá, lo que el campo hace con él.
 */

describe('MoneyField: lo que manda el hidden en cada tecla', () => {
  it('centavos canónicos, de cualquier forma que se escriba o se pegue', () => {
    for (const text of ['1.234,50', '1234,5', '1234.50', '1,234.50', '$ 1.234,50', ' 1.234,50 ']) {
      const state = readMoneyText(text)
      expect(state.cents, text).toBe(123450)
      expect(state.submitValue, text).toBe('123450')
      expect(state.error, text).toBeNull()
    }
    expect(readMoneyText('US$175,26').cents).toBe(17526)
    expect(readMoneyText('1.234.567').cents).toBe(123456700)
    expect(readMoneyText('1,234').cents).toBe(123400)
  })

  it('modo viejo: pesos con punto decimal', () => {
    expect(readMoneyText('1.234,5', { submit: 'pesos' }).submitValue).toBe('1234.50')
  })

  it('vacío: el hidden va vacío y no es un error (faltante no es cero)', () => {
    expect(readMoneyText('')).toEqual({
      parse: { ok: false, reason: 'vacio' },
      cents: null,
      submitValue: '',
      error: null,
    })
  })

  it('ilegible: el hidden va vacío y el mensaje repite lo que se escribió', () => {
    const state = readMoneyText('12,3,4')
    expect(state.submitValue).toBe('')
    expect(state.error).toBe('No entendemos «12,3,4». Escribilo como 1.234,50.')
  })

  it('negativo, decimales de más y fuera de rango', () => {
    expect(readMoneyText('-5').error).toBe('Tiene que ser un importe positivo.')
    expect(readMoneyText('-5', { allowNegative: true }).cents).toBe(-500)
    expect(readMoneyText('0,125').error).toBe('Usá hasta dos decimales.')
    // El $ va pegado a la cifra con un espacio duro (no se corta en dos renglones).
    expect(readMoneyText('2.000', { maxCents: 100_000 }).error).toBe(
      'Tiene que ser de hasta $\u00a01.000.',
    )
    expect(readMoneyText('5', { minCents: 1_000 }).error).toBe('Tiene que ser de $\u00a010 o más.')
  })

  it('un CUIT pegado por error no se lee como plata', () => {
    expect(readMoneyText('20-12345678-6').cents).toBeNull()
  })
})

describe('MoneyField: al salir del campo', () => {
  it('se reescribe prolijo si se lee', () => {
    expect(moneyBlurText('1234.5')).toBe('1.234,50')
    expect(moneyBlurText('1,234.50')).toBe('1.234,50')
    expect(moneyBlurText('$ 500000')).toBe('500.000,00')
  })

  it('con decimals «auto», entero si es redondo', () => {
    expect(moneyBlurText('500000', { decimals: 'auto' })).toBe('500.000')
    expect(moneyBlurText('500000,5', { decimals: 'auto' })).toBe('500.000,50')
  })

  it('lo ilegible queda tal cual (el error lo explica al lado)', () => {
    expect(moneyBlurText('12,3,4')).toBe('12,3,4')
    expect(moneyBlurText('')).toBe('')
  })

  it('el texto de arranque desde la base (centavos)', () => {
    expect(centsToMoneyText(123450)).toBe('1.234,50')
    expect(centsToMoneyText(123450n)).toBe('1.234,50')
    expect(centsToMoneyText(50_000_000, 'auto')).toBe('500.000')
    expect(centsToMoneyText(null)).toBe('')
    expect(centsToMoneyText(undefined)).toBe('')
  })

  it('ida y vuelta: lo que muestra se vuelve a leer igual', () => {
    for (const cents of [1, 99, 100, 123450, 100_000_000_000]) {
      expect(readMoneyText(centsToMoneyText(cents)).cents).toBe(cents)
    }
  })
})

describe('NumberField: lectura', () => {
  it('miles con punto y decimal con coma, como la plata', () => {
    expect(parseNumberText('12.500')).toEqual({ ok: true, value: 12500 })
    expect(parseNumberText('2,5', { decimals: 1 })).toEqual({ ok: true, value: 2.5 })
    expect(parseNumberText('4 personas')).toEqual({ ok: true, value: 4 })
  })

  it('decimales de más, negativos y letras en el medio', () => {
    expect(parseNumberText('2,5')).toEqual({ ok: false, reason: 'con-decimales' })
    expect(parseNumberText('2,55', { decimals: 1 })).toEqual({
      ok: false,
      reason: 'demasiados-decimales',
    })
    expect(parseNumberText('-3')).toEqual({ ok: false, reason: 'negativo' })
    expect(parseNumberText('-3', { min: -10 })).toEqual({ ok: true, value: -3 })
    expect(parseNumberText('1a2')).toEqual({ ok: false, reason: 'ilegible' })
    expect(parseNumberText('')).toEqual({ ok: false, reason: 'vacio' })
  })

  it('fuera de rango es un error con el borde: no se recorta en silencio', () => {
    expect(checkNumberText('45', { max: 40 })).toEqual({
      status: 'invalid',
      value: 45,
      error: 'El máximo es 40',
    })
    expect(checkNumberText('0', { min: 1 }).error).toBe('El mínimo es 1')
    expect(checkNumberText('12.500', { max: 10_000 }).error).toBe('El máximo es 10.000')
    expect(checkNumberText('2,5').error).toBe('Tiene que ser un número entero.')
    expect(checkNumberText('2,55', { decimals: 1 }).error).toBe('Usá hasta un decimal.')
    expect(checkNumberText('').status).toBe('empty')
  })
})

describe('NumberField: formato y hidden', () => {
  it('«12.500» al salir; con decimales, coma y solo los que hacen falta', () => {
    expect(formatNumberText(12500)).toBe('12.500')
    expect(formatNumberText(12500, { grouping: false })).toBe('12500')
    expect(formatNumberText(2.5, { decimals: 1 })).toBe('2,5')
    expect(formatNumberText(2, { decimals: 1 })).toBe('2')
    expect(formatNumberText(2.25, { decimals: 1 })).toBe('2,3')
  })

  it('el hidden lleva punto decimal, o vacío', () => {
    expect(numberSubmitValue(2.5, 1)).toBe('2.5')
    expect(numberSubmitValue(12500)).toBe('12500')
    expect(numberSubmitValue(null)).toBe('')
  })
})

describe('NumberField: flechas y botones', () => {
  it('suma y resta adentro de los bordes', () => {
    expect(stepNumberValue(4, 1, { min: 1, max: 40 })).toBe(5)
    expect(stepNumberValue(40, 1, { min: 1, max: 40 })).toBe(40)
    expect(stepNumberValue(1, -1, { min: 1, max: 40 })).toBe(1)
    expect(stepNumberValue(35, 10, { max: 40 })).toBe(40)
  })

  it('vacío arranca en el mínimo (o en 0): el primer toque pone un número', () => {
    expect(stepNumberValue(null, 1, { min: 1 })).toBe(1)
    expect(stepNumberValue(null, -1, { min: 1 })).toBe(1)
    expect(stepNumberValue(null, 1)).toBe(0)
  })

  it('con decimales no arrastra errores de coma flotante', () => {
    expect(stepNumberValue(0.1, 0.2, { decimals: 1 })).toBe(0.3)
    expect(stepNumberValue(2.5, 0.1, { decimals: 1 })).toBe(2.6)
  })

  it('fuera de rango, la flecha lo trae al borde', () => {
    expect(stepNumberValue(45, 1, { max: 40 })).toBe(40)
  })
})
