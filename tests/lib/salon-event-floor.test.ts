import { describe, expect, it } from 'vitest'
import {
  EVENT_FLOOR_OPTIONS,
  floorLabel,
  isEventReservation,
  pickEventTile,
  pickFloorTile,
  placeSelection,
  UNPLACED_LABEL,
  zoneBreakdown,
  zoneChoicesFor,
} from '@/lib/salon/event-floor'

const PIZZA = '3f2a1c4e-8b7d-4e21-9a6f-0c5d2b1e7a90'
const RATATUILLE = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

describe('isEventReservation', () => {
  it('lo dice el id, no la zona', () => {
    expect(isEventReservation({ scheduled_event_id: PIZZA })).toBe(true)
    expect(isEventReservation({ scheduled_event_id: null })).toBe(false)
    expect(isEventReservation({ scheduled_event_id: undefined })).toBe(false)
    expect(isEventReservation({ scheduled_event_id: '' })).toBe(false)
  })
})

describe('floorLabel', () => {
  it('la planta sola, y "Sin ubicar" para la zona flotante', () => {
    expect(floorLabel('planta_alta')).toBe('Planta Alta')
    expect(floorLabel('planta_baja')).toBe('Planta Baja')
    expect(floorLabel('event_floating')).toBe(UNPLACED_LABEL)
    expect(UNPLACED_LABEL).toBe('Sin ubicar')
  })
})

describe('EVENT_FLOOR_OPTIONS / zoneChoicesFor', () => {
  it('con evento: Sin definir (primero, el default) · Planta Alta · Planta Baja', () => {
    expect(EVENT_FLOOR_OPTIONS.map((o) => o.zone)).toEqual([
      'event_floating',
      'planta_alta',
      'planta_baja',
    ])
    expect(EVENT_FLOOR_OPTIONS.map((o) => o.label)).toEqual([
      'Sin definir',
      'Planta Alta',
      'Planta Baja',
    ])
    expect(zoneChoicesFor({ scheduled_event_id: PIZZA })).toBe(EVENT_FLOOR_OPTIONS)
  })

  it('sin evento: solo las dos plantas (la zona flotante exige evento)', () => {
    expect(zoneChoicesFor({ scheduled_event_id: null }).map((o) => o.zone)).toEqual([
      'planta_alta',
      'planta_baja',
    ])
  })
})

describe('placeSelection', () => {
  it('reserva normal: la tarjeta de su planta', () => {
    expect(placeSelection({ zone: 'planta_baja', scheduled_event_id: undefined })).toEqual({
      floorTile: 'planta_baja',
      eventId: null,
      eventFloor: null,
    })
  })

  it('evento sin planta: la tarjeta del evento y "Sin definir"', () => {
    expect(placeSelection({ zone: 'event_floating', scheduled_event_id: PIZZA })).toEqual({
      floorTile: null,
      eventId: PIZZA,
      eventFloor: 'event_floating',
    })
  })

  it('evento con planta (la edición de PA + Pizza libre): el evento activo, Planta Alta abajo, la tarjeta PA suelta apagada', () => {
    expect(placeSelection({ zone: 'planta_alta', scheduled_event_id: PIZZA })).toEqual({
      floorTile: null,
      eventId: PIZZA,
      eventFloor: 'planta_alta',
    })
  })

  it('zona flotante sin evento (no debería existir): nada activo', () => {
    expect(placeSelection({ zone: 'event_floating', scheduled_event_id: null })).toEqual({
      floorTile: null,
      eventId: null,
      eventFloor: null,
    })
  })
})

describe('pickFloorTile', () => {
  it('una planta suelta saca la reserva del evento', () => {
    expect(pickFloorTile('planta_baja')).toEqual({
      zone: 'planta_baja',
      scheduled_event_id: undefined,
    })
  })
})

describe('pickEventTile', () => {
  it('desde una reserva normal arranca "Sin definir" (la Planta Alta del default no es una elección)', () => {
    expect(pickEventTile({ zone: 'planta_alta', scheduled_event_id: undefined }, PIZZA)).toEqual({
      zone: 'event_floating',
      scheduled_event_id: PIZZA,
    })
  })

  it('volver a tocar el mismo evento conserva la planta elegida', () => {
    expect(pickEventTile({ zone: 'planta_alta', scheduled_event_id: PIZZA }, PIZZA)).toEqual({
      zone: 'planta_alta',
      scheduled_event_id: PIZZA,
    })
  })

  it('pasar a otro evento vuelve a "Sin definir"', () => {
    expect(pickEventTile({ zone: 'planta_baja', scheduled_event_id: PIZZA }, RATATUILLE)).toEqual({
      zone: 'event_floating',
      scheduled_event_id: RATATUILLE,
    })
  })
})

describe('zoneBreakdown', () => {
  it('las dos plantas siempre, "Sin ubicar" solo con gente', () => {
    expect(zoneBreakdown({ planta_alta: 44, planta_baja: 0, event_floating: 22 })).toBe(
      'Planta Alta 44 · Planta Baja 0 · Sin ubicar 22',
    )
    expect(zoneBreakdown({ planta_alta: 46, planta_baja: 26, event_floating: 0 })).toBe(
      'Planta Alta 46 · Planta Baja 26',
    )
  })

  it('nunca dice "En eventos": la gente de un evento con planta cuenta en su planta', () => {
    expect(zoneBreakdown({ planta_alta: 29, planta_baja: 0, event_floating: 5 })).not.toContain(
      'eventos',
    )
  })
})
