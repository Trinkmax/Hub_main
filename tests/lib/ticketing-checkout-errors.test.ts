import { describe, expect, it } from 'vitest'
import { createOrderErrorMessage } from '@/lib/ticketing/checkout-errors'

// Antes, cualquier error de la base decía «Esta función ya no está a la venta»
// y mandaba a elegir otra fecha. El 17/11/2026 eso le pasó a Ambar con El
// Grinch del 13/12 (44 lugares libres): la base había rechazado el teléfono.
describe('createOrderErrorMessage', () => {
  it('el teléfono que la base rechaza se dice en el campo del teléfono', () => {
    const result = createOrderErrorMessage(
      'new row for relation "ticket_orders" violates check constraint "ticket_orders_guest_phone_check"',
      'Failing row contains (…)',
    )
    expect(result).toMatchObject({ ok: false, field: 'guest_phone' })
    expect(result.ok ? '' : result.message).not.toMatch(/venta/)
  })

  it('el nombre, en el campo del nombre', () => {
    const result = createOrderErrorMessage(
      'new row for relation "ticket_orders" violates check constraint "ticket_orders_guest_name_check"',
      null,
    )
    expect(result).toMatchObject({ ok: false, field: 'guest_name' })
  })

  it('«ya no está a la venta» solo cuando la función o la película no se venden', () => {
    for (const code of ['ticketing_event_unavailable', 'ticketing_experience_unavailable']) {
      expect(createOrderErrorMessage(code, null)).toEqual({
        ok: false,
        message: 'Esta función ya no está a la venta. Elegí otra fecha.',
        field: 'event_id',
      })
    }
  })

  it('un error que no conocemos es nuestro: no culpa a la fecha y ofrece WhatsApp', () => {
    const result = createOrderErrorMessage('canceling statement due to lock timeout', null)
    expect(result).toMatchObject({ ok: false, unexpected: true })
    expect(result).not.toHaveProperty('field')
    expect(result.ok ? '' : result.message).not.toMatch(/venta/)
  })

  it('los lugares que quedan viajan para que la página los muestre', () => {
    expect(createOrderErrorMessage('ticketing_not_enough_seats', '3')).toEqual({
      ok: false,
      message: 'Quedan solo 3 lugares para esta fecha.',
      field: 'party_size',
      seatsLeft: 3,
    })
    expect(createOrderErrorMessage('ticketing_not_enough_seats', '0')).toMatchObject({
      seatsLeft: 0,
    })
  })

  it('el resto de los motivos conocidos, cada uno con su campo', () => {
    expect(createOrderErrorMessage('ticketing_event_started', null)).toMatchObject({
      field: 'event_id',
    })
    expect(createOrderErrorMessage('ticketing_invalid_party_size', null)).toMatchObject({
      field: 'party_size',
    })
    expect(createOrderErrorMessage('ticketing_invalid_option', null)).toMatchObject({
      field: 'option',
    })
    expect(createOrderErrorMessage('ticketing_too_many_holds', null)).not.toHaveProperty(
      'unexpected',
    )
  })
})
