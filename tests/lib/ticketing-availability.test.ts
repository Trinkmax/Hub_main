import { describe, expect, it } from 'vitest'
import {
  allSoldOut,
  availabilityLabel,
  firstAvailable,
  functionState,
  isOnSale,
  lastSeatsThreshold,
  maxSelectable,
  seatsLeft,
} from '@/lib/ticketing/availability'
import type { PublicFunction } from '@/lib/ticketing/types'

function fn(partial: Partial<PublicFunction>): PublicFunction {
  return {
    eventId: 'e',
    date: '2026-12-01',
    time: '21:00',
    capacity: 50,
    left: 50,
    state: 'available',
    ...partial,
  }
}

describe('seatsLeft', () => {
  it('cupo menos ocupados menos guardados, nunca negativo', () => {
    expect(seatsLeft(50, 30, 4)).toBe(16)
    // Noviembre 2026: Shrek con 55 personas en un cupo de 50.
    expect(seatsLeft(50, 55, 0)).toBe(0)
  })
})

describe('functionState', () => {
  it('agotado, últimos y disponible', () => {
    expect(functionState(0, 50)).toBe('sold_out')
    expect(functionState(10, 50)).toBe('last')
    expect(functionState(11, 50)).toBe('available')
  })

  it('el umbral de «últimos» es el 20 % con techo 10 y piso 1', () => {
    expect(lastSeatsThreshold(50)).toBe(10)
    expect(lastSeatsThreshold(120)).toBe(10)
    expect(lastSeatsThreshold(20)).toBe(4)
    expect(lastSeatsThreshold(3)).toBe(1)
  })
})

describe('availabilityLabel', () => {
  it('dice lo justo', () => {
    expect(availabilityLabel({ left: 0, state: 'sold_out' })).toBe('Agotado')
    expect(availabilityLabel({ left: 1, state: 'last' })).toBe('Último lugar')
    expect(availabilityLabel({ left: 4, state: 'last' })).toBe('Últimos 4')
    expect(availabilityLabel({ left: 30, state: 'available' })).toBeNull()
  })
})

describe('isOnSale', () => {
  it('se vende hasta la hora de inicio, en el reloj del bar', () => {
    expect(isOnSale('2026-12-01', '21:00:00', '2026-12-01 20:59')).toBe(true)
    expect(isOnSale('2026-12-01', '21:00', '2026-12-01 21:00')).toBe(false)
    expect(isOnSale('2026-12-02', '21:00', '2026-12-01 23:59')).toBe(true)
  })
})

describe('selección', () => {
  it('preselecciona la primera con lugar', () => {
    const list = [fn({ eventId: 'a', state: 'sold_out', left: 0 }), fn({ eventId: 'b' })]
    expect(firstAvailable(list)?.eventId).toBe('b')
    expect(allSoldOut(list)).toBe(false)
    expect(allSoldOut([fn({ state: 'sold_out', left: 0 })])).toBe(true)
  })

  it('no deja elegir más personas que lugares ni que el máximo por compra', () => {
    expect(maxSelectable({ left: 3 }, 10)).toBe(3)
    expect(maxSelectable({ left: 30 }, 10)).toBe(10)
    expect(maxSelectable({ left: 0 }, 10)).toBe(0)
  })
})
