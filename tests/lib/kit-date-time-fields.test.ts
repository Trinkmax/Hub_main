// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkDateText, DATE_FIELD_MESSAGES, maskDateTyping } from '@/lib/dates/date-field'
import { TIME_INPUT_MESSAGE } from '@/lib/dates/parse'
import {
  checkTimeText,
  maskTimeTyping,
  nearestSuggestionIndex,
  stepTimeValue,
  timeOrder,
  timeSuggestions,
} from '@/lib/dates/time-field'

/**
 * DatePicker y TimeField del kit (§3.2), sin el navegador: la máscara que pone
 * las barras y los dos puntos sola, cómo se completa «15/9», los mensajes con
 * mínimo y máximo, y las flechas de la hora (también de noche, cruzando la
 * medianoche).
 */

/** Tipea de a una letra, con el cursor al final, como lo haría la persona. */
function typeInto(mask: (next: string, previous: string) => string, keys: string): string {
  let text = ''
  for (const key of keys) text = mask(text + key, text)
  return text
}

const TODAY = '2026-10-06'

describe('máscara de la fecha', () => {
  it('las barras se insertan solas cuando llega el dígito que no entra', () => {
    expect(typeInto(maskDateTyping, '15')).toBe('15')
    expect(typeInto(maskDateTyping, '150')).toBe('15/0')
    expect(typeInto(maskDateTyping, '1509')).toBe('15/09')
    expect(typeInto(maskDateTyping, '15092026')).toBe('15/09/2026')
  })

  it('día de 4 a 9 y mes de 2 a 9 tienen una sola cifra', () => {
    expect(typeInto(maskDateTyping, '49')).toBe('4/9')
    expect(typeInto(maskDateTyping, '15/92026')).toBe('15/9/2026')
  })

  it('una barra a mano se respeta y una de más se ignora', () => {
    expect(typeInto(maskDateTyping, '1/9')).toBe('1/9')
    expect(typeInto(maskDateTyping, '15//')).toBe('15/')
    expect(typeInto(maskDateTyping, '/15')).toBe('15')
  })

  it('punto y coma valen como barra (el teclado decimal del celular trae coma)', () => {
    expect(typeInto(maskDateTyping, '15,9')).toBe('15/9')
    expect(typeInto(maskDateTyping, '15.9.26')).toBe('15/9/26')
  })

  it('pegar: los dígitos se ordenan; con guiones queda tal cual', () => {
    expect(maskDateTyping('15092026', '')).toBe('15/09/2026')
    expect(maskDateTyping('2026-09-15', '')).toBe('2026-09-15')
    expect(maskDateTyping('15-09-2026', '')).toBe('15-09-2026')
  })

  it('el año no pasa de 4 cifras', () => {
    expect(typeInto(maskDateTyping, '150920261')).toBe('15/09/2026')
  })

  it('borrar nunca se reescribe (si no, la barra volvería a aparecer)', () => {
    expect(maskDateTyping('15/', '15/0')).toBe('15/')
    expect(maskDateTyping('15', '15/')).toBe('15')
  })
})

describe('lectura de la fecha', () => {
  it('«15/9» completa el año de hoy en Córdoba y «15/9/26» da 2026', () => {
    expect(checkDateText('15/9', { today: TODAY })).toEqual({
      status: 'valid',
      iso: '2026-09-15',
      error: null,
    })
    expect(checkDateText('15/9/26', { today: TODAY }).iso).toBe('2026-09-15')
  })

  it('se aceptan 15-09-2026, 15.09.2026 y 2026-09-15 pegados', () => {
    for (const text of ['15-09-2026', '15.09.2026', '2026-09-15', '15/09/2026', '15092026']) {
      expect(checkDateText(text, { today: TODAY })).toMatchObject({
        status: 'valid',
        iso: '2026-09-15',
      })
    }
  })

  it('una barra colgando al final no cuenta: es alguien que dejó de tipear', () => {
    expect(checkDateText('15/9/', { today: TODAY }).iso).toBe('2026-09-15')
  })

  it('vacío no es un error (lo obligatorio lo dice required)', () => {
    expect(checkDateText('   ', { today: TODAY })).toEqual({
      status: 'empty',
      iso: null,
      error: null,
    })
    expect(DATE_FIELD_MESSAGES.required).toBe('Falta la fecha.')
  })

  it('31/02: «Esa fecha no existe»; lo ilegible pide el formato', () => {
    expect(checkDateText('31/02', { today: TODAY })).toEqual({
      status: 'invalid',
      iso: null,
      error: 'Esa fecha no existe',
    })
    expect(checkDateText('mañana', { today: TODAY }).error).toBe(
      'Escribí la fecha como dd/mm/aaaa.',
    )
  })

  it('antes del mínimo y después del máximo, con la fecha del borde', () => {
    const rules = { today: TODAY, min: '2026-09-01', max: '2026-09-30' }
    expect(checkDateText('31/08/2026', rules)).toEqual({
      status: 'invalid',
      iso: '2026-08-31',
      error: 'Tiene que ser desde el 01/09/2026',
    })
    expect(checkDateText('1/10/2026', rules).error).toBe('Tiene que ser hasta el 30/09/2026')
    expect(checkDateText('30/09/2026', rules).status).toBe('valid')
  })

  it('un día deshabilitado dice el motivo tal cual (o uno genérico)', () => {
    const closed = (iso: string) => iso.startsWith('2026-09')
    expect(
      checkDateText('15/9', {
        today: TODAY,
        isDateDisabled: closed,
        disabledReason: () => 'Septiembre está cerrado: la corrección va con un asiento de ajuste',
      }).error,
    ).toBe('Septiembre está cerrado: la corrección va con un asiento de ajuste')
    expect(checkDateText('15/9', { today: TODAY, isDateDisabled: closed }).error).toBe(
      'Ese día no se puede elegir.',
    )
  })
})

describe('máscara de la hora (24 h)', () => {
  it('los dos puntos llegan con el primer minuto, sin ambigüedad', () => {
    expect(typeInto(maskTimeTyping, '2130')).toBe('21:30')
    expect(typeInto(maskTimeTyping, '930')).toBe('9:30')
    expect(typeInto(maskTimeTyping, '0930')).toBe('09:30')
    expect(typeInto(maskTimeTyping, '245')).toBe('2:45')
  })

  it('una hora sola queda como está', () => {
    expect(typeInto(maskTimeTyping, '9')).toBe('9')
    expect(typeInto(maskTimeTyping, '21')).toBe('21')
  })

  it('los minutos no pasan de dos cifras; los dos puntos a mano se respetan', () => {
    expect(typeInto(maskTimeTyping, '21:305')).toBe('21:30')
    expect(typeInto(maskTimeTyping, '21:')).toBe('21:')
  })

  it('con punto o «h» no se toca (se lee al salir); borrar tampoco', () => {
    expect(maskTimeTyping('21.30', '21.3')).toBe('21.30')
    expect(maskTimeTyping('21h30', '21h3')).toBe('21h30')
    expect(maskTimeTyping('21:', '21:3')).toBe('21:')
  })
})

describe('lectura de la hora', () => {
  it('2130, 930, 9, 21.30 y 21h30 (la tabla del kit)', () => {
    expect(checkTimeText('2130').time).toBe('21:30')
    expect(checkTimeText('930').time).toBe('09:30')
    expect(checkTimeText('9').time).toBe('09:00')
    expect(checkTimeText('21.30').time).toBe('21:30')
    expect(checkTimeText('21h30').time).toBe('21:30')
    expect(checkTimeText('9:30').time).toBe('09:30')
  })

  it('los dos puntos colgando no cuentan; vacío no es error', () => {
    expect(checkTimeText('21:').time).toBe('21:00')
    expect(checkTimeText('').status).toBe('empty')
  })

  it('cualquier otra cosa: «Usá formato 24 h, por ejemplo 21:30»', () => {
    expect(TIME_INPUT_MESSAGE).toBe('Usá formato 24 h, por ejemplo 21:30')
    expect(checkTimeText('25:00')).toEqual({
      status: 'invalid',
      time: null,
      error: TIME_INPUT_MESSAGE,
    })
    expect(checkTimeText('nueve').error).toBe(TIME_INPUT_MESSAGE)
  })

  it('mínimo y máximo, también cruzando la medianoche', () => {
    expect(checkTimeText('18:00', { min: '19:00' }).error).toBe('Tiene que ser desde las 19:00')
    const night = { min: '19:00', max: '02:00', crossesMidnight: true }
    expect(checkTimeText('00:30', night).status).toBe('valid')
    expect(checkTimeText('23:45', night).status).toBe('valid')
    expect(checkTimeText('03:00', night).error).toBe('Tiene que ser hasta las 02:00')
    expect(checkTimeText('18:30', night).error).toBe('Tiene que ser desde las 19:00')
    expect(checkTimeText('01:30', { ...night, max: '01:00' }).error).toBe(
      'Tiene que ser hasta la 01:00',
    )
  })
})

describe('el orden de las horas de noche', () => {
  it('con servicio de noche, 00:30 va después de 23:45', () => {
    const night = { min: '19:00', crossesMidnight: true }
    expect(timeOrder('00:30', night) ?? 0).toBeGreaterThan(timeOrder('23:45', night) ?? 0)
    // Sin mínimo, el pivote es el cambio de día de servicio (5 AM).
    expect(timeOrder('04:30', { crossesMidnight: true })).toBe(4 * 60 + 30 + 24 * 60)
    expect(timeOrder('05:00', { crossesMidnight: true })).toBe(5 * 60)
    expect(timeOrder('00:30')).toBe(30)
    expect(timeOrder('xx')).toBeNull()
  })
})

describe('flechas de la hora', () => {
  it('↑ ↓ de a step, alineando a la grilla del paso', () => {
    expect(stepTimeValue('21:00', 1)).toBe('21:15')
    expect(stepTimeValue('21:00', -1)).toBe('20:45')
    expect(stepTimeValue('21:07', 1)).toBe('21:15')
    expect(stepTimeValue('21:07', -1)).toBe('21:00')
    expect(stepTimeValue('21:00', 1, { step: 30 })).toBe('21:30')
  })

  it('con Mayús, 60 minutos', () => {
    expect(stepTimeValue('21:30', 1, { delta: 60 })).toBe('22:30')
    expect(stepTimeValue('21:30', -1, { delta: 60 })).toBe('20:30')
  })

  it('sin bordes da la vuelta al reloj, como el nativo; vacío arranca en las puntas', () => {
    expect(stepTimeValue('23:45', 1)).toBe('00:00')
    expect(stepTimeValue('00:00', -1)).toBe('23:45')
    expect(stepTimeValue(null, 1)).toBe('00:00')
    expect(stepTimeValue(null, -1)).toBe('23:45')
  })

  it('con bordes no se pasa: de noche cruza la medianoche y frena en el máximo', () => {
    const night = { min: '19:00', max: '02:00', crossesMidnight: true }
    expect(stepTimeValue('23:45', 1, night)).toBe('00:00')
    expect(stepTimeValue('02:00', 1, night)).toBe('02:00')
    expect(stepTimeValue('19:00', -1, night)).toBe('19:00')
    expect(stepTimeValue(null, 1, night)).toBe('19:00')
    expect(stepTimeValue(null, -1, night)).toBe('02:00')
  })

  it('con solo mínimo (de día), el tope es el último paso del día', () => {
    expect(stepTimeValue('23:45', 1, { min: '10:00' })).toBe('23:45')
    expect(stepTimeValue('10:00', -1, { min: '10:00' })).toBe('10:00')
  })
})

describe('lista de horarios', () => {
  it('de min a max cada step', () => {
    expect(timeSuggestions({ min: '20:00', max: '21:00', step: 30 })).toEqual([
      '20:00',
      '20:30',
      '21:00',
    ])
  })

  it('de noche cruza la medianoche', () => {
    expect(
      timeSuggestions({ min: '23:00', max: '01:00', step: 60, crossesMidnight: true }),
    ).toEqual(['23:00', '00:00', '01:00'])
  })

  it('sin bordes, el día entero', () => {
    const all = timeSuggestions({ step: 60 })
    expect(all).toHaveLength(24)
    expect(all[0]).toBe('00:00')
    expect(all.at(-1)).toBe('23:00')
  })

  it('el más cercano para llevarlo a la vista: el igual o el siguiente', () => {
    const list = ['20:00', '20:30', '21:00']
    expect(nearestSuggestionIndex(list, '20:30')).toBe(1)
    expect(nearestSuggestionIndex(list, '20:10')).toBe(1)
    expect(nearestSuggestionIndex(list, '23:00')).toBe(2)
    expect(nearestSuggestionIndex(list, null)).toBe(-1)
  })
})
