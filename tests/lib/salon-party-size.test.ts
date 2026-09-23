import { describe, expect, it } from 'vitest'
import {
  emptyPartySizeTally,
  filterByPartySize,
  isPartySizeBucket,
  matchesPartySize,
  PARTY_SIZE_ALL_ARIA,
  PARTY_SIZE_ALL_LABEL,
  PARTY_SIZE_BUCKETS,
  PARTY_SIZE_LABELS,
  PARTY_SIZE_LEGEND,
  type PartySizeCountable,
  partySizeAllAria,
  partySizeAriaLabel,
  partySizeBucket,
  partySizeChipAria,
  partySizeCountLabel,
  partySizePostgrestFilter,
  tallyPartySizes,
  totalPartySizes,
} from '@/lib/salon/party-size'
import type { SalonReservationStatus } from '@/lib/salon/types'

function row(
  estimated: number,
  over: { actual?: number | null; status?: SalonReservationStatus } = {},
): PartySizeCountable {
  return {
    estimated_guests: estimated,
    actual_guests: over.actual ?? null,
    status: over.status ?? 'pending',
  }
}

describe('grupos', () => {
  it('son los siete que pidió el dueño, en orden', () => {
    expect(PARTY_SIZE_BUCKETS).toEqual(['1', '2', '3', '4', '5', '6', '7mas'])
  })

  it('cada cantidad cae en su grupo', () => {
    expect(partySizeBucket(1)).toBe('1')
    expect(partySizeBucket(2)).toBe('2')
    expect(partySizeBucket(3)).toBe('3')
    expect(partySizeBucket(4)).toBe('4')
    expect(partySizeBucket(5)).toBe('5')
    expect(partySizeBucket(6)).toBe('6')
  })

  it('de 7 para arriba es todo "7 o más" (hay reservas de 50)', () => {
    expect(partySizeBucket(7)).toBe('7mas')
    expect(partySizeBucket(12)).toBe('7mas')
    expect(partySizeBucket(50)).toBe('7mas')
  })

  it('sin gente no hay mesa: 0, negativos y números rotos dan null', () => {
    expect(partySizeBucket(0)).toBeNull()
    expect(partySizeBucket(-3)).toBeNull()
    expect(partySizeBucket(Number.NaN)).toBeNull()
    expect(partySizeBucket(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('isPartySizeBucket cuida el borde de la URL', () => {
    expect(isPartySizeBucket('4')).toBe(true)
    expect(isPartySizeBucket('7mas')).toBe(true)
    expect(isPartySizeBucket('0')).toBe(false)
    expect(isPartySizeBucket('8')).toBe(false)
    expect(isPartySizeBucket('7 o más')).toBe(false)
    expect(isPartySizeBucket(4)).toBe(false)
    expect(isPartySizeBucket(undefined)).toBe(false)
  })
})

describe('textos en es-AR', () => {
  it('el chip dice el número, y "1 persona" solo en el primero', () => {
    expect(PARTY_SIZE_LEGEND).toBe('Personas por mesa')
    expect(PARTY_SIZE_ALL_LABEL).toBe('Todas')
    expect(PARTY_SIZE_LABELS).toEqual({
      '1': '1 persona',
      '2': '2',
      '3': '3',
      '4': '4',
      '5': '5',
      '6': '6',
      '7mas': '7 o más',
    })
  })

  it('el lector de pantalla dice de qué son las mesas', () => {
    expect(PARTY_SIZE_ALL_ARIA).toBe('mesas de cualquier tamaño')
    expect(partySizeAllAria({ reservations: 36, people: 214 })).toBe(
      'mesas de cualquier tamaño: 36 mesas, 214 personas',
    )
    expect(partySizeAllAria(null)).toBe('mesas de cualquier tamaño')
    expect(partySizeAriaLabel('1')).toBe('mesas de 1 persona')
    expect(partySizeAriaLabel('4')).toBe('mesas de 4 personas')
    expect(partySizeAriaLabel('7mas')).toBe('mesas de 7 o más personas')
  })

  it('el título separa mesas de personas', () => {
    expect(partySizeCountLabel({ reservations: 51, people: 204 })).toBe('51 mesas · 204 personas')
    expect(partySizeCountLabel({ reservations: 1, people: 1 })).toBe('1 mesa · 1 persona')
    expect(partySizeCountLabel({ reservations: 0, people: 0 })).toBe('0 mesas · 0 personas')
  })

  it('el chip "Todas" aclara que no cuenta canceladas ni ausentes', () => {
    // El encabezado de /reservas sí lista las que no vinieron, así que los dos
    // números pueden no coincidir: el título explica por qué.
    expect(partySizeCountLabel({ reservations: 21, people: 84 }, { all: true })).toBe(
      '21 mesas · 84 personas · no cuenta canceladas ni ausentes',
    )
    expect(partySizeCountLabel({ reservations: 21, people: 84 }, { all: false })).toBe(
      '21 mesas · 84 personas',
    )
  })

  it('el nombre accesible del chip suma el conteo, con coma y no con "·"', () => {
    expect(partySizeChipAria('4', { reservations: 51, people: 204 })).toBe(
      'mesas de 4 personas: 51 mesas, 204 personas',
    )
    expect(partySizeChipAria('1', { reservations: 1, people: 1 })).toBe(
      'mesas de 1 persona: 1 mesa, 1 persona',
    )
    expect(partySizeChipAria('7mas', null)).toBe('mesas de 7 o más personas')
  })
})

describe('tallyPartySizes', () => {
  it('cuenta mesas y gente de cada grupo', () => {
    const tally = tallyPartySizes([row(2), row(2), row(4), row(1), row(9)])
    expect(tally['2']).toEqual({ reservations: 2, people: 4 })
    expect(tally['4']).toEqual({ reservations: 1, people: 4 })
    expect(tally['1']).toEqual({ reservations: 1, people: 1 })
    expect(tally['7mas']).toEqual({ reservations: 1, people: 9 })
    expect(tally['5']).toEqual({ reservations: 0, people: 0 })
  })

  it('manda la gente que vino cuando ya se contó', () => {
    // Reservaron 6 y vinieron 3: es una mesa de 3, no de 6.
    const tally = tallyPartySizes([row(6, { actual: 3 })])
    expect(tally['3']).toEqual({ reservations: 1, people: 3 })
    expect(tally['6']).toEqual({ reservations: 0, people: 0 })
  })

  it('las canceladas y las no-show no ocupan mesa: no se cuentan', () => {
    const tally = tallyPartySizes([
      row(4),
      row(4, { status: 'cancelled' }),
      row(4, { status: 'no_show' }),
    ])
    expect(tally['4']).toEqual({ reservations: 1, people: 4 })
  })

  it('una reserva sin gente no entra en ningún grupo', () => {
    expect(tallyPartySizes([row(0)])).toEqual(emptyPartySizeTally())
  })

  it('siempre devuelve los siete grupos, aunque no haya nada', () => {
    expect(Object.keys(tallyPartySizes([]))).toEqual([...PARTY_SIZE_BUCKETS])
  })

  it('totalPartySizes suma los siete para el chip "Todas"', () => {
    const tally = tallyPartySizes([row(2), row(4), row(10), row(2, { status: 'cancelled' })])
    expect(totalPartySizes(tally)).toEqual({ reservations: 3, people: 16 })
  })
})

describe('filtrado', () => {
  it('el filtro devuelve exactamente lo que contó el chip', () => {
    const rows = [
      row(4),
      row(4, { status: 'cancelled' }),
      row(4, { status: 'no_show' }),
      row(2),
      row(5, { actual: 4 }),
    ]
    const tally = tallyPartySizes(rows)
    expect(filterByPartySize(rows, '4')).toHaveLength(tally['4'].reservations)
    expect(filterByPartySize(rows, '4')).toEqual([rows[0], rows[4]])
  })

  it('sin tamaño elegido no toca la lista', () => {
    const rows = [row(2), row(4)]
    expect(filterByPartySize(rows, null)).toBe(rows)
    expect(filterByPartySize(rows, undefined)).toBe(rows)
  })

  it('matchesPartySize deja afuera lo que no se arma', () => {
    expect(matchesPartySize(row(4), '4')).toBe(true)
    expect(matchesPartySize(row(4), '2')).toBe(false)
    expect(matchesPartySize(row(4, { status: 'cancelled' }), '4')).toBe(false)
    expect(matchesPartySize(row(4, { status: 'no_show' }), '4')).toBe(false)
    expect(matchesPartySize(row(20), '7mas')).toBe(true)
  })
})

describe('partySizePostgrestFilter', () => {
  it('es el coalesce(actual, estimado) que entiende PostgREST', () => {
    expect(partySizePostgrestFilter('4')).toBe(
      'actual_guests.eq.4,and(actual_guests.is.null,estimated_guests.eq.4)',
    )
  })

  it('el último grupo es abierto', () => {
    expect(partySizePostgrestFilter('7mas')).toBe(
      'actual_guests.gte.7,and(actual_guests.is.null,estimated_guests.gte.7)',
    )
  })
})
