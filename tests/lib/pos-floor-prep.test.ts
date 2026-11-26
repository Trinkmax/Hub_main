import { describe, expect, it } from 'vitest'
import { prepChips, prepSpoken } from '@/lib/pos/floor/prep'
import {
  isFloorManager,
  isLockedFor,
  shortName,
  tableOwner,
  waiterMoves,
} from '@/lib/pos/floor/waiter'
import type { MenuStation } from '@/lib/pos/types'

const STATIONS: MenuStation[] = [
  { id: 'cocina', name: 'Cocina', color: '#b45309', kind: 'food', icon: 'chef' },
  // Lo que se guardó el primer día (un emoji) se lee como el ícono que le corresponde.
  { id: 'barra', name: 'Barra', color: '#6d28d9', kind: 'drink', icon: '🍹' },
  { id: 'pizza', name: 'Pizzeros', color: '#b91c1c', kind: 'food', icon: null },
]
const row = (station_id: string | null, queued: number, preparing: number, ready: number) => ({
  station_id,
  queued,
  preparing,
  ready,
})

describe('los dibujos de comida y bebida sobre la mesa', () => {
  it('uno por estación que le debe algo a la mesa, en el orden del bar', () => {
    const chips = prepChips([row('barra', 4, 0, 0), row('cocina', 0, 2, 0)], STATIONS)
    expect(chips.map((c) => [c.icon, c.name, c.state, c.units])).toEqual([
      ['chef', 'Cocina', 'cooking', 2],
      ['cocktail', 'Barra', 'cooking', 4],
    ])
    expect(chips.map((c) => c.kind)).toEqual(['food', 'drink'])
  })

  it('si hay algo listo, manda eso: hay que ir a buscarlo', () => {
    const [chip] = prepChips([row('barra', 1, 1, 3)], STATIONS)
    expect(chip).toMatchObject({ state: 'ready', units: 3 })
  })

  it('una estación sin dibujo elegido toma el de su nombre', () => {
    expect(prepChips([row('pizza', 1, 0, 0)], STATIONS)[0]?.icon).toBe('pizza')
  })

  it('lo que no tiene estación (o va a una apagada) se suma a la primera', () => {
    const chips = prepChips(
      [row(null, 1, 0, 0), row('apagada', 0, 0, 2), row('cocina', 1, 0, 0)],
      STATIONS,
    )
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ name: 'Cocina', state: 'ready', units: 2 })
  })

  it('una mesa que no espera nada no lleva dibujos', () => {
    expect(prepChips([], STATIONS)).toEqual([])
    expect(prepChips(undefined, STATIONS)).toEqual([])
    expect(prepChips([row('barra', 0, 0, 0)], STATIONS)).toEqual([])
  })

  it('un bar sin estaciones igual muestra que hay comida en camino', () => {
    const chips = prepChips([row(null, 2, 0, 0)], [])
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ icon: 'chef', kind: 'food', state: 'cooking', units: 2 })
  })

  it('se dice en voz alta para quien no ve la pantalla', () => {
    expect(prepSpoken(prepChips([row('barra', 0, 0, 3), row('cocina', 2, 0, 0)], STATIONS))).toBe(
      '2 en preparación en Cocina, 3 para retirar en Barra',
    )
  })
})

describe('de quién es cada mesa', () => {
  it('mía, de otro o de nadie', () => {
    expect(tableOwner('yo', 'yo')).toBe('mine')
    expect(tableOwner('otro', 'yo')).toBe('other')
    expect(tableOwner(null, 'yo')).toBe('none')
    expect(tableOwner(undefined, 'yo')).toBe('none')
    // Sin saber quién mira, una mesa con mozo es de otro.
    expect(tableOwner('otro', null)).toBe('other')
  })

  it('solo al mozo se le bloquea la mesa de otro', () => {
    expect(isLockedFor('waiter', 'other')).toBe(true)
    expect(isLockedFor('waiter', 'mine')).toBe(false)
    expect(isLockedFor('waiter', 'none')).toBe(false)
    for (const role of ['owner', 'cashier', 'host', 'kitchen']) {
      expect(isLockedFor(role, 'other')).toBe(false)
    }
  })

  it('quién reparte las mesas', () => {
    expect(['owner', 'cashier', 'host'].every(isFloorManager)).toBe(true)
    expect(isFloorManager('waiter')).toBe(false)
    expect(isFloorManager('kitchen')).toBe(false)
    expect(isFloorManager(null)).toBe(false)
  })

  it('un mozo toma la que no tiene a nadie y pasa la suya; la de otro no la toca', () => {
    expect(waiterMoves('waiter', 'none')).toEqual({ take: true, pass: false, clear: false })
    expect(waiterMoves('waiter', 'mine')).toEqual({ take: false, pass: true, clear: false })
    expect(waiterMoves('waiter', 'other')).toEqual({ take: false, pass: false, clear: false })
  })

  it('el encargado pasa cualquiera y la puede dejar sin nadie', () => {
    expect(waiterMoves('owner', 'other')).toEqual({ take: true, pass: true, clear: true })
    expect(waiterMoves('host', 'none')).toEqual({ take: true, pass: true, clear: false })
    expect(waiterMoves('cashier', 'mine')).toEqual({ take: false, pass: true, clear: true })
    expect(waiterMoves('kitchen', 'none')).toEqual({ take: false, pass: false, clear: false })
  })

  it('el nombre en corto, para la bandera de la mesa', () => {
    expect(shortName('Sofía Giménez')).toBe('Sofía')
    expect(shortName('  ')).toBe('')
    expect(shortName(null)).toBe('')
    expect(shortName('Maximiliano Alejandro')).toBe('Maximiliano')
    expect(shortName('Bartolomeosegundo')).toBe('Bartolomeos…')
  })
})
