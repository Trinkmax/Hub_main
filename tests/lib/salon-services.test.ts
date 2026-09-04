import { describe, expect, it } from 'vitest'
import {
  coversOf,
  groupByService,
  MEAL_TYPE_ORDER,
  occupiesTable,
  type ServiceRow,
  serviceTimeRange,
  totalsFromServices,
} from '@/lib/salon/services'

function row(over: Partial<ServiceRow> = {}): ServiceRow {
  return {
    meal_type: 'dinner',
    zone: 'planta_alta',
    status: 'pending',
    kind: 'normal',
    cake_count: 0,
    estimated_guests: 2,
    actual_guests: null,
    reservation_time_local: '21:00:00',
    ...over,
  }
}

describe('groupByService', () => {
  it('sin reservas no devuelve ningún servicio', () => {
    expect(groupByService([])).toEqual([])
  })

  it('solo devuelve los servicios que ese día tienen algo', () => {
    const buckets = groupByService([row({ meal_type: 'dinner' }), row({ meal_type: 'tea_time' })])
    expect(buckets.map((b) => b.mealType)).toEqual(['tea_time', 'dinner'])
  })

  it('ordena cronológicamente, no por cantidad ni por orden de llegada', () => {
    const buckets = groupByService([
      row({ meal_type: 'dinner' }),
      row({ meal_type: 'breakfast' }),
      row({ meal_type: 'hub_event' }),
      row({ meal_type: 'lunch' }),
      row({ meal_type: 'tea_time' }),
    ])
    expect(buckets.map((b) => b.mealType)).toEqual([...MEAL_TYPE_ORDER])
  })

  it('abre los cubiertos por zona y las tres zonas suman el total', () => {
    const [cena] = groupByService([
      row({ zone: 'planta_alta', estimated_guests: 15 }),
      row({ zone: 'planta_baja', estimated_guests: 6 }),
      row({ zone: 'event_floating', estimated_guests: 5 }),
    ])
    expect(cena?.covers).toBe(26)
    expect(cena?.byZone).toEqual({ planta_alta: 15, planta_baja: 6, event_floating: 5 })
    const { planta_alta, planta_baja, event_floating } = cena?.byZone ?? {
      planta_alta: 0,
      planta_baja: 0,
      event_floating: 0,
    }
    expect(planta_alta + planta_baja + event_floating).toBe(cena?.covers)
  })

  it('cuenta MESAS por zona además de cubiertos (no es lo mismo)', () => {
    const [cena] = groupByService([
      row({ zone: 'planta_alta', estimated_guests: 15 }),
      row({ zone: 'planta_alta', estimated_guests: 2 }),
      row({ zone: 'planta_baja', estimated_guests: 6 }),
      // Una cancelada no ocupa mesa: no suma ni cubiertos ni mesa.
      row({ zone: 'planta_baja', estimated_guests: 4, status: 'cancelled' }),
    ])
    expect(cena?.byZone).toEqual({ planta_alta: 17, planta_baja: 6, event_floating: 0 })
    expect(cena?.tablesByZone).toEqual({ planta_alta: 2, planta_baja: 1, event_floating: 0 })
  })

  it('usa los que vinieron apenas están cargados', () => {
    const [cena] = groupByService([row({ estimated_guests: 20, actual_guests: 18 })])
    expect(cena?.covers).toBe(18)
  })

  it('canceladas y no-show se listan pero no ocupan mesa', () => {
    const [cena] = groupByService([
      row({ estimated_guests: 10 }),
      row({ estimated_guests: 8, status: 'cancelled' }),
      row({ estimated_guests: 4, status: 'no_show' }),
    ])
    expect(cena?.covers).toBe(10)
    expect(cena?.activeCount).toBe(1)
    expect(cena?.inactiveCount).toBe(2)
    // Siguen en la lista: alguien va a preguntar "¿esta no había reservado?".
    expect(cena?.rows).toHaveLength(3)
  })

  it('cuenta cumpleaños y tortas del servicio', () => {
    const [cena] = groupByService([
      row({ kind: 'birthday', cake_count: 1 }),
      row({ kind: 'birthday', cake_count: 2 }),
      row({ kind: 'special' }),
      row(),
    ])
    expect(cena?.birthdays).toBe(2)
    expect(cena?.cakes).toBe(3)
  })

  it('una torta de una reserva cancelada no se cocina', () => {
    const [cena] = groupByService([
      row({ kind: 'birthday', cake_count: 1, status: 'cancelled' }),
      row({ kind: 'birthday', cake_count: 1 }),
    ])
    expect(cena?.cakes).toBe(1)
    expect(cena?.birthdays).toBe(1)
  })

  it('la franja la marcan las reservas que se van a sentar', () => {
    const [cena] = groupByService([
      row({ reservation_time_local: '21:00:00' }),
      row({ reservation_time_local: '23:30:00' }),
      // Una cancelada temprana no puede estirar la cena para atrás.
      row({ reservation_time_local: '20:00:00', status: 'cancelled' }),
    ])
    expect(cena?.from).toBe('21:00')
    expect(cena?.to).toBe('23:30')
    expect(serviceTimeRange(cena ?? { from: null, to: null })).toBe('21:00 a 23:30')
  })

  it('un servicio con todas a la misma hora muestra una sola hora', () => {
    const [cena] = groupByService([row(), row()])
    expect(serviceTimeRange(cena ?? { from: null, to: null })).toBe('21:00')
  })

  it('un servicio entero cancelado queda con franja nula y cero cubiertos', () => {
    const [cena] = groupByService([row({ status: 'cancelled' })])
    expect(cena?.covers).toBe(0)
    expect(cena?.from).toBeNull()
    expect(serviceTimeRange(cena ?? { from: null, to: null })).toBeNull()
  })

  it('preserva el orden que vino del server dentro de cada servicio', () => {
    const a = row({ reservation_time_local: '22:00:00' })
    const b = row({ reservation_time_local: '20:30:00' })
    const [cena] = groupByService([a, b])
    expect(cena?.rows).toEqual([a, b])
  })
})

describe('totalsFromServices', () => {
  it('suma los servicios sin doble conteo por zona', () => {
    const buckets = groupByService([
      row({ meal_type: 'tea_time', zone: 'planta_baja', estimated_guests: 12 }),
      row({
        meal_type: 'dinner',
        zone: 'planta_alta',
        estimated_guests: 15,
        kind: 'birthday',
        cake_count: 1,
      }),
      row({ meal_type: 'dinner', zone: 'event_floating', estimated_guests: 5 }),
    ])
    expect(totalsFromServices(buckets)).toEqual({
      covers: 32,
      activeCount: 3,
      birthdays: 1,
      cakes: 1,
      byZone: { planta_alta: 15, planta_baja: 12, event_floating: 5 },
    })
  })
})

describe('helpers', () => {
  it('occupiesTable excluye canceladas y no-show, nada más', () => {
    expect(occupiesTable({ status: 'pending' })).toBe(true)
    expect(occupiesTable({ status: 'arrived' })).toBe(true)
    expect(occupiesTable({ status: 'seated' })).toBe(true)
    expect(occupiesTable({ status: 'closed' })).toBe(true)
    expect(occupiesTable({ status: 'cancelled' })).toBe(false)
    expect(occupiesTable({ status: 'no_show' })).toBe(false)
  })

  it('coversOf prefiere lo real sobre lo estimado', () => {
    expect(coversOf({ estimated_guests: 10, actual_guests: 7 })).toBe(7)
    expect(coversOf({ estimated_guests: 10, actual_guests: null })).toBe(10)
    // 0 asistentes es un dato, no un "todavía no contamos".
    expect(coversOf({ estimated_guests: 10, actual_guests: 0 })).toBe(0)
  })
})
