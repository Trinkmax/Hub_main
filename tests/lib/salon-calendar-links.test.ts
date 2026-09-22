import { describe, expect, it } from 'vitest'
import {
  calendarHref,
  editEventHref,
  editReservationHref,
  hrefWithoutZone,
  newReservationHref,
  reservasExportHref,
  reservasListHref,
  reservationBackLink,
  reservationSavedHref,
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

  it('?planta va después del mes (es de la vista, como el mes) y antes del día', () => {
    expect(calendarHref('hub', { month: '2026-09', zone: 'alta' })).toBe(
      '/hub/eventos/programados?month=2026-09&planta=alta',
    )
    expect(
      calendarHref('hub', { zone: 'sin', day: '2026-09-21', segment: 'dinner', focusId: U }),
    ).toBe(`/hub/eventos/programados?month=2026-09&planta=sin&day=2026-09-21&seg=dinner&res=${U}`)
    // Sin zona no aparece: «Todo» es la URL de siempre.
    expect(calendarHref('hub', { month: '2026-09', zone: undefined })).toBe(
      '/hub/eventos/programados?month=2026-09',
    )
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

  it('desde el calendario agrega ?volver=calendario al final', () => {
    expect(
      newReservationHref('hub', { date: '2026-09-10', segment: 'dinner', from: 'calendario' }),
    ).toBe('/hub/reservas/nuevo?date=2026-09-10&meal=dinner&volver=calendario')
    expect(newReservationHref('hub', { date: '2026-09-10', eventId: E, from: 'calendario' })).toBe(
      `/hub/reservas/nuevo?date=2026-09-10&event=${E}&volver=calendario`,
    )
    expect(newReservationHref('hub', { from: 'calendario' })).toBe(
      '/hub/reservas/nuevo?volver=calendario',
    )
  })
})

describe('editReservationHref', () => {
  it('la ficha pelada vuelve a la lista (sin param)', () => {
    expect(editReservationHref('hub', U)).toBe(`/hub/reservas/${U}`)
  })

  it('desde el calendario lleva ?volver=calendario', () => {
    expect(editReservationHref('hub', U, { from: 'calendario' })).toBe(
      `/hub/reservas/${U}?volver=calendario`,
    )
  })
})

// «Ver todo» con el día abierto desde el mes: al volver a la entrada de abajo
// (el mes con ?planta) se le saca el filtro con un replaceState.
describe('hrefWithoutZone', () => {
  it('saca ?planta y deja el resto en su orden', () => {
    expect(
      hrefWithoutZone('https://hub.app/hub/eventos/programados?month=2026-09&planta=alta'),
    ).toBe('/hub/eventos/programados?month=2026-09')
    expect(
      hrefWithoutZone(
        `/hub/eventos/programados?month=2026-09&planta=sin&day=2026-09-21&res=${U}#x`,
      ),
    ).toBe(`/hub/eventos/programados?month=2026-09&day=2026-09-21&res=${U}#x`)
  })

  it('solo con ?planta queda el calendario pelado', () => {
    expect(hrefWithoutZone('/hub/eventos/programados?planta=baja')).toBe('/hub/eventos/programados')
  })

  it('sin ?planta no hay nada que reemplazar', () => {
    expect(hrefWithoutZone('/hub/eventos/programados?month=2026-09')).toBeNull()
    expect(hrefWithoutZone('/hub/eventos/programados')).toBeNull()
  })
})

// El «Exportar» de la lista baja lo que se ve: con las fechas que la página ya
// validó. Con `?day=2026-09-10&from=hoy` la lista muestra el 10/09 y el link
// copiaba `from=hoy` (400); con `?from=2026-02-30` era un 500.
describe('reservasExportHref', () => {
  it('modo día: solo el día', () => {
    expect(reservasExportHref('hub', { day: '2026-09-10' })).toBe(
      '/api/reservas/export?slug=hub&day=2026-09-10',
    )
  })

  it('modo rango: from/to mandan y el día no viaja', () => {
    expect(
      reservasExportHref('hub', { day: '2026-09-10', from: '2026-09-01', to: '2026-09-30' }),
    ).toBe('/api/reservas/export?slug=hub&from=2026-09-01&to=2026-09-30')
    // Rango abierto: una fecha rota que la página descartó llega como undefined.
    expect(reservasExportHref('hub', { from: undefined, to: '2026-03-05' })).toBe(
      '/api/reservas/export?slug=hub&to=2026-03-05',
    )
  })

  it('una fecha descartada por la página no pone el export en modo rango', () => {
    // La página: from=hoy → undefined, day=2026-09-10.
    expect(reservasExportHref('hub', { day: '2026-09-10', from: undefined, to: undefined })).toBe(
      '/api/reservas/export?slug=hub&day=2026-09-10',
    )
  })

  it('los filtros van con los nombres de la lista, codificados', () => {
    expect(
      reservasExportHref('hub', {
        day: '2026-09-10',
        q: 'lópez & cía',
        status: 'confirmed',
        zone: 'planta_alta',
        mealType: 'dinner',
        managerId: U,
      }),
    ).toBe(
      `/api/reservas/export?slug=hub&day=2026-09-10&q=l%C3%B3pez%20%26%20c%C3%ADa&status=confirmed&zone=planta_alta&servicio=dinner&manager=${U}`,
    )
  })
})

describe('reservasListHref', () => {
  it('pelada, en un día y con la reserva nueva', () => {
    expect(reservasListHref('hub')).toBe('/hub/reservas')
    expect(reservasListHref('hub', { day: '2026-09-10' })).toBe('/hub/reservas?day=2026-09-10')
    expect(reservasListHref('hub', { day: '2026-09-10', nueva: U })).toBe(
      `/hub/reservas?day=2026-09-10&nueva=${U}`,
    )
  })
})

// Al guardar se vuelve a la pantalla desde la que se entró (decisión del
// dueño, 22/09): el calendario si el link traía ?volver=calendario, si no la
// lista, como antes de que el calendario fuera una puerta de las reservas.
describe('reservationSavedHref', () => {
  it('desde el calendario: el día abierto con la reserva resaltada (alta y edición)', () => {
    const expected = `/hub/eventos/programados?month=2026-09&day=2026-09-10&res=${U}`
    expect(
      reservationSavedHref('hub', {
        returnTo: 'calendario',
        mode: 'create',
        date: '2026-09-10',
        id: U,
      }),
    ).toBe(expected)
    expect(
      reservationSavedHref('hub', {
        returnTo: 'calendario',
        mode: 'edit',
        date: '2026-09-10',
        id: U,
      }),
    ).toBe(expected)
  })

  it('por defecto el alta vuelve a la lista en su día con ?nueva', () => {
    expect(
      reservationSavedHref('hub', {
        returnTo: 'reservas',
        mode: 'create',
        date: '2026-09-10',
        id: U,
      }),
    ).toBe(`/hub/reservas?day=2026-09-10&nueva=${U}`)
  })

  it('por defecto la edición vuelve a la lista en su día, sin ?nueva', () => {
    expect(
      reservationSavedHref('hub', {
        returnTo: 'reservas',
        mode: 'edit',
        date: '2026-09-10',
        id: U,
      }),
    ).toBe('/hub/reservas?day=2026-09-10')
  })

  it('un alta sin id (respuesta rara) igual cae en el día', () => {
    expect(
      reservationSavedHref('hub', { returnTo: 'reservas', mode: 'create', date: '2026-09-10' }),
    ).toBe('/hub/reservas?day=2026-09-10')
    expect(
      reservationSavedHref('hub', { returnTo: 'calendario', mode: 'create', date: '2026-09-10' }),
    ).toBe('/hub/eventos/programados?month=2026-09&day=2026-09-10')
  })
})

describe('reservationBackLink', () => {
  it('al calendario, en el servicio o con la fila resaltada', () => {
    expect(
      reservationBackLink('hub', { returnTo: 'calendario', date: '2026-09-10', segment: 'dinner' }),
    ).toEqual({
      href: '/hub/eventos/programados?month=2026-09&day=2026-09-10&seg=dinner',
      label: 'Volver al calendario',
    })
    expect(
      reservationBackLink('hub', { returnTo: 'calendario', date: '2026-09-10', focusId: U }),
    ).toEqual({
      href: `/hub/eventos/programados?month=2026-09&day=2026-09-10&res=${U}`,
      label: 'Volver al calendario',
    })
  })

  it('a la lista, parada en el día', () => {
    expect(
      reservationBackLink('hub', {
        returnTo: 'reservas',
        date: '2026-09-10',
        segment: 'dinner',
        focusId: U,
      }),
    ).toEqual({ href: '/hub/reservas?day=2026-09-10', label: 'Volver a reservas' })
  })
})

describe('editEventHref', () => {
  it('el editor del evento', () => {
    expect(editEventHref('hub', E)).toBe(`/hub/eventos/programados/${E}`)
  })
})
