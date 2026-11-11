import { describe, expect, it } from 'vitest'
import {
  capacityBelowReserved,
  capacityPercent,
  capacityView,
  FUNCTION_CAPACITY_MAX,
  filmsOf,
  functionCapacitySchema,
  groupByMonth,
  parseCapacityDraft,
} from '@/lib/ticketing/capacity'

/**
 * El cupo de cada función desde Ventas online › Funciones (pedido de los socios del 11/11/2026:
 * el cine lleva 54, a veces van a 100 y a veces a menos, y lo cambia Luz).
 */

const EVENT_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('parseCapacityDraft', () => {
  it('un número entero sirve', () => {
    expect(parseCapacityDraft('54')).toEqual({ ok: true, capacity: 54 })
    expect(parseCapacityDraft(' 100 ')).toEqual({ ok: true, capacity: 100 })
  })

  it('vacío no es cero: no cierra la función por error', () => {
    expect(parseCapacityDraft('')).toEqual({ ok: false, message: 'Poné cuántas personas entran.' })
    expect(parseCapacityDraft('   ').ok).toBe(false)
  })

  it('sin decimales, sin signos y dentro del techo', () => {
    expect(parseCapacityDraft('54.5')).toEqual({
      ok: false,
      message: 'Tiene que ser un número entero.',
    })
    expect(parseCapacityDraft('-3').ok).toBe(false)
    expect(parseCapacityDraft('0')).toEqual({
      ok: false,
      message: 'Tiene que entrar al menos una persona.',
    })
    expect(parseCapacityDraft(String(FUNCTION_CAPACITY_MAX))).toEqual({
      ok: true,
      capacity: FUNCTION_CAPACITY_MAX,
    })
    expect(parseCapacityDraft(String(FUNCTION_CAPACITY_MAX + 1)).ok).toBe(false)
  })
})

describe('functionCapacitySchema', () => {
  it('pide una función y un cupo entero entre 1 y el techo', () => {
    expect(functionCapacitySchema.safeParse({ event_id: EVENT_ID, capacity: 54 }).success).toBe(
      true,
    )
    expect(functionCapacitySchema.safeParse({ event_id: EVENT_ID, capacity: 0 }).success).toBe(
      false,
    )
    expect(functionCapacitySchema.safeParse({ event_id: EVENT_ID, capacity: 54.5 }).success).toBe(
      false,
    )
    expect(
      functionCapacitySchema.safeParse({ event_id: EVENT_ID, capacity: FUNCTION_CAPACITY_MAX + 1 })
        .success,
    ).toBe(false)
    expect(functionCapacitySchema.safeParse({ event_id: 'otra', capacity: 54 }).success).toBe(false)
    // Un texto no se convierte solo: lo que manda la pantalla ya es un número.
    expect(functionCapacitySchema.safeParse({ event_id: EVENT_ID, capacity: '54' }).success).toBe(
      false,
    )
  })
})

describe('capacityBelowReserved', () => {
  it('se puede subir, dejar igual o bajar hasta lo reservado', () => {
    expect(capacityBelowReserved(100, 48)).toBeNull()
    expect(capacityBelowReserved(48, 48)).toBeNull()
  })

  it('por debajo de lo reservado, no: esa gente entra igual', () => {
    expect(capacityBelowReserved(40, 48)).toBe(
      'Ya hay 48 personas reservadas: el cupo no puede ser menos.',
    )
    expect(capacityBelowReserved(0, 1)).toBe(
      'Ya hay 1 persona reservada: el cupo no puede ser menos.',
    )
  })
})

describe('capacityView', () => {
  it('con lugar de sobra: cuánto queda', () => {
    expect(capacityView({ capacity: 54, reserved: 20, paying: 0, left: 34 })).toEqual({
      tone: 'open',
      label: 'Quedan 34',
    })
  })

  it('los últimos lugares avisan, y los que están pagando se cuentan aparte', () => {
    expect(capacityView({ capacity: 54, reserved: 46, paying: 2, left: 6 })).toEqual({
      tone: 'last',
      label: 'Quedan 6 · 2 pagando ahora',
    })
    expect(capacityView({ capacity: 54, reserved: 53, paying: 0, left: 1 })).toEqual({
      tone: 'last',
      label: 'Queda 1 lugar',
    })
  })

  it('sin lugar: agotado; con más reservas que cupo: cuánto se pasó', () => {
    expect(capacityView({ capacity: 54, reserved: 54, paying: 0, left: 0 })).toEqual({
      tone: 'full',
      label: 'Agotado',
    })
    expect(capacityView({ capacity: 54, reserved: 50, paying: 4, left: 0 })).toEqual({
      tone: 'full',
      label: 'Agotado · 4 pagando ahora',
    })
    expect(capacityView({ capacity: 50, reserved: 56, paying: 0, left: 0 })).toEqual({
      tone: 'over',
      label: 'Se pasó por 6',
    })
  })
})

describe('capacityPercent', () => {
  it('lo reservado y lo que se está pagando, con techo en 100', () => {
    expect(capacityPercent({ capacity: 54, reserved: 27, paying: 0, left: 27 })).toBe(50)
    expect(capacityPercent({ capacity: 100, reserved: 48, paying: 2, left: 50 })).toBe(50)
    expect(capacityPercent({ capacity: 50, reserved: 56, paying: 0, left: 0 })).toBe(100)
  })
})

describe('filmsOf y groupByMonth', () => {
  const fns = [
    { date: '2026-11-15', slug: 'coraline', title: 'Coraline' },
    { date: '2026-11-16', slug: 'chihiro', title: 'El viaje de Chihiro' },
    { date: '2026-11-22', slug: 'coraline', title: 'Coraline' },
    { date: '2026-12-02', slug: 'coraline', title: 'Coraline' },
  ]

  it('una película por chip, en el orden de su próxima función, con cuántas tiene', () => {
    expect(filmsOf(fns)).toEqual([
      { slug: 'coraline', title: 'Coraline', count: 3 },
      { slug: 'chihiro', title: 'El viaje de Chihiro', count: 1 },
    ])
  })

  it('mes por mes, con el nombre del mes', () => {
    const months = groupByMonth(fns)
    expect(months.map((m) => [m.key, m.title, m.functions.length])).toEqual([
      ['2026-11', 'Noviembre 2026', 3],
      ['2026-12', 'Diciembre 2026', 1],
    ])
  })
})
