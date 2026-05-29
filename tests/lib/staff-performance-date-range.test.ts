import { describe, expect, it } from 'vitest'
import {
  dayInTz,
  labelForPreset,
  parsePreset,
  resolveDateRange,
  toIsoBounds,
} from '@/lib/staff-performance/date-range'

// Fixed "now": jueves 15 de mayo 2026, 14:00 hora Córdoba = 17:00 UTC.
const NOW = new Date('2026-05-15T17:00:00.000Z')

describe('resolveDateRange', () => {
  it('today: from y to son el mismo día calendario en Córdoba', () => {
    const r = resolveDateRange({ preset: 'today' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-15')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('last7: from = hoy - 6, to = hoy', () => {
    const r = resolveDateRange({ preset: 'last7' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-09')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('last30: from = hoy - 29, to = hoy', () => {
    const r = resolveDateRange({ preset: 'last30' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-04-16')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('this_month: día 1 del mes corriente hasta hoy', () => {
    const r = resolveDateRange({ preset: 'this_month' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-01')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('last_month: día 1 al último día del mes anterior', () => {
    const r = resolveDateRange({ preset: 'last_month' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-04-01')
    expect(dayInTz(r.to)).toBe('2026-04-30')
  })

  it('custom: respeta from/to recibidos normalizados a inicio/fin de día Córdoba', () => {
    const from = new Date('2026-03-10T15:00:00.000Z')
    const to = new Date('2026-03-12T10:00:00.000Z')
    const r = resolveDateRange({ preset: 'custom', from, to }, NOW)
    expect(dayInTz(r.from)).toBe('2026-03-10')
    expect(dayInTz(r.to)).toBe('2026-03-12')
  })
})

describe('parsePreset', () => {
  it('acepta presets válidos', () => {
    expect(parsePreset('today')).toBe('today')
    expect(parsePreset('last7')).toBe('last7')
    expect(parsePreset('last_month')).toBe('last_month')
  })

  it('rechaza valores no válidos', () => {
    expect(parsePreset('mañana')).toBeNull()
    expect(parsePreset('')).toBeNull()
    expect(parsePreset(null)).toBeNull()
    expect(parsePreset(undefined)).toBeNull()
  })
})

describe('labelForPreset', () => {
  it('todas las labels en español', () => {
    expect(labelForPreset('today')).toBe('Hoy')
    expect(labelForPreset('last7')).toBe('Últimos 7 días')
    expect(labelForPreset('last30')).toBe('Últimos 30 días')
    expect(labelForPreset('this_month')).toBe('Mes actual')
    expect(labelForPreset('last_month')).toBe('Mes anterior')
    expect(labelForPreset('custom')).toBe('Personalizado')
  })
})

describe('toIsoBounds', () => {
  it('serializa a ISO strings', () => {
    const r = resolveDateRange({ preset: 'today' }, NOW)
    const { fromIso, toIso } = toIsoBounds(r)
    expect(fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(toIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
