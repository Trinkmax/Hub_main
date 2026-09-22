import { describe, expect, it } from 'vitest'
import { joinedEventName, placeLabel } from '@/lib/salon/place-label'

const EV = '3f2a1c4e-8b7d-4e21-9a6f-0c5d2b1e7a90'

describe('placeLabel', () => {
  it('reserva normal: la planta', () => {
    expect(placeLabel({ zone: 'planta_baja', scheduled_event_id: null }, null)).toBe('Planta Baja')
  })

  it('evento sin planta elegida: el evento', () => {
    expect(placeLabel({ zone: 'event_floating', scheduled_event_id: EV }, 'Pizza libre')).toBe(
      'Pizza libre',
    )
  })

  it('evento con planta: los dos (el pedido del 22/09)', () => {
    expect(placeLabel({ zone: 'planta_alta', scheduled_event_id: EV }, 'Pizza libre')).toBe(
      'Pizza libre · Planta Alta',
    )
  })

  it('sin nombre del evento cae en "Evento"', () => {
    expect(placeLabel({ zone: 'planta_alta', scheduled_event_id: EV }, null)).toBe(
      'Evento · Planta Alta',
    )
    expect(placeLabel({ zone: 'event_floating', scheduled_event_id: EV }, '  ')).toBe('Evento')
  })

  it('zona flotante sin evento (no debería existir) no rompe', () => {
    expect(placeLabel({ zone: 'event_floating', scheduled_event_id: null }, null)).toBe('Evento')
  })
})

describe('joinedEventName', () => {
  it('lee el nombre del formato del join', () => {
    expect(joinedEventName({ scheduled_event: { template: { name: 'Sushi libre' } } })).toBe(
      'Sushi libre',
    )
    expect(joinedEventName({ scheduled_event: null })).toBeNull()
    expect(joinedEventName({})).toBeNull()
  })
})
