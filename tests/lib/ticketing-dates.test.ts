import { describe, expect, it } from 'vitest'
import {
  buildIcs,
  formatDayMonth,
  formatLongDate,
  formatShortDate,
  functionStartUtc,
  monthTitle,
  nowLocalIn,
  relativeDay,
  todayIn,
} from '@/lib/ticketing/dates'

describe('fechas de las funciones', () => {
  it('martes 1 de diciembre de 2026, sin correrse de día', () => {
    expect(formatShortDate('2026-12-01')).toBe('Mar 01 dic')
    expect(formatLongDate('2026-12-01')).toBe('martes 1 de diciembre')
    expect(formatDayMonth('2026-12-01')).toBe('01/12')
    expect(monthTitle('2026-12-01')).toBe('Diciembre 2026')
  })

  it('hoy y mañana', () => {
    expect(relativeDay('2026-12-01', '2026-12-01')).toBe('Hoy')
    expect(relativeDay('2026-12-02', '2026-12-01')).toBe('Mañana')
    expect(relativeDay('2027-01-01', '2026-12-31')).toBe('Mañana')
    expect(relativeDay('2026-12-05', '2026-12-01')).toBeNull()
  })

  it('el día del bar sale de Córdoba, no del reloj del server', () => {
    // 02:30 UTC del 2 de diciembre = 23:30 del 1 en Córdoba (UTC−3).
    const now = new Date('2026-12-02T02:30:00Z')
    expect(todayIn('America/Argentina/Cordoba', now)).toBe('2026-12-01')
    expect(nowLocalIn('America/Argentina/Cordoba', now)).toBe('2026-12-01 23:30')
  })

  it('las 21:00 de Córdoba son las 00:00 UTC del día siguiente', () => {
    expect(functionStartUtc('2026-12-01', '21:00:00').toISOString()).toBe(
      '2026-12-02T00:00:00.000Z',
    )
  })
})

describe('buildIcs', () => {
  it('arma un evento de tres horas en UTC', () => {
    const ics = buildIcs({
      uid: 'abc@hubbar',
      title: 'Shrek 2 · Cine y degustación',
      date: '2026-12-01',
      time: '21:00',
      location: 'Mariano Fragueiro 2151, Alta Córdoba',
      now: new Date('2026-10-26T15:00:00Z'),
    })
    expect(ics).toContain('DTSTART:20261202T000000Z')
    expect(ics).toContain('DTEND:20261202T030000Z')
    expect(ics).toContain('SUMMARY:Shrek 2 · Cine y degustación')
    // Las comas se escapan en ICS.
    expect(ics).toContain('LOCATION:Mariano Fragueiro 2151\\, Alta Córdoba')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
