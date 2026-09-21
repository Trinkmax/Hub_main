import { describe, expect, it } from 'vitest'
import {
  calendarHref,
  editEventHref,
  legacyReservasRedirect,
  newReservationHref,
} from '@/lib/salon/calendar-links'

const U = '0b7c9f2a-4e1d-4c3b-8a5f-6d2e1f0a9b87'
const E = '3f2b8c1e-5d4a-4b7e-9c61-0a2d4e6f8b10'

describe('calendarHref', () => {
  it('sin opciones, el calendario pelado', () => {
    expect(calendarHref('hub')).toBe('/hub/eventos/programados')
  })

  it('el mes sale del día si no viene', () => {
    expect(calendarHref('hub', { day: '2026-09-10' })).toBe(
      '/hub/eventos/programados?month=2026-09&day=2026-09-10',
    )
  })

  it('orden fijo: month, day, seg, res', () => {
    expect(
      calendarHref('hub', { month: '2026-09', day: '2026-10-01', segment: 'dinner', focusId: U }),
    ).toBe(`/hub/eventos/programados?month=2026-09&day=2026-10-01&seg=dinner&res=${U}`)
  })

  it('?day=hoy viaja tal cual y el buscador se codifica', () => {
    expect(calendarHref('hub', { day: 'hoy' })).toBe('/hub/eventos/programados?day=hoy')
    expect(calendarHref('hub', { month: '2026-09', search: 'lópez & cía' })).toBe(
      '/hub/eventos/programados?month=2026-09&buscar=l%C3%B3pez%20%26%20c%C3%ADa',
    )
  })
})

describe('newReservationHref', () => {
  it('servicio', () => {
    expect(newReservationHref('hub', { date: '2026-09-10', segment: 'tea_time' })).toBe(
      '/hub/reservas/nuevo?date=2026-09-10&meal=tea_time',
    )
  })

  it('dentro de un evento manda solo ?event', () => {
    expect(newReservationHref('hub', { date: '2026-09-10', eventId: E })).toBe(
      `/hub/reservas/nuevo?date=2026-09-10&event=${E}`,
    )
    expect(
      newReservationHref('hub', {
        date: '2026-09-10',
        eventId: E,
        segment: 'dinner',
        time: '22:00',
      }),
    ).toBe(`/hub/reservas/nuevo?date=2026-09-10&event=${E}`)
  })

  it('hora puntual, codificada', () => {
    expect(
      newReservationHref('hub', { date: '2026-09-10', segment: 'dinner', time: '22:15' }),
    ).toBe('/hub/reservas/nuevo?date=2026-09-10&meal=dinner&time=22%3A15')
  })

  it('sin opciones', () => {
    expect(newReservationHref('hub')).toBe('/hub/reservas/nuevo')
  })
})

describe('editEventHref', () => {
  it('el editor del evento', () => {
    expect(editEventHref('hub', E)).toBe(`/hub/eventos/programados/${E}`)
  })
})

describe('legacyReservasRedirect', () => {
  it('?day&nueva → el día abierto con la reserva resaltada', () => {
    expect(legacyReservasRedirect('hub', { day: '2026-09-10', nueva: U })).toBe(
      `/hub/eventos/programados?month=2026-09&day=2026-09-10&res=${U}`,
    )
  })

  it('?from&to → el mes de from', () => {
    expect(legacyReservasRedirect('hub', { from: '2026-09-01', to: '2026-09-30' })).toBe(
      '/hub/eventos/programados?month=2026-09',
    )
  })

  it('?q → el buscador del calendario', () => {
    expect(legacyReservasRedirect('hub', { q: 'lopez' })).toBe(
      '/hub/eventos/programados?buscar=lopez',
    )
  })

  it('basura y filtros que no existen en el calendario → calendario pelado', () => {
    expect(legacyReservasRedirect('hub', { day: 'basura', status: 'pending' })).toBe(
      '/hub/eventos/programados',
    )
    expect(
      legacyReservasRedirect('hub', {
        zone: 'planta_alta',
        manager: 'x',
        servicio: 'dinner',
        page: '2',
      }),
    ).toBe('/hub/eventos/programados')
    expect(legacyReservasRedirect('hub', { day: '2026-09-10', nueva: 'no-es-uuid' })).toBe(
      '/hub/eventos/programados?month=2026-09&day=2026-09-10',
    )
    expect(legacyReservasRedirect('hub', { day: '2026-02-30' })).toBe('/hub/eventos/programados')
  })

  it('params repetidos: vale el primero', () => {
    expect(legacyReservasRedirect('hub', { day: ['2026-09-10', '2026-09-11'] })).toBe(
      '/hub/eventos/programados?month=2026-09&day=2026-09-10',
    )
  })
})
