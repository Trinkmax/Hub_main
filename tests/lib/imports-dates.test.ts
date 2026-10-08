import { describe, expect, it } from 'vitest'
import {
  excelSerialTime,
  excelSerialToIsoDay,
  instantToCordobaDay,
  isSlashedDate,
  toIsoDay,
  toUtcInstant,
} from '@/lib/imports/dates'

describe('toIsoDay', () => {
  it('ISO (con o sin hora), d/m/aaaa, d/m/aa, d-m-aaaa, d.m.aaaa y AAAAMMDD', () => {
    expect(toIsoDay('2025-12-01')).toBe('2025-12-01')
    expect(toIsoDay('2025-1-5')).toBe('2025-01-05')
    expect(toIsoDay('2025-01-15T00:00:00')).toBe('2025-01-15')
    expect(toIsoDay('2026-10-05T23:40:00.000-04:00')).toBe('2026-10-05')
    expect(toIsoDay('1/12/2025')).toBe('2025-12-01')
    expect(toIsoDay('01/12/2025')).toBe('2025-12-01')
    expect(toIsoDay('8/1/26')).toBe('2026-01-08')
    expect(toIsoDay('20/08/26')).toBe('2026-08-20')
    expect(toIsoDay('01-12-2025')).toBe('2025-12-01')
    expect(toIsoDay('01.12.2025')).toBe('2025-12-01')
    expect(toIsoDay('20251201')).toBe('2025-12-01')
    expect(toIsoDay('2025/12/01')).toBe('2025-12-01')
    expect(toIsoDay('01/12/2025 13:45')).toBe('2025-12-01')
  })

  it('meses con nombre (castellano e inglés)', () => {
    expect(toIsoDay('01-dic-2025')).toBe('2025-12-01')
    expect(toIsoDay('5 Ene 26')).toBe('2026-01-05')
    expect(toIsoDay('01/Dec/2025')).toBe('2025-12-01')
    expect(toIsoDay('3-set-2025')).toBe('2025-09-03')
    expect(toIsoDay('3-xyz-2025')).toBeNull()
  })

  it('mdy si se pide', () => {
    expect(toIsoDay('12/01/2025', { order: 'mdy' })).toBe('2025-12-01')
  })

  it('días que no existen y basura dan null', () => {
    expect(toIsoDay('31/02/2025')).toBeNull()
    expect(toIsoDay('2025-13-01')).toBeNull()
    expect(toIsoDay('hola')).toBeNull()
    expect(toIsoDay('')).toBeNull()
    expect(toIsoDay(null)).toBeNull()
    expect(toIsoDay(true)).toBeNull()
  })

  it('un número es un serial de Excel', () => {
    expect(toIsoDay(46022)).toBe('2025-12-31')
    expect(toIsoDay(45992.75)).toBe('2025-12-01')
  })
})

describe('seriales de Excel', () => {
  it('sistema 1900 con el 29/02/1900 que no existió', () => {
    expect(excelSerialToIsoDay(1)).toBe('1900-01-01')
    expect(excelSerialToIsoDay(59)).toBe('1900-02-28')
    expect(excelSerialToIsoDay(60)).toBeNull()
    expect(excelSerialToIsoDay(61)).toBe('1900-03-01')
    expect(excelSerialToIsoDay(25569)).toBe('1970-01-01')
    expect(excelSerialToIsoDay(45992)).toBe('2025-12-01')
    // Se redondea al segundo como Excel: 8 µs antes de la medianoche ya es el día siguiente.
    expect(excelSerialToIsoDay(45992.9999999999)).toBe('2025-12-02')
    expect(excelSerialToIsoDay(45992.99998)).toBe('2025-12-01')
    expect(excelSerialToIsoDay(0)).toBeNull()
    expect(excelSerialToIsoDay(Number.NaN)).toBeNull()
  })

  it('sistema 1904 (Excel viejo de Mac)', () => {
    expect(excelSerialToIsoDay(0, true)).toBe('1904-01-01')
    expect(excelSerialToIsoDay(45992 - 1462, true)).toBe('2025-12-01')
  })

  it('la hora de la parte decimal', () => {
    expect(excelSerialTime(45992.5)).toBe('12:00:00')
    expect(excelSerialTime(45992.75)).toBe('18:00:00')
    expect(excelSerialTime(0.0000001)).toBe('00:00:00')
    expect(excelSerialTime(45992.9999999999)).toBe('00:00:00')
    expect(excelSerialTime(45992.99998)).toBe('23:59:58')
  })
})

describe('instantes de Mercado Pago', () => {
  it('lee el offset y pasa a Córdoba (UTC−3)', () => {
    expect(instantToCordobaDay('2026-10-05T23:40:00.000-03:00')).toBe('2026-10-05')
    // 23:40 en GMT-4 son las 00:40 del 6 en Córdoba.
    expect(instantToCordobaDay('2026-10-05T23:40:00.000-04:00')).toBe('2026-10-06')
    expect(instantToCordobaDay('2026-10-06T02:00:00Z')).toBe('2026-10-05')
  })

  it('con corte de día (día de servicio, 5 AM)', () => {
    expect(instantToCordobaDay('2026-10-06T02:30:00.000-03:00', 5)).toBe('2026-10-05')
    expect(instantToCordobaDay('2026-10-06T05:00:00.000-03:00', 5)).toBe('2026-10-06')
    expect(instantToCordobaDay('2026-10-06T02:30:00.000-03:00', 0)).toBe('2026-10-06')
  })

  it('sin zona es hora de Córdoba; un día solo vuelve igual; basura null', () => {
    expect(instantToCordobaDay('2026-10-06T01:00:00', 5)).toBe('2026-10-05')
    expect(instantToCordobaDay('2026-10-06')).toBe('2026-10-06')
    expect(instantToCordobaDay('mañana')).toBeNull()
    expect(instantToCordobaDay(45992)).toBeNull()
  })

  it('toUtcInstant', () => {
    expect(toUtcInstant('2026-10-04T23:30:00.000-04:00')).toBe('2026-10-05T03:30:00.000Z')
    expect(toUtcInstant('2026-10-04T23:30:00')).toBe('2026-10-05T02:30:00.000Z')
    expect(toUtcInstant('2026-10-04')).toBeNull()
    expect(toUtcInstant('x')).toBeNull()
  })
})

describe('isSlashedDate', () => {
  it('pista de un CSV pasado por Excel', () => {
    expect(isSlashedDate('1/12/2025')).toBe(true)
    expect(isSlashedDate('2025-12-01')).toBe(false)
    expect(isSlashedDate(45992)).toBe(false)
  })
})
