import { describe, expect, it } from 'vitest'
import { compactWaitlist, decideReservation, pickPromotion } from '@/lib/events/engine'

describe('decideReservation', () => {
  it('cabe holgado → confirmed', () => {
    expect(
      decideReservation({
        capacity: 40,
        confirmedSeats: 10,
        currentMaxWaitlistPosition: 0,
        guests: 2,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'confirmed' })
  })

  it('cupo exacto al límite → confirmed', () => {
    expect(
      decideReservation({
        capacity: 10,
        confirmedSeats: 8,
        currentMaxWaitlistPosition: 0,
        guests: 2,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'confirmed' })
  })

  it('un seat de más con waitlist on → waitlist 1', () => {
    expect(
      decideReservation({
        capacity: 10,
        confirmedSeats: 10,
        currentMaxWaitlistPosition: 0,
        guests: 1,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'waitlist', position: 1 })
  })

  it('waitlist next position respeta el max actual', () => {
    expect(
      decideReservation({
        capacity: 10,
        confirmedSeats: 10,
        currentMaxWaitlistPosition: 3,
        guests: 1,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'waitlist', position: 4 })
  })

  it('sin waitlist y lleno → rejected capacity_reached', () => {
    expect(
      decideReservation({
        capacity: 10,
        confirmedSeats: 10,
        currentMaxWaitlistPosition: 0,
        guests: 1,
        waitlistEnabled: false,
      }),
    ).toEqual({ kind: 'rejected', reason: 'capacity_reached' })
  })

  it('guests > capacity → rejected guests_exceed_capacity (incluso sin reservas)', () => {
    expect(
      decideReservation({
        capacity: 4,
        confirmedSeats: 0,
        currentMaxWaitlistPosition: 0,
        guests: 6,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'rejected', reason: 'guests_exceed_capacity' })
  })

  it('capacity null = ilimitado → siempre confirmed', () => {
    expect(
      decideReservation({
        capacity: null,
        confirmedSeats: 9999,
        currentMaxWaitlistPosition: 0,
        guests: 100,
        waitlistEnabled: false,
      }),
    ).toEqual({ kind: 'confirmed' })
  })

  it('guests <= 0 → rejected', () => {
    expect(
      decideReservation({
        capacity: 10,
        confirmedSeats: 0,
        currentMaxWaitlistPosition: 0,
        guests: 0,
        waitlistEnabled: true,
      }),
    ).toEqual({ kind: 'rejected', reason: 'capacity_reached' })
  })
})

describe('compactWaitlist', () => {
  it('compacta huecos: [1,3,5] → [1,2,3]', () => {
    expect(
      compactWaitlist([
        { id: 'a', waitlist_position: 1 },
        { id: 'b', waitlist_position: 3 },
        { id: 'c', waitlist_position: 5 },
      ]),
    ).toEqual([
      { id: 'a', new_position: 1 },
      { id: 'b', new_position: 2 },
      { id: 'c', new_position: 3 },
    ])
  })

  it('input ya consecutivo no cambia el orden', () => {
    expect(
      compactWaitlist([
        { id: 'a', waitlist_position: 1 },
        { id: 'b', waitlist_position: 2 },
      ]),
    ).toEqual([
      { id: 'a', new_position: 1 },
      { id: 'b', new_position: 2 },
    ])
  })

  it('lista vacía → []', () => {
    expect(compactWaitlist([])).toEqual([])
  })
})

describe('pickPromotion', () => {
  it('promueve al primero si entra', () => {
    expect(
      pickPromotion({
        capacity: 10,
        confirmedSeatsAfterCancel: 8,
        waitlist: [
          { id: 'a', guests_count: 2 },
          { id: 'b', guests_count: 1 },
        ],
      }),
    ).toEqual({ id: 'a', guests_count: 2 })
  })

  it('saltea al primero si no entra y promueve siguiente que entre', () => {
    // capacity 10, ya hay 9 confirmed seats → solo entra alguien con 1 guest.
    expect(
      pickPromotion({
        capacity: 10,
        confirmedSeatsAfterCancel: 9,
        waitlist: [
          { id: 'big', guests_count: 4 },
          { id: 'small', guests_count: 1 },
        ],
      }),
    ).toEqual({ id: 'small', guests_count: 1 })
  })

  it('si nadie entra → null', () => {
    expect(
      pickPromotion({
        capacity: 5,
        confirmedSeatsAfterCancel: 5,
        waitlist: [{ id: 'a', guests_count: 1 }],
      }),
    ).toBeNull()
  })

  it('capacity null promueve al primero sin chequeo', () => {
    expect(
      pickPromotion({
        capacity: null,
        confirmedSeatsAfterCancel: 9999,
        waitlist: [{ id: 'a', guests_count: 50 }],
      }),
    ).toEqual({ id: 'a', guests_count: 50 })
  })

  it('waitlist vacía → null', () => {
    expect(
      pickPromotion({
        capacity: 10,
        confirmedSeatsAfterCancel: 0,
        waitlist: [],
      }),
    ).toBeNull()
  })
})
