import { describe, expect, it } from 'vitest'
import {
  durationLabel,
  endsNextDay,
  hhmm,
  isImplausibleSpan,
  tableSpanMinutes,
  timeRangeLabel,
} from '@/lib/salon/format'

describe('hhmm', () => {
  it('recorta los segundos del time de Postgres', () => {
    expect(hhmm('21:30:00')).toBe('21:30')
  })

  it('deja pasar un HH:MM que ya viene corto', () => {
    expect(hhmm('21:30')).toBe('21:30')
  })
})

describe('timeRangeLabel', () => {
  it('sin hora de fin se ve exactamente como antes', () => {
    expect(timeRangeLabel('21:30:00', null)).toBe('21:30')
    expect(timeRangeLabel('21:30:00', undefined)).toBe('21:30')
  })

  it('con hora de fin arma el rango', () => {
    expect(timeRangeLabel('21:30:00', '23:45:00')).toBe('21:30 – 23:45')
  })

  it('el rango que cruza medianoche se arma igual (el aviso va aparte)', () => {
    expect(timeRangeLabel('21:30:00', '00:30:00')).toBe('21:30 – 00:30')
  })
})

describe('endsNextDay', () => {
  it('sin fin, no cruza nada', () => {
    expect(endsNextDay('21:30:00', null)).toBe(false)
  })

  it('fin posterior al inicio: misma noche', () => {
    expect(endsNextDay('21:30:00', '23:45:00')).toBe(false)
  })

  it('fin anterior al inicio: madrugada del día siguiente', () => {
    expect(endsNextDay('21:30:00', '00:30:00')).toBe(true)
    expect(endsNextDay('23:00:00', '02:00:00')).toBe(true)
  })

  it('fin igual al inicio también cuenta como día siguiente', () => {
    expect(endsNextDay('21:30:00', '21:30:00')).toBe(true)
  })

  it('un almuerzo normal no cruza', () => {
    expect(endsNextDay('12:30:00', '15:00:00')).toBe(false)
  })
})

describe('tableSpanMinutes', () => {
  it('sin fin no hay tramo', () => {
    expect(tableSpanMinutes('21:30:00', null)).toBeNull()
  })

  it('misma noche', () => {
    expect(tableSpanMinutes('21:30:00', '23:45:00')).toBe(135)
  })

  it('cruzando medianoche cuenta bien, sin números negativos', () => {
    expect(tableSpanMinutes('21:30:00', '00:30:00')).toBe(180)
    expect(tableSpanMinutes('23:00:00', '02:00:00')).toBe(180)
  })

  it('fin igual al inicio = 24 h (la señal más clara de un dedazo)', () => {
    expect(tableSpanMinutes('21:30:00', '21:30:00')).toBe(1440)
  })
})

describe('isImplausibleSpan', () => {
  it('una cena normal no dispara el aviso', () => {
    expect(isImplausibleSpan('21:30:00', '00:30:00')).toBe(false)
    expect(isImplausibleSpan('12:30:00', '15:00:00')).toBe(false)
  })

  it('el dedazo típico (quisieron 00:00 y pusieron 20:00) sí avisa', () => {
    // 22 h 30 de mesa: "termina al día siguiente" sería tranquilizador y falso.
    expect(isImplausibleSpan('21:30:00', '20:00:00')).toBe(true)
  })

  it('fin igual al inicio avisa', () => {
    expect(isImplausibleSpan('21:30:00', '21:30:00')).toBe(true)
  })

  it('sin fin nunca avisa', () => {
    expect(isImplausibleSpan('21:30:00', null)).toBe(false)
  })
})

describe('durationLabel', () => {
  it('menos de una hora', () => {
    expect(durationLabel(45)).toBe('45 min')
  })

  it('horas justas', () => {
    expect(durationLabel(120)).toBe('2h')
  })

  it('horas y minutos', () => {
    expect(durationLabel(150)).toBe('2h 30m')
  })
})
