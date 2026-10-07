import { describe, expect, it } from 'vitest'
import {
  dayKey,
  formatDaySeparator,
  formatListTimestamp,
  formatRelativeDays,
} from '@/lib/bandeja/format'

// Sábado 18/07/2026 15:00 local como "ahora" fijo
const NOW = new Date(2026, 6, 18, 15, 0, 0)

function local(y: number, m: number, d: number, h = 12, min = 30): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

describe('formatListTimestamp', () => {
  it('hoy → HH:mm', () => {
    expect(formatListTimestamp(local(2026, 7, 18, 9, 5), NOW)).toBe('09:05')
  })

  it('ayer → "ayer"', () => {
    expect(formatListTimestamp(local(2026, 7, 17), NOW)).toBe('ayer')
  })

  it('esta semana → día de la semana en es', () => {
    // 15/07/2026 fue miércoles
    expect(formatListTimestamp(local(2026, 7, 15), NOW)).toBe('miércoles')
  })

  it('más viejo → dd/MM/yyyy', () => {
    expect(formatListTimestamp(local(2026, 6, 2), NOW)).toBe('02/06/2026')
  })

  it('vacío para null o inválido', () => {
    expect(formatListTimestamp(null, NOW)).toBe('')
    expect(formatListTimestamp('nope', NOW)).toBe('')
  })
})

describe('formatDaySeparator', () => {
  it('Hoy / Ayer', () => {
    expect(formatDaySeparator(local(2026, 7, 18), NOW)).toBe('Hoy')
    expect(formatDaySeparator(local(2026, 7, 17), NOW)).toBe('Ayer')
  })

  it('esta semana → día capitalizado', () => {
    expect(formatDaySeparator(local(2026, 7, 15), NOW)).toBe('Miércoles')
  })

  it('más viejo → fecha completa en es', () => {
    expect(formatDaySeparator(local(2026, 6, 2), NOW)).toBe('2 de junio de 2026')
  })
})

describe('dayKey', () => {
  it('agrupa por día calendario local', () => {
    expect(dayKey(local(2026, 7, 18, 0, 5))).toBe('2026-07-18')
    expect(dayKey(local(2026, 7, 18, 23, 55))).toBe('2026-07-18')
  })
})

describe('formatRelativeDays', () => {
  it('hoy / ayer / hace N días', () => {
    expect(formatRelativeDays(local(2026, 7, 18), NOW)).toBe('hoy')
    expect(formatRelativeDays(local(2026, 7, 17), NOW)).toBe('ayer')
    expect(formatRelativeDays(local(2026, 7, 6), NOW)).toBe('hace 12 días')
  })

  it('meses y años', () => {
    expect(formatRelativeDays(local(2026, 4, 18), NOW)).toBe('hace 3 meses')
    expect(formatRelativeDays(local(2024, 7, 10), NOW)).toBe('hace 2 años')
  })

  it('null para null o inválido', () => {
    expect(formatRelativeDays(null, NOW)).toBeNull()
    expect(formatRelativeDays('nope', NOW)).toBeNull()
  })
})
