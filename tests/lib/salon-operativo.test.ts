import { describe, expect, it } from 'vitest'
import {
  countByFilter,
  filterForBoard,
  matchesQuery,
  minutesUntil,
  nextAllowed,
  nightPulse,
  normalizeText,
  nowMarkerIndex,
  nowMinutesInCordoba,
  occupiedTables,
  relativeTimeLabel,
  reverseTarget,
  sortForBoard,
  splitTableLabel,
  timeToMinutes,
  toggleTableInLabel,
  urgencyOf,
} from '@/lib/salon/operativo'
import type { ReservationWithJoins } from '@/lib/salon/types'

function reservation(over: Partial<ReservationWithJoins> = {}): ReservationWithJoins {
  return {
    id: 'r1',
    tenant_id: 't',
    customer_id: null,
    guest_name: 'Adriana Carranza',
    guest_phone: null,
    guest_email: null,
    kind: 'normal',
    meal_type: 'dinner',
    reservation_date: '2026-09-05',
    reservation_time_local: '21:00:00',
    reservation_end_time_local: null,
    zone: 'planta_alta',
    scheduled_event_id: null,
    estimated_guests: 20,
    actual_guests: null,
    cake_count: 0,
    cake_option_id: null,
    champagne_count: 0,
    deposit_cents: 0,
    origin: 'whatsapp',
    primary_manager_id: 'm1',
    assistant_manager_id: null,
    comments: null,
    service_alerts: [],
    highlight_comment: false,
    table_label: null,
    status: 'pending',
    arrived_at: null,
    seated_at: null,
    closed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    arrived_by: null,
    seated_by: null,
    closed_by: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    primary_manager: { id: 'm1', display_name: 'Luz' },
    assistant_manager: null,
    scheduled_event: null,
    customer: null,
    cake_option: null,
    ...over,
  }
}

describe('tiempo', () => {
  it('timeToMinutes lee HH:MM y HH:MM:SS igual', () => {
    expect(timeToMinutes('21:30')).toBe(1290)
    expect(timeToMinutes('21:30:00')).toBe(1290)
    expect(timeToMinutes('00:05:00')).toBe(5)
  })

  it('nowMinutesInCordoba usa el reloj del bar, no el del server', () => {
    // 2026-09-05 14:30 UTC = 11:30 en Córdoba (UTC-3, sin horario de verano).
    expect(nowMinutesInCordoba(new Date('2026-09-05T14:30:00Z'))).toBe(11 * 60 + 30)
  })

  it('minutesUntil: después de medianoche la reserva de las 00:30 sigue siendo "en 40 min"', () => {
    const r = reservation({ reservation_time_local: '00:30:00' })
    expect(minutesUntil(r, 23 * 60 + 50)).toBe(40)
  })

  it('minutesUntil: una reserva de la merienda vista a la noche se pasó, no cruza el día', () => {
    const r = reservation({ reservation_time_local: '17:00:00' })
    expect(minutesUntil(r, 22 * 60)).toBe(-300)
  })

  it('relativeTimeLabel habla como la anfitriona', () => {
    expect(relativeTimeLabel(0)).toBe('ahora')
    expect(relativeTimeLabel(12)).toBe('en 12 min')
    expect(relativeTimeLabel(-25)).toBe('hace 25 min')
    expect(relativeTimeLabel(90)).toBe('en 1 h 30')
    expect(relativeTimeLabel(-120)).toBe('hace 2 h')
  })
})

describe('urgencyOf', () => {
  const now = 21 * 60 + 30 // 21:30

  it('los estados mandan antes que la hora', () => {
    expect(urgencyOf(reservation({ status: 'arrived' }), now)).toBe('inside')
    expect(urgencyOf(reservation({ status: 'seated' }), now)).toBe('inside')
    expect(urgencyOf(reservation({ status: 'closed' }), now)).toBe('done')
    expect(urgencyOf(reservation({ status: 'no_show' }), now)).toBe('done')
    expect(urgencyOf(reservation({ status: 'cancelled' }), now)).toBe('cancelled')
  })

  it('una pendiente recién se atrasa pasados los 15 minutos de gracia', () => {
    expect(urgencyOf(reservation({ reservation_time_local: '21:20:00' }), now)).toBe('soon')
    expect(urgencyOf(reservation({ reservation_time_local: '21:15:00' }), now)).toBe('soon')
    expect(urgencyOf(reservation({ reservation_time_local: '21:14:00' }), now)).toBe('late')
  })

  it('lo de la próxima hora es "soon", lo de más adelante "later"', () => {
    expect(urgencyOf(reservation({ reservation_time_local: '22:30:00' }), now)).toBe('soon')
    expect(urgencyOf(reservation({ reservation_time_local: '22:31:00' }), now)).toBe('later')
  })

  it('en otro día que hoy nada está atrasado', () => {
    expect(urgencyOf(reservation({ reservation_time_local: '13:00:00' }), null)).toBe('later')
  })
})

describe('matchesQuery', () => {
  it('consulta vacía trae todo', () => {
    expect(matchesQuery(reservation(), '')).toBe(true)
    expect(matchesQuery(reservation(), '   ')).toBe(true)
  })

  it('ignora tildes y mayúsculas en los dos sentidos', () => {
    const r = reservation({ guest_name: 'Sofía Ramírez' })
    expect(matchesQuery(r, 'sofia')).toBe(true)
    expect(matchesQuery(r, 'RAMÍREZ')).toBe(true)
    expect(matchesQuery(reservation({ guest_name: 'Garcia' }), 'García')).toBe(true)
  })

  it('las palabras pueden venir en cualquier orden y todas tienen que estar', () => {
    const r = reservation({ guest_name: 'Adriana Carranza' })
    expect(matchesQuery(r, 'carranza adri')).toBe(true)
    expect(matchesQuery(r, 'adri lopez')).toBe(false)
  })

  it('encuentra por el nombre de la ficha del socio aunque la reserva diga otra cosa', () => {
    const r = reservation({
      guest_name: 'Reserva oficina',
      customer: {
        id: 'c1',
        first_name: 'Tomás',
        last_name: 'Lucatelli',
        phone: '+5493515551234',
        service_alerts: [],
        points_balance: 0,
        tier: null,
      },
    })
    expect(matchesQuery(r, 'lucatelli')).toBe(true)
  })

  it('busca por dígitos del teléfono (con al menos 3) y por la mesa asignada', () => {
    const r = reservation({ guest_phone: '+5493515551234', table_label: '12+13' })
    expect(matchesQuery(r, '5551234')).toBe(true)
    expect(matchesQuery(r, '351 555')).toBe(true)
    expect(matchesQuery(r, '+54 9 351 555 1234')).toBe(true)
    expect(matchesQuery(r, '+54 9 351 555 9999')).toBe(false)
    expect(matchesQuery(r, '12')).toBe(true)
    expect(matchesQuery(r, 'mesa 13')).toBe(true)
    // Un dígito suelto no alcanza para un teléfono: sería ruido.
    expect(matchesQuery(reservation({ guest_phone: '+5493515551234' }), '5')).toBe(false)
  })

  it('busca por gestor', () => {
    expect(matchesQuery(reservation(), 'luz')).toBe(true)
  })
})

describe('sortForBoard / filterForBoard', () => {
  it('ordena por hora y nombre, NUNCA por estado: marcar "Llegó" no mueve la tarjeta', () => {
    const rows = [
      reservation({
        id: 'closed',
        reservation_time_local: '21:00:00',
        status: 'closed',
        guest_name: 'Beto',
      }),
      reservation({ id: 'late', reservation_time_local: '22:00:00' }),
      reservation({
        id: 'in',
        reservation_time_local: '21:00:00',
        status: 'arrived',
        guest_name: 'Carla',
      }),
      reservation({ id: 'wait-b', reservation_time_local: '21:00:00', guest_name: 'Zoe' }),
      reservation({ id: 'wait-a', reservation_time_local: '21:00:00', guest_name: 'Ana' }),
      reservation({ id: 'early', reservation_time_local: '13:30:00' }),
    ]
    expect(sortForBoard(rows).map((r) => r.id)).toEqual([
      'early',
      'wait-a',
      'closed',
      'in',
      'wait-b',
      'late',
    ])
  })

  it('con búsqueda activa el filtro de estado se ignora y la mesa exacta va primero', () => {
    const rows = [
      reservation({
        id: 'phone',
        guest_name: 'Pedro',
        guest_phone: '+5493511234567',
        status: 'closed',
      }),
      reservation({ id: 'mesa', guest_name: 'Ana', table_label: '123', status: 'arrived' }),
      reservation({ id: 'otro', guest_name: 'Zulma' }),
    ]
    const ids = filterForBoard(rows, { query: '123', filter: 'waiting' }).map((r) => r.id)
    expect(ids).toEqual(['mesa', 'phone'])
  })

  it('el que se llama así va antes que el que lo tiene en el medio', () => {
    const rows = [
      reservation({ id: 'medio', guest_name: 'Edgar Cía', reservation_time_local: '20:00:00' }),
      reservation({
        id: 'empieza',
        guest_name: 'García Pérez',
        reservation_time_local: '22:00:00',
      }),
    ]
    expect(filterForBoard(rows, { query: 'gar', filter: 'all' }).map((r) => r.id)).toEqual([
      'empieza',
      'medio',
    ])
  })

  it('dos reservas con el mismo nombre se distinguen por los últimos 4 dígitos', async () => {
    const { nameDisambiguation } = await import('@/lib/salon/operativo')
    const rows = [
      reservation({ id: 'a', guest_name: 'Juan García', guest_phone: '+5493511234567' }),
      reservation({ id: 'b', guest_name: 'juan garcia', guest_phone: '+5493519876543' }),
      reservation({ id: 'c', guest_name: 'Sola' }),
    ]
    const map = nameDisambiguation(rows)
    expect(map.get('a')).toBe('…4567')
    expect(map.get('b')).toBe('…6543')
    expect(map.has('c')).toBe(false)
  })

  it('las canceladas no aparecen: no hay nada que operar', () => {
    const rows = [reservation({ id: 'ok' }), reservation({ id: 'x', status: 'cancelled' })]
    expect(filterForBoard(rows, { query: '', filter: 'all' }).map((r) => r.id)).toEqual(['ok'])
  })

  it('los filtros cortan por estado operativo', () => {
    const rows = [
      reservation({ id: 'p' }),
      reservation({ id: 'a', status: 'arrived' }),
      reservation({ id: 's', status: 'seated' }),
      reservation({ id: 'c', status: 'closed' }),
      reservation({ id: 'n', status: 'no_show' }),
      reservation({ id: 'x', status: 'cancelled' }),
    ]
    const ids = (filter: 'all' | 'waiting' | 'inside' | 'done') =>
      filterForBoard(rows, { query: '', filter }).map((r) => r.id)
    expect(ids('waiting')).toEqual(['p'])
    expect(ids('inside')).toEqual(['a', 's'])
    expect(ids('done')).toEqual(['c', 'n'])
    expect(ids('all')).toEqual(['p', 'a', 's', 'c', 'n'])
    expect(countByFilter(rows)).toEqual({ all: 5, waiting: 1, inside: 2, done: 2 })
  })

  it('el marcador de "ahora" va antes de la primera reserva futura', () => {
    const rows = sortForBoard([
      reservation({ id: 'a', reservation_time_local: '20:00:00' }),
      reservation({ id: 'b', reservation_time_local: '21:00:00' }),
      reservation({ id: 'c', reservation_time_local: '22:00:00' }),
    ])
    expect(nowMarkerIndex(rows, 21 * 60 + 30)).toBe(2)
    expect(nowMarkerIndex(rows, 19 * 60)).toBe(0)
    expect(nowMarkerIndex(rows, 23 * 60)).toBe(3)
    expect(nowMarkerIndex(rows, null)).toBeNull()
    expect(nowMarkerIndex([], 21 * 60)).toBeNull()
  })
})

describe('nightPulse', () => {
  it('cuenta cubiertos comprometidos, adentro y los que faltan; el no-show va aparte', () => {
    const now = 22 * 60
    const rows = [
      reservation({ id: 'p1', estimated_guests: 10, reservation_time_local: '21:00:00' }), // atrasada
      reservation({ id: 'p2', estimated_guests: 6, reservation_time_local: '22:30:00' }),
      reservation({ id: 'a1', status: 'arrived', estimated_guests: 8, actual_guests: 9 }),
      reservation({ id: 'c1', status: 'closed', estimated_guests: 4 }),
      reservation({ id: 'n1', status: 'no_show', estimated_guests: 5 }),
      reservation({ id: 'x1', status: 'cancelled', estimated_guests: 50 }),
    ]
    const pulse = nightPulse(rows, now)
    expect(pulse.reservations).toBe(4)
    expect(pulse.covers).toBe(10 + 6 + 9 + 4)
    expect(pulse.waiting).toBe(2)
    expect(pulse.waitingCovers).toBe(16)
    expect(pulse.inside).toBe(1)
    expect(pulse.insideCovers).toBe(9)
    expect(pulse.closed).toBe(1)
    expect(pulse.closedCovers).toBe(4)
    expect(pulse.noShow).toBe(1)
    expect(pulse.noShowCovers).toBe(5)
    expect(pulse.late).toBe(1)
    expect(pulse.progress).toBeCloseTo(13 / 29)
  })

  it('sin reservas el progreso es 0, no NaN', () => {
    expect(nightPulse([], null).progress).toBe(0)
  })
})

describe('mesas', () => {
  it('splitTableLabel entiende mesas juntadas', () => {
    expect(splitTableLabel('12 + 13')).toEqual(['12', '13'])
    expect(splitTableLabel('Barra')).toEqual(['barra'])
    expect(splitTableLabel(null)).toEqual([])
  })

  it('occupiedTables solo mira a los que están adentro y saltea la reserva que se edita', () => {
    const rows = [
      reservation({ id: 'a', status: 'arrived', table_label: '12+13', guest_name: 'García' }),
      reservation({ id: 'b', status: 'pending', table_label: '4' }),
      reservation({ id: 'c', status: 'closed', table_label: '7' }),
      reservation({ id: 'd', status: 'seated', table_label: '20', guest_name: 'Vives' }),
    ]
    const occupied = occupiedTables(rows, 'd')
    expect([...occupied.keys()]).toEqual(['12', '13'])
    expect(occupied.get('12')).toBe('García')
  })

  it('toggleTableInLabel suma, saca y ordena numéricamente', () => {
    expect(toggleTableInLabel(null, '12')).toBe('12')
    expect(toggleTableInLabel('12', '3')).toBe('3+12')
    expect(toggleTableInLabel('3+12', '12')).toBe('3')
    expect(toggleTableInLabel('Barra', '2')).toBe('2+Barra')
    expect(toggleTableInLabel('12, 13', '13')).toBe('12')
  })
})

describe('máquina de estados de la UI', () => {
  it('desde "no vino" se puede volver a esperar o marcar que llegó igual', () => {
    expect(reverseTarget('no_show')).toBe('pending')
    expect(nextAllowed('no_show')).toEqual(['arrived'])
  })

  it('cancelada es terminal y pendiente no se revierte', () => {
    expect(reverseTarget('cancelled')).toBeNull()
    expect(reverseTarget('pending')).toBeNull()
    expect(nextAllowed('cancelled')).toEqual([])
  })

  it('normalizeText es idempotente', () => {
    expect(normalizeText(normalizeText('Ñandú Épico'))).toBe(normalizeText('Ñandú Épico'))
  })
})

describe('día de servicio', () => {
  it('hasta las 5 AM "hoy" sigue siendo la noche anterior', async () => {
    const { serviceDayInCordoba, boardClockMinutes, isAfterMidnightOf } = await import(
      '@/lib/salon/operativo'
    )
    // 04:30 Córdoba del domingo 6 = 07:30 UTC
    const dawn = new Date('2026-09-06T07:30:00Z')
    expect(serviceDayInCordoba(dawn)).toBe('2026-09-05')
    expect(isAfterMidnightOf('2026-09-05', dawn)).toBe(true)
    // El reloj del tablero sigue contando: 04:30 = 24 h + 4:30
    expect(boardClockMinutes('2026-09-05', dawn)).toBe(28 * 60 + 30)
    // A las 5:00 ya es domingo
    const morning = new Date('2026-09-06T08:00:00Z')
    expect(serviceDayInCordoba(morning)).toBe('2026-09-06')
    expect(boardClockMinutes('2026-09-05', morning)).toBeNull()
    expect(boardClockMinutes('2026-09-06', morning)).toBe(5 * 60)
  })

  it('una reserva de las 00:30 vista a la 1:00 de esa misma noche se pasó 30 min', async () => {
    const { minutesUntil, boardClockMinutes } = await import('@/lib/salon/operativo')
    const clock = boardClockMinutes('2026-09-05', new Date('2026-09-06T04:00:00Z')) // 01:00
    expect(clock).toBe(25 * 60)
    // 00:30 vale 24 h 30 en el reloj del servicio: con el reloj en 25 h, se pasó 30 min.
    expect(minutesUntil({ reservation_time_local: '00:30:00' }, clock ?? 0)).toBe(-30)
  })

  it('la reserva de las 00:30 va al final de la noche, no antes del desayuno', async () => {
    const { sortForBoard, serviceMinutes } = await import('@/lib/salon/operativo')
    expect(serviceMinutes('00:30:00')).toBe(24 * 60 + 30)
    expect(serviceMinutes('05:00:00')).toBe(5 * 60)
    const rows = sortForBoard([
      reservation({ id: 'trasnoche', reservation_time_local: '00:30:00' }),
      reservation({ id: 'cena', reservation_time_local: '21:00:00' }),
      reservation({ id: 'desayuno', reservation_time_local: '09:00:00' }),
    ])
    expect(rows.map((r) => r.id)).toEqual(['desayuno', 'cena', 'trasnoche'])
  })
})
