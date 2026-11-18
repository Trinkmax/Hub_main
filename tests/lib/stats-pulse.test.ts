import { describe, expect, it } from 'vitest'
import { type PulseRow, pulseDelta, pulseSince, tallyPulse } from '@/lib/stats/pulse'

const TODAY = '2026-11-18'

const row = (
  reservation_date: string,
  status: string,
  estimated_guests: number,
  actual_guests: number | null = null,
): PulseRow => ({ reservation_date, status, estimated_guests, actual_guests })

describe('pulseSince: desde cuándo hay que leer', () => {
  it('dos ventanas completas que terminan hoy', () => {
    // 30 + 30 días contando hoy: el primero es hoy − 59.
    expect(pulseSince(TODAY, 30)).toBe('2026-09-20')
    expect(pulseSince(TODAY, 7)).toBe('2026-11-05')
  })
})

describe('tallyPulse: la gente que vino', () => {
  it('sin reservas: la ventana tiene todos sus días en cero y no hay asistencia', () => {
    const pulse = tallyPulse([], TODAY, 7)
    expect(pulse.days.map((d) => d.day)).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
    ])
    expect(pulse.days.every((d) => d.covers === 0 && d.arrived === 0)).toBe(true)
    expect(pulse.current).toEqual({
      arrived: 0,
      covers: 0,
      noShows: 0,
      unmarked: 0,
      attendance: null,
    })
    expect(pulse.previous.attendance).toBeNull()
  })

  it('cuenta a los que llegaron; si alguien contó, vale ese número', () => {
    const pulse = tallyPulse(
      [
        row('2026-11-17', 'arrived', 4),
        // Reservaron 6 y vinieron 5: valen los 5.
        row('2026-11-17', 'arrived', 6, 5),
        row('2026-11-18', 'arrived', 2),
      ],
      TODAY,
      7,
    )
    expect(pulse.current.arrived).toBe(3)
    expect(pulse.current.covers).toBe(11)
    expect(pulse.days.find((d) => d.day === '2026-11-17')).toEqual({
      day: '2026-11-17',
      arrived: 2,
      covers: 9,
    })
    expect(pulse.days.find((d) => d.day === '2026-11-18')?.covers).toBe(2)
  })

  it('las viejas «sentada» y «cerrada» también son gente que vino', () => {
    const pulse = tallyPulse(
      [row('2026-11-16', 'seated', 3), row('2026-11-16', 'closed', 4, 6)],
      TODAY,
      7,
    )
    expect(pulse.current.arrived).toBe(2)
    expect(pulse.current.covers).toBe(9)
  })

  it('una cancelada no cuenta para nada', () => {
    const pulse = tallyPulse([row('2026-11-17', 'cancelled', 10)], TODAY, 7)
    expect(pulse.current).toMatchObject({ arrived: 0, covers: 0, noShows: 0, unmarked: 0 })
    expect(pulse.current.attendance).toBeNull()
  })

  it('la asistencia sale de las marcadas: llegaron ÷ (llegaron + no vinieron)', () => {
    const pulse = tallyPulse(
      [
        row('2026-11-15', 'arrived', 2),
        row('2026-11-15', 'arrived', 2),
        row('2026-11-15', 'arrived', 2),
        row('2026-11-15', 'no_show', 4),
      ],
      TODAY,
      7,
    )
    expect(pulse.current.noShows).toBe(1)
    expect(pulse.current.attendance).toBe(0.75)
    // Los que no vinieron no suman gente.
    expect(pulse.current.covers).toBe(6)
  })

  it('una pendiente de un día que ya pasó es una reserva sin marcar; la de hoy todavía puede llegar', () => {
    const pulse = tallyPulse(
      [row('2026-11-16', 'pending', 4), row(TODAY, 'pending', 6), row('2026-11-16', 'arrived', 2)],
      TODAY,
      7,
    )
    expect(pulse.current.unmarked).toBe(1)
    // Sin marcar no entra en la asistencia ni en la gente.
    expect(pulse.current.attendance).toBe(1)
    expect(pulse.current.covers).toBe(2)
  })

  it('separa la ventana actual de la anterior y deja afuera lo más viejo y lo que viene', () => {
    const pulse = tallyPulse(
      [
        row('2026-11-12', 'arrived', 5), // primer día de la actual
        row('2026-11-11', 'arrived', 7), // último día de la anterior
        row('2026-11-05', 'arrived', 3), // primer día de la anterior
        row('2026-11-04', 'arrived', 100), // más viejo: afuera
        row('2026-11-19', 'arrived', 100), // mañana: afuera
      ],
      TODAY,
      7,
    )
    expect(pulse.current.covers).toBe(5)
    expect(pulse.previous.covers).toBe(10)
    expect(pulse.previous.arrived).toBe(2)
    // La ventana anterior no ensucia el día a día de la actual.
    expect(pulse.days.reduce((sum, d) => sum + d.covers, 0)).toBe(5)
  })

  it('una cantidad rota o negativa no resta gente', () => {
    const pulse = tallyPulse(
      [
        row('2026-11-17', 'arrived', -3),
        {
          reservation_date: '2026-11-17',
          status: 'arrived',
          estimated_guests: null,
          actual_guests: null,
        },
      ],
      TODAY,
      7,
    )
    expect(pulse.current.arrived).toBe(2)
    expect(pulse.current.covers).toBe(0)
  })
})

describe('pulseDelta: contra la ventana anterior', () => {
  it('porcentaje entero, para arriba y para abajo', () => {
    expect(pulseDelta(110, 100)).toBe(10)
    expect(pulseDelta(73, 100)).toBe(-27)
    expect(pulseDelta(100, 100)).toBe(0)
  })

  it('sin base no inventa un porcentaje', () => {
    expect(pulseDelta(50, 0)).toBeNull()
    expect(pulseDelta(0, 0)).toBe(0)
  })
})
