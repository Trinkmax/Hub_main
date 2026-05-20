import { describe, expect, it } from 'vitest'
import { computePeakWindow } from '@/lib/salon/peak'

describe('computePeakWindow', () => {
  it('devuelve null sin reservas', () => {
    expect(computePeakWindow([])).toBeNull()
  })

  it('devuelve null si todas las reservas tienen guests inválidos', () => {
    expect(
      computePeakWindow([
        { time: '13:00', guests: 0 },
        { time: '14:00', guests: null },
      ]),
    ).toBeNull()
  })

  it('una sola reserva: pico = ella misma, ventana de 1h desde el inicio', () => {
    const result = computePeakWindow([{ time: '13:00', guests: 4 }])
    expect(result).toEqual({
      startMin: 13 * 60,
      endMin: 14 * 60,
      startHHMM: '13:00',
      endHHMM: '14:00',
      guests: 4,
    })
  })

  it('reservas solapadas suman simultáneamente (asume 1h30 de estadía)', () => {
    // 13:00 (10p) + 13:30 (8p). Ambas vivas en [13:30, 14:30] → pico = 18p en 13:30.
    const result = computePeakWindow([
      { time: '13:00', guests: 10 },
      { time: '13:30', guests: 8 },
    ])
    expect(result?.guests).toBe(18)
    expect(result?.startHHMM).toBe('13:30')
    expect(result?.endHHMM).toBe('14:30')
  })

  it('reservas no solapadas: pico = la más grande de las individuales', () => {
    // 12:00 (4p), 15:00 (6p), 18:00 (3p) — todas separadas por > 1h30.
    const result = computePeakWindow([
      { time: '12:00', guests: 4 },
      { time: '15:00', guests: 6 },
      { time: '18:00', guests: 3 },
    ])
    expect(result?.guests).toBe(6)
    expect(result?.startHHMM).toBe('15:00')
  })

  it('cierre exacto y apertura simultánea NO se cuentan como solapadas', () => {
    // 13:00 cierra a 14:30 (asume 1h30). 14:30 abre. NO deben sumar.
    const result = computePeakWindow([
      { time: '13:00', guests: 10 },
      { time: '14:30', guests: 8 },
    ])
    // Pico = 10 (primero), no 18.
    expect(result?.guests).toBe(10)
  })

  it('acepta formato HH:MM:SS', () => {
    const result = computePeakWindow([{ time: '21:30:00', guests: 6 }])
    expect(result?.startHHMM).toBe('21:30')
    expect(result?.guests).toBe(6)
  })

  it('actual_guests = null cae a 0 y se filtra', () => {
    const result = computePeakWindow([
      { time: '13:00', guests: null },
      { time: '13:00', guests: 4 },
    ])
    expect(result?.guests).toBe(4)
  })

  it('time inválido es ignorado, no rompe', () => {
    const result = computePeakWindow([
      { time: 'banana', guests: 5 },
      { time: '99:99', guests: 5 },
      { time: '20:00', guests: 3 },
    ])
    expect(result?.guests).toBe(3)
    expect(result?.startHHMM).toBe('20:00')
  })

  it('respeta windowMinutes custom', () => {
    const result = computePeakWindow([{ time: '13:00', guests: 5 }], 90, 30)
    expect(result?.endHHMM).toBe('13:30')
  })

  it('respeta assumedStayMinutes custom (estadía más larga genera más solape)', () => {
    // Con 60min default no solapan; con 180min sí.
    const short = computePeakWindow(
      [
        { time: '12:00', guests: 4 },
        { time: '14:00', guests: 6 },
      ],
      60,
    )
    expect(short?.guests).toBe(6)

    const long = computePeakWindow(
      [
        { time: '12:00', guests: 4 },
        { time: '14:00', guests: 6 },
      ],
      180,
    )
    expect(long?.guests).toBe(10)
    expect(long?.startHHMM).toBe('14:00')
  })

  it('pico en el último cambio de un día con muchas reservas escalonadas', () => {
    // Tres reservas de 8p cada 30min — pico en 14:00 con las tres simultáneas
    // (entre 14:00 y 14:30) = 24p.
    const result = computePeakWindow([
      { time: '13:00', guests: 8 },
      { time: '13:30', guests: 8 },
      { time: '14:00', guests: 8 },
    ])
    expect(result?.guests).toBe(24)
    expect(result?.startHHMM).toBe('14:00')
  })
})
