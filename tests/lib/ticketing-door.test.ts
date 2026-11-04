import { describe, expect, it } from 'vitest'
import {
  admitLanded,
  type DoorTicket,
  doorBalanceCents,
  doorTicketSchema,
  doorVerdict,
  formatShortCode,
  guestsInside,
  parseDoorToken,
} from '@/lib/ticketing/door'

type Reservation = NonNullable<DoorTicket['reservation']>

function reservation(over: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-1',
    status: 'pending',
    date: '2026-12-01',
    time: '21:00',
    estimated_guests: 2,
    actual_guests: null,
    arrived_at_label: null,
    arrived_by_name: null,
    ...over,
  }
}

function ticket(over: Partial<DoorTicket> = {}): DoorTicket {
  return {
    order_id: 'ord-1',
    short_code: 'AB7F3E12',
    status: 'approved',
    title: 'Shrek 2',
    poster_url: null,
    accent_hex: '#4f7a2e',
    guest_name: 'Ana Pérez',
    party_size: 2,
    payment_option: 'deposit',
    unit_price_cents: 2_000_000,
    full_price_cents: 4_500_000,
    paid_cents: 4_000_000,
    balance_cash_only: false,
    event_date: '2026-12-01',
    event_time: '21:00',
    service_day: '2026-12-01',
    reservation: reservation(),
    room: { inside: 18, expected: 46 },
    ...over,
  }
}

describe('qué hacer con una entrada en la puerta', () => {
  it('pagada, de hoy y sin entrar: pasan todos', () => {
    expect(doorVerdict(ticket())).toEqual({ kind: 'admit', left: 2, inside: 0, total: 2 })
  })

  it('un grupo que llega de a partes: cuenta los que faltan', () => {
    const t = ticket({
      party_size: 4,
      reservation: reservation({
        status: 'arrived',
        estimated_guests: 4,
        actual_guests: 2,
        arrived_at_label: '20:50',
      }),
    })
    expect(doorVerdict(t)).toEqual({ kind: 'admit', left: 2, inside: 2, total: 4 })
  })

  it('ya entraron todos: avisa cuándo y quién, para detectar una captura compartida', () => {
    const t = ticket({
      reservation: reservation({
        status: 'arrived',
        actual_guests: 2,
        arrived_at_label: '20:50',
        arrived_by_name: 'Luz',
      }),
    })
    expect(doorVerdict(t)).toEqual({
      kind: 'used',
      total: 2,
      at: '20:50',
      by: 'Luz',
    })
  })

  it('marcada «Llegó» a mano sin contar: cuentan todos, sale como usada', () => {
    const t = ticket({ reservation: reservation({ status: 'seated', actual_guests: null }) })
    expect(doorVerdict(t).kind).toBe('used')
  })

  it('«no vino» y después aparece: pasa (el estado es reversible)', () => {
    const t = ticket({ reservation: reservation({ status: 'no_show' }) })
    expect(doorVerdict(t).kind).toBe('admit')
  })

  it('si agrandaron la reserva a mano, el cupo de la puerta sigue a la reserva', () => {
    const t = ticket({ party_size: 2, reservation: reservation({ estimated_guests: 3 }) })
    expect(doorVerdict(t)).toEqual({ kind: 'admit', left: 3, inside: 0, total: 3 })
  })

  it('otro día: distingue si falta o si ya pasó', () => {
    const future = ticket({ reservation: reservation({ date: '2026-12-15' }) })
    expect(doorVerdict(future)).toEqual({
      kind: 'other_day',
      when: 'future',
      date: '2026-12-15',
      time: '21:00',
    })
    const past = ticket({ reservation: reservation({ date: '2026-11-15' }) })
    expect(doorVerdict(past)).toMatchObject({ kind: 'other_day', when: 'past' })
  })

  it('si movieron el evento, vale la fecha de la reserva y no la foto del pedido', () => {
    const t = ticket({ event_date: '2026-11-20', reservation: reservation({ date: '2026-12-01' }) })
    expect(doorVerdict(t).kind).toBe('admit')
  })

  it('ya entraron gana sobre la fecha: al otro día dice «ya entraron», no «ya pasó»', () => {
    const t = ticket({
      service_day: '2026-12-02',
      reservation: reservation({ status: 'closed', actual_guests: 2 }),
    })
    expect(doorVerdict(t).kind).toBe('used')
  })

  it('no paga: pendiente o rechazada', () => {
    expect(doorVerdict(ticket({ status: 'pending' })).kind).toBe('not_paid')
    expect(doorVerdict(ticket({ status: 'rejected' })).kind).toBe('not_paid')
  })

  it('devuelta: gana aunque la reserva siga en pie', () => {
    expect(doorVerdict(ticket({ status: 'refunded' })).kind).toBe('refunded')
  })

  it('reserva cancelada', () => {
    const t = ticket({ reservation: reservation({ status: 'cancelled' }) })
    expect(doorVerdict(t).kind).toBe('cancelled')
  })

  it('pagó pero no quedó reserva', () => {
    expect(doorVerdict(ticket({ reservation: null })).kind).toBe('no_reservation')
  })
})

describe('guestsInside', () => {
  it('pendiente o «no vino» son cero aunque tengan un número cargado', () => {
    expect(guestsInside(reservation({ actual_guests: 2 }))).toBe(0)
    expect(guestsInside(reservation({ status: 'no_show', actual_guests: 2 }))).toBe(0)
  })
  it('adentro: los contados, o todos si nadie contó', () => {
    expect(guestsInside(reservation({ status: 'arrived', actual_guests: 1 }))).toBe(1)
    expect(guestsInside(reservation({ status: 'arrived', estimated_guests: 3 }))).toBe(3)
  })
})

describe('admitLanded', () => {
  const fresh = (actual: number | null) =>
    ticket({
      party_size: 4,
      reservation: reservation({
        status: actual === null ? 'pending' : 'arrived',
        estimated_guests: 4,
        actual_guests: actual,
      }),
    })

  it('la respuesta se perdió pero entraron: no hay que reintentar', () => {
    expect(admitLanded(0, 2, fresh(2))).toBe(true)
    expect(admitLanded(2, 2, fresh(4))).toBe(true)
  })

  it('no llegó a la base: se puede reintentar', () => {
    expect(admitLanded(0, 2, fresh(null))).toBe(false)
    expect(admitLanded(2, 2, fresh(2))).toBe(false)
  })

  it('sin reserva, no entró', () => {
    expect(admitLanded(0, 2, ticket({ reservation: null }))).toBe(false)
  })
})

describe('doorBalanceCents', () => {
  it('con seña: el resto de cada persona', () => {
    expect(doorBalanceCents(ticket())).toBe(5_000_000)
  })
  it('con la entrada paga: nada', () => {
    expect(doorBalanceCents(ticket({ payment_option: 'full' }))).toBe(0)
  })
  it('un precio incoherente nunca da negativo', () => {
    expect(doorBalanceCents(ticket({ full_price_cents: 1_000_000 }))).toBe(0)
  })
})

describe('el token de un escaneo', () => {
  it('el código del QR tal cual', () => {
    expect(parseDoorToken('q83vEjR4TmSUaKxZ0Qd9bw')).toEqual({
      entryCode: 'q83vEjR4TmSUaKxZ0Qd9bw',
    })
  })
  it('el número de la entrada, como se dicta', () => {
    expect(parseDoorToken('ab7f 3e12')).toEqual({ shortCode: 'AB7F3E12' })
    expect(parseDoorToken('#AB7F-3E12')).toEqual({ shortCode: 'AB7F3E12' })
  })
  it('cualquier otra cosa → null', () => {
    expect(parseDoorToken('hola')).toBeNull()
    expect(parseDoorToken('zz7f3e12')).toBeNull()
  })
})

describe('formatShortCode', () => {
  it('de a 4', () => {
    expect(formatShortCode('AB7F3E12')).toBe('AB7F 3E12')
  })
})

describe('doorTicketSchema', () => {
  it('acepta lo que devuelve la base y rechaza un estado desconocido', () => {
    expect(doorTicketSchema.safeParse(ticket()).success).toBe(true)
    expect(doorTicketSchema.safeParse({ ...ticket(), status: 'otro' }).success).toBe(false)
  })
})
