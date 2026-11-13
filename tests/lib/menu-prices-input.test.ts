// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  formatPesosTyping,
  insertedDigits,
  MAX_PESOS_DIGITS,
  pesosDigits,
  pesosFieldText,
  pesosFromPaste,
  readPesosField,
} from '@/lib/menu/prices/input'

/**
 * El campo de precio: pesos enteros en la pantalla, centavos en la base. Los miles se separan
 * solos mientras se tipea y el cursor no salta.
 */

describe('pesosDigits', () => {
  it('se queda solo con los dígitos y saca los ceros de adelante', () => {
    expect(pesosDigits('12.500')).toBe('12500')
    expect(pesosDigits('$ 12.500')).toBe('12500')
    expect(pesosDigits('007')).toBe('7')
    expect(pesosDigits('0')).toBe('0')
    expect(pesosDigits('abc')).toBe('')
  })

  it('corta en el máximo de cifras', () => {
    expect(pesosDigits('1234567890123')).toHaveLength(MAX_PESOS_DIGITS)
  })
})

describe('insertedDigits', () => {
  /**
   * «Tocar un precio y tipear» lo reemplaza. Si el navegador no dejó todo seleccionado (pasa en
   * el iPhone, o al hacer clic sobre lo ya seleccionado), lo tipeado cae en el medio del precio
   * viejo: esto lo rescata.
   */
  it('encuentra lo tipeado cuando cayó adelante, en el medio o al final del precio viejo', () => {
    expect(insertedDigits('16.500', '116.500')).toBe('1')
    expect(insertedDigits('16.500', '16.5009')).toBe('9')
    expect(insertedDigits('16.500', '167.500')).toBe('7')
    expect(insertedDigits('16.500', '1.613.900.500')).toBe('13900')
  })

  it('con todo seleccionado lo tipeado ya reemplazó: no hay nada que rescatar', () => {
    expect(insertedDigits('16.500', '1')).toBeNull()
    expect(insertedDigits('16.500', '13.900')).toBeNull()
    expect(insertedDigits('5', '5')).toBeNull()
  })

  it('borrar, o tipear algo que no es un dígito, no cuenta como tipear un precio', () => {
    expect(insertedDigits('16.500', '16.50')).toBeNull()
    expect(insertedDigits('16.500', '16.500a')).toBeNull()
    expect(insertedDigits('16.500', '16,500')).toBeNull()
  })

  it('si lo que hay no es el precio viejo con algo agregado, no adivina', () => {
    expect(insertedDigits('16.500', '99.999.999')).toBeNull()
    expect(insertedDigits('16.500', '165.019')).toBeNull()
  })

  it('un campo vacío recibe lo tipeado tal cual', () => {
    expect(insertedDigits('', '5')).toBe('5')
  })

  it('con cifras repetidas igual separa lo tipeado', () => {
    // «5» → «55»: se tipeó un 5 (adelante o atrás, da lo mismo).
    expect(insertedDigits('5', '55')).toBe('5')
    // «1.000» → «10.000»: se tipeó un 0.
    expect(insertedDigits('1.000', '10.000')).toBe('0')
  })
})

describe('formatPesosTyping', () => {
  it('separa los miles mientras se tipea', () => {
    expect(formatPesosTyping('1', 1)).toEqual({ text: '1', caret: 1 })
    expect(formatPesosTyping('1250', 4)).toEqual({ text: '1.250', caret: 5 })
    expect(formatPesosTyping('1.2500', 6)).toEqual({ text: '12.500', caret: 6 })
    expect(formatPesosTyping('12.5000', 7)).toEqual({ text: '125.000', caret: 7 })
    expect(formatPesosTyping('1250000', 7)).toEqual({ text: '1.250.000', caret: 9 })
  })

  it('el cursor se queda después de los mismos dígitos cuando se tipea en el medio', () => {
    // «12.500» con el cursor después del 1, se tipea un 9: «192.500», cursor después del 9.
    expect(formatPesosTyping('192.500', 2)).toEqual({ text: '192.500', caret: 2 })
    // «1.250» y se tipea un 3 después del 1: «13.250», cursor después del 3.
    expect(formatPesosTyping('13.250', 2)).toEqual({ text: '13.250', caret: 2 })
    // Se borra el primer dígito de «12.500» → «2.500», cursor al principio.
    expect(formatPesosTyping('2.500', 0)).toEqual({ text: '2.500', caret: 0 })
  })

  it('borrar un punto no cambia el número: el cursor queda antes del punto', () => {
    // «12.500» → se borra el punto → llega «12500» con el cursor en 2.
    expect(formatPesosTyping('12500', 2)).toEqual({ text: '12.500', caret: 2 })
  })

  it('ignora lo que no es un dígito (coma, letras, signo)', () => {
    expect(formatPesosTyping('12,5', 4)).toEqual({ text: '125', caret: 3 })
    expect(formatPesosTyping('$12a', 4)).toEqual({ text: '12', caret: 2 })
  })

  it('los ceros de adelante se van sin correr el cursor de lugar', () => {
    expect(formatPesosTyping('05', 2)).toEqual({ text: '5', caret: 1 })
    expect(formatPesosTyping('05', 1)).toEqual({ text: '5', caret: 0 })
    expect(formatPesosTyping('0', 1)).toEqual({ text: '0', caret: 1 })
  })

  it('sin cursor (un pegado, un valor que llega de afuera) lo deja al final', () => {
    expect(formatPesosTyping('12500', null)).toEqual({ text: '12.500', caret: 6 })
    expect(formatPesosTyping('', null)).toEqual({ text: '', caret: 0 })
  })
})

describe('pesosFieldText', () => {
  it('muestra pesos enteros con los miles separados', () => {
    expect(pesosFieldText(1_250_000)).toBe('12.500')
    expect(pesosFieldText(150_000)).toBe('1.500')
    expect(pesosFieldText(0)).toBe('0')
    expect(pesosFieldText(8_000_000)).toBe('80.000')
  })

  it('si la base tiene centavos, redondea al peso (la mitad, para arriba)', () => {
    expect(pesosFieldText(123_449)).toBe('1.234')
    expect(pesosFieldText(123_450)).toBe('1.235')
  })

  it('sin dato queda vacío, nunca «0»', () => {
    expect(pesosFieldText(null)).toBe('')
    expect(pesosFieldText(undefined)).toBe('')
    expect(pesosFieldText(Number.NaN)).toBe('')
  })
})

describe('readPesosField', () => {
  it('lee pesos y devuelve centavos', () => {
    expect(readPesosField('12.500')).toEqual({ kind: 'value', cents: 1_250_000 })
    expect(readPesosField('1500')).toEqual({ kind: 'value', cents: 150_000 })
    expect(readPesosField('0')).toEqual({ kind: 'value', cents: 0 })
  })

  it('vacío no es cero', () => {
    expect(readPesosField('')).toEqual({ kind: 'empty' })
    expect(readPesosField('  ')).toEqual({ kind: 'empty' })
    expect(readPesosField('$')).toEqual({ kind: 'empty' })
  })

  it('lo que muestra el campo se vuelve a leer igual', () => {
    for (const cents of [0, 100, 150_000, 1_250_000, 99_999_999_900]) {
      expect(readPesosField(pesosFieldText(cents))).toEqual({ kind: 'value', cents })
    }
  })
})

describe('pesosFromPaste', () => {
  it('lee lo que se pega de una planilla o de un mensaje', () => {
    expect(pesosFromPaste('$ 12.500')).toBe('12.500')
    expect(pesosFromPaste('12500')).toBe('12.500')
    expect(pesosFromPaste('12,500.00')).toBe('12.500')
  })

  it('los centavos no se vuelven pesos: «12.500,50» es doce mil quinientos uno', () => {
    expect(pesosFromPaste('12.500,50')).toBe('12.501')
    expect(pesosFromPaste('12.500,49')).toBe('12.500')
  })

  it('lo que no se entiende o no entra, no se pega', () => {
    expect(pesosFromPaste('hola')).toBeNull()
    expect(pesosFromPaste('')).toBeNull()
    expect(pesosFromPaste('-500')).toBeNull()
    expect(pesosFromPaste('12.345.678.901')).toBeNull()
  })
})
