import { describe, expect, it } from 'vitest'
import {
  allSoldOut,
  availabilityLabel,
  firstAvailable,
  functionState,
  isOnSale,
  isOpen,
  lastSeatsThreshold,
  maxSelectable,
  partySizeError,
  saleStatus,
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
    branch: null,
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

  it('con menos lugares que el mínimo de la película, para la web está agotada', () => {
    // Cine y degustación se vende de a 2: si queda 1 lugar, no se puede comprar.
    expect(functionState(1, 50, 2)).toBe('sold_out')
    expect(functionState(2, 50, 2)).toBe('last')
    expect(functionState(1, 50)).toBe('last')
  })

  it('con la venta frenada y lugar: «paused»; sin lugar sigue siendo agotada', () => {
    // Pedido de Nacho Badra (26/11/2026): frena las fechas lejanas para llenar la próxima.
    expect(functionState(30, 50, 2, true)).toBe('paused')
    // Aunque queden pocos: frenada no avisa «Últimos».
    expect(functionState(4, 50, 2, true)).toBe('paused')
    // Frenar no cambia lo que ya no se podía comprar.
    expect(functionState(0, 50, 2, true)).toBe('sold_out')
    expect(functionState(1, 50, 2, true)).toBe('sold_out')
    // Sin frenar, igual que siempre.
    expect(functionState(30, 50, 2, false)).toBe('available')
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

  it('la frenada dice «Próximamente», nunca «Agotado»: todavía tiene lugar', () => {
    expect(availabilityLabel({ left: 30, state: 'paused' })).toBe('Próximamente')
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

  it('la frenada no se compra ni se preselecciona', () => {
    const paused = fn({ eventId: 'a', state: 'paused', left: 40 })
    expect(isOpen(paused)).toBe(false)
    expect(isOpen(fn({ state: 'sold_out', left: 0 }))).toBe(false)
    expect(isOpen(fn({ state: 'last', left: 3 }))).toBe(true)
    expect(isOpen(fn({}))).toBe(true)
    expect(firstAvailable([paused, fn({ eventId: 'b' })])?.eventId).toBe('b')
    expect(firstAvailable([paused])).toBeNull()
    // No está agotada: «Se agotaron todas las fechas» sería mentira.
    expect(allSoldOut([paused])).toBe(false)
  })

  it('cómo viene la venta de una película, mirando todas sus fechas', () => {
    const open = fn({ eventId: 'o' })
    const paused = fn({ eventId: 'p', state: 'paused', left: 40 })
    const gone = fn({ eventId: 'g', state: 'sold_out', left: 0 })
    expect(saleStatus([])).toBe('none')
    expect(saleStatus([gone, open, paused])).toBe('open')
    // Nada para comprar ahora, pero a alguna le queda lugar: «Próximamente».
    expect(saleStatus([gone, paused])).toBe('soon')
    expect(saleStatus([paused])).toBe('soon')
    expect(saleStatus([gone])).toBe('sold_out')
  })

  it('no deja elegir más personas que lugares ni que el máximo por compra', () => {
    expect(maxSelectable({ left: 3 }, 10)).toBe(3)
    expect(maxSelectable({ left: 30 }, 10)).toBe(10)
    expect(maxSelectable({ left: 0 }, 10)).toBe(0)
  })
})

describe('partySizeError', () => {
  it('dice por qué no se puede comprar para esa cantidad', () => {
    expect(partySizeError(1, 2, 10)).toBe('Se reserva desde 2 personas.')
    expect(partySizeError(11, 2, 10)).toBe('Para más de 10 personas, escribinos.')
    expect(partySizeError(2, 2, 10)).toBeNull()
    expect(partySizeError(10, 2, 10)).toBeNull()
  })
})
