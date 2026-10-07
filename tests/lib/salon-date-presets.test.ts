import { describe, expect, it } from 'vitest'
import {
  cordobaDayStartUtc,
  detectPreset,
  eachIsoDayInclusive,
  formatDayLabel,
  isoDayInCordoba,
  isRealIsoDay,
  MAX_DENSE_DAYS,
  nextIsoDay,
  thisMonth,
  thisWeek,
  todayInCordoba,
} from '@/lib/salon/date-presets'

// Córdoba está en UTC-3 todo el año (Argentina no mueve el reloj), así que
// 03:00 UTC es la medianoche local: el instante justo donde el día calendario
// de Córdoba y el de UTC dejan de coincidir.

describe('todayInCordoba', () => {
  it('usa el calendario del bar, no el UTC', () => {
    // 2026-08-01T01:30Z todavía es 31/07 22:30 en Córdoba.
    expect(todayInCordoba(new Date('2026-08-01T01:30:00.000Z'))).toBe('2026-07-31')
    // 2026-08-01T03:00Z ya es 01/08 00:00 en Córdoba.
    expect(todayInCordoba(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-08-01')
  })
})

describe('thisWeek', () => {
  it('viernes → lunes a domingo de esa semana', () => {
    // Viernes 31/07/2026, 18:00 Córdoba.
    expect(thisWeek(new Date('2026-07-31T21:00:00.000Z'))).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('el lunes es el primer día (no lo tira a la semana anterior)', () => {
    // Lunes 27/07/2026, 09:00 Córdoba.
    const week = thisWeek(new Date('2026-07-27T12:00:00.000Z'))
    expect(week.from).toBe('2026-07-27')
    expect(week.to).toBe('2026-08-02')
  })

  it('el domingo cierra la semana que arrancó el lunes anterior', () => {
    // Domingo 02/08/2026, 23:00 Córdoba (02:00Z del lunes 03 en UTC).
    expect(thisWeek(new Date('2026-08-03T02:00:00.000Z'))).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('cruza el cambio de mes y de año sin romperse', () => {
    // Jueves 31/12/2026 → semana lunes 28/12 a domingo 03/01/2027.
    expect(thisWeek(new Date('2026-12-31T15:00:00.000Z'))).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })

  it('mira el día de Córdoba, no el de UTC', () => {
    // 2026-08-03T02:00Z: en UTC ya es lunes (semana nueva), en Córdoba sigue
    // siendo domingo 02/08 (semana vieja).
    expect(thisWeek(new Date('2026-08-03T02:00:00.000Z')).from).toBe('2026-07-27')
    // Una hora después ya arrancó la semana nueva en Córdoba.
    expect(thisWeek(new Date('2026-08-03T03:00:00.000Z')).from).toBe('2026-08-03')
  })
})

describe('thisMonth', () => {
  it('día 1 al último día de un mes de 31', () => {
    expect(thisMonth(new Date('2026-07-15T12:00:00.000Z'))).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('mes de 30 días', () => {
    expect(thisMonth(new Date('2026-04-10T12:00:00.000Z'))).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    })
  })

  it('febrero común y bisiesto', () => {
    expect(thisMonth(new Date('2026-02-10T12:00:00.000Z')).to).toBe('2026-02-28')
    expect(thisMonth(new Date('2028-02-10T12:00:00.000Z')).to).toBe('2028-02-29')
  })

  it('el 1ro a las 00:30 de Córdoba sigue en el mes nuevo', () => {
    // 2026-08-01T03:30Z = 00:30 del 01/08 en Córdoba.
    expect(thisMonth(new Date('2026-08-01T03:30:00.000Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })

  it('el último día a las 23:30 de Córdoba todavía es el mes viejo', () => {
    // 2026-08-01T02:30Z = 23:30 del 31/07 en Córdoba.
    expect(thisMonth(new Date('2026-08-01T02:30:00.000Z'))).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })
})

describe('detectPreset', () => {
  const NOW = new Date('2026-07-31T21:00:00.000Z') // viernes 31/07 18:00 Córdoba

  it('sin rango → modo día (today)', () => {
    expect(detectPreset(undefined, undefined, NOW)).toBe('today')
  })

  it('reconoce la semana y el mes en curso', () => {
    const week = thisWeek(NOW)
    expect(detectPreset(week.from, week.to, NOW)).toBe('week')
    const month = thisMonth(NOW)
    expect(detectPreset(month.from, month.to, NOW)).toBe('month')
  })

  it('cualquier otro par de fechas es rango libre', () => {
    expect(detectPreset('2026-07-01', '2026-07-15', NOW)).toBe('range')
    // Un solo extremo también cuenta como rango.
    expect(detectPreset('2026-07-01', undefined, NOW)).toBe('range')
  })
})

describe('formatDayLabel', () => {
  it('devuelve el día de semana abreviado y capitalizado + dd/MM', () => {
    expect(formatDayLabel('2026-07-31')).toBe('Vie 31/07')
    expect(formatDayLabel('2026-08-02')).toBe('Dom 02/08')
  })
})

describe('cordobaDayStartUtc', () => {
  it('las 00:00 de Córdoba son las 03:00 UTC', () => {
    expect(cordobaDayStartUtc('2026-09-08')).toBe('2026-09-08T03:00:00.000Z')
  })

  it('con nextIsoDay arma un rango medio abierto que no pierde el último milisegundo', () => {
    // Filtrar `created_at` con `.lte('…T23:59:59.999')` se comería una carga
    // hecha en el último instante del día.
    const desde = cordobaDayStartUtc('2026-09-08')
    const hasta = cordobaDayStartUtc(nextIsoDay('2026-09-08'))
    const alFilo = new Date('2026-09-09T02:59:59.999Z').toISOString()
    expect(alFilo >= desde && alFilo < hasta).toBe(true)
  })
})

describe('isoDayInCordoba', () => {
  it('las 21:00 de Córdoba pertenecen a ese día, no al siguiente en UTC', () => {
    // El Postgres del proyecto corre en UTC: a esta hora —el pico del bar— ya
    // pasó a ser el día siguiente allá.
    expect(isoDayInCordoba('2026-09-09T00:30:00Z')).toBe('2026-09-08')
    expect(isoDayInCordoba('2026-09-09T03:00:00Z')).toBe('2026-09-09')
  })
})

describe('isRealIsoDay', () => {
  it('acepta días que existen', () => {
    expect(isRealIsoDay('2026-09-08')).toBe(true)
    expect(isRealIsoDay('2028-02-29')).toBe(true)
  })

  it('rechaza los que tienen forma de fecha pero no existen', () => {
    // Todos pasan un /^\d{4}-\d{2}-\d{2}$/ y todos rompen en Postgres (22008).
    expect(isRealIsoDay('2026-02-30')).toBe(false)
    expect(isRealIsoDay('2026-13-01')).toBe(false)
    expect(isRealIsoDay('2026-00-10')).toBe(false)
    expect(isRealIsoDay('0000-01-01')).toBe(false)
    expect(isRealIsoDay('cualquiera')).toBe(false)
  })
})

describe('eachIsoDayInclusive', () => {
  it('devuelve el rango completo, inclusive en los dos bordes', () => {
    expect(eachIsoDayInclusive('2026-06-10', '2026-06-12')).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
    ])
  })

  it('un solo día devuelve un solo elemento', () => {
    expect(eachIsoDayInclusive('2026-09-05', '2026-09-05')).toEqual(['2026-09-05'])
  })

  it('cruza fin de mes y año bisiesto', () => {
    expect(eachIsoDayInclusive('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ])
  })

  it('un rango al revés no devuelve nada (y no cuelga)', () => {
    expect(eachIsoDayInclusive('2026-09-30', '2026-09-01')).toEqual([])
  })

  it('un rango absurdo se corta en el tope', () => {
    // El tope es una red contra un render colgado, NO un filtro de datos: quien
    // agregue sobre esta lista tiene que tolerar días fuera de ella (ver
    // `aggregateDepositsByDay`, que crea el bucket que falte).
    expect(eachIsoDayInclusive('2026-01-01', '2099-12-31')).toHaveLength(MAX_DENSE_DAYS)
  })
})
