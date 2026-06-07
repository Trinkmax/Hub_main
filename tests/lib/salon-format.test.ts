import { describe, expect, it } from 'vitest'
import { ARSFormat, elapsedLabel } from '@/lib/salon/format'

describe('ARSFormat', () => {
  it('convierte centavos a pesos ARS sin decimales', () => {
    // 150000 centavos = $1.500 ARS
    const result = ARSFormat(150000)
    expect(result).toContain('1.500')
  })

  it('redondea centavos fraccionarios', () => {
    // 100 centavos = $1 ARS
    const result = ARSFormat(100)
    expect(result).toContain('1')
  })

  it('devuelve cero formateado para 0', () => {
    const result = ARSFormat(0)
    expect(result).toContain('0')
  })
})

describe('elapsedLabel', () => {
  it('devuelve "X min" cuando han pasado menos de 60 minutos', () => {
    const openedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(elapsedLabel(openedAt)).toBe('5 min')
  })

  it('devuelve "Xh" cuando la hora es exacta sin minutos', () => {
    const openedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(elapsedLabel(openedAt)).toBe('2h')
  })

  it('devuelve "Xh Ym" cuando hay horas y minutos restantes', () => {
    const openedAt = new Date(Date.now() - (1 * 60 + 30) * 60 * 1000).toISOString()
    expect(elapsedLabel(openedAt)).toBe('1h 30m')
  })

  it('devuelve "0 min" para fechas futuras (nunca negativo)', () => {
    const openedAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    expect(elapsedLabel(openedAt)).toBe('0 min')
  })
})
