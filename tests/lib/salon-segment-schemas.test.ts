import { describe, expect, it } from 'vitest'
import {
  calendarParamsSchema,
  dayRequestSchema,
  firstParams,
  hhmmSchema,
  isoDaySchema,
  newReservationParamsSchema,
  reservationSearchSchema,
  segmentConfigSaveSchema,
  segmentKeySchema,
  segmentOverrideKeySchema,
  segmentOverrideSchema,
  segmentSettingInputSchema,
  segmentWeeklyCellSchema,
} from '@/lib/salon/segment-schemas'

const EVENT_ID = '3f2b8c1e-5d4a-4b7e-9c61-0a2d4e6f8b10'

function issueAt(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) {
  return result.error?.issues.map((i) => i.path.join('.')) ?? []
}

describe('primitivas', () => {
  it('segmentKeySchema solo acepta los 3 servicios', () => {
    expect(segmentKeySchema.safeParse('tea_time').success).toBe(true)
    expect(segmentKeySchema.safeParse('breakfast').success).toBe(false)
    expect(segmentKeySchema.safeParse('hub_event').success).toBe(false)
  })

  it('isoDaySchema rechaza días que no existen', () => {
    expect(isoDaySchema.safeParse('2026-09-10').success).toBe(true)
    expect(isoDaySchema.safeParse('2026-02-30').success).toBe(false)
    expect(isoDaySchema.safeParse('10/09/2026').success).toBe(false)
  })

  it('hhmmSchema', () => {
    expect(hhmmSchema.safeParse('21:00').success).toBe(true)
    expect(hhmmSchema.safeParse('25:00').success).toBe(false)
    expect(hhmmSchema.safeParse('21:00:00').success).toBe(false)
  })

  it('dayRequestSchema y reservationSearchSchema', () => {
    expect(dayRequestSchema.safeParse({ date: '2026-09-10' }).success).toBe(true)
    expect(dayRequestSchema.safeParse({ date: 'mañana' }).success).toBe(false)
    expect(reservationSearchSchema.parse({ q: '  lop  ' })).toEqual({ q: 'lop' })
    expect(reservationSearchSchema.safeParse({ q: ' a ' }).success).toBe(false)
    expect(reservationSearchSchema.safeParse({ q: 'x'.repeat(61) }).success).toBe(false)
  })
})

describe('newReservationParamsSchema', () => {
  it('un parámetro inválido se ignora sin romper los demás', () => {
    expect(newReservationParamsSchema.parse({ meal: 'breakfast' }).meal).toBeUndefined()
    expect(newReservationParamsSchema.parse({ time: '25:00' }).time).toBeUndefined()
    expect(newReservationParamsSchema.parse({ time: '21:00' }).time).toBe('21:00')
    expect(newReservationParamsSchema.parse({ event: 'x' }).event).toBeUndefined()
    expect(newReservationParamsSchema.parse({ date: '2026-02-30' }).date).toBeUndefined()
  })

  it('todo junto', () => {
    expect(
      newReservationParamsSchema.parse({
        date: '2026-09-28',
        event: EVENT_ID,
        meal: 'tea_time',
        time: '16:30',
        guest_name: ' Juan ',
        otro: 'se descarta',
      }),
    ).toEqual({
      date: '2026-09-28',
      event: EVENT_ID,
      meal: 'tea_time',
      time: '16:30',
      guest_name: 'Juan',
    })
    expect(newReservationParamsSchema.parse({})).toEqual({})
    expect(newReservationParamsSchema.parse({ guest_name: '' }).guest_name).toBeUndefined()
  })
})

describe('calendarParamsSchema', () => {
  it('?day=hoy se acepta tal cual; un mes imposible se ignora', () => {
    expect(calendarParamsSchema.parse({ day: 'hoy' }).day).toBe('hoy')
    expect(calendarParamsSchema.parse({ month: '2026-13' }).month).toBeUndefined()
  })

  it('params válidos y basura', () => {
    expect(
      calendarParamsSchema.parse({
        month: '2026-09',
        day: '2026-09-10',
        seg: 'dinner',
        res: EVENT_ID,
        buscar: 'lopez',
        tab: 'eventos',
      }),
    ).toEqual({
      month: '2026-09',
      day: '2026-09-10',
      seg: 'dinner',
      res: EVENT_ID,
      buscar: 'lopez',
      tab: 'eventos',
    })
    expect(
      calendarParamsSchema.parse({ day: 'ayer', seg: 'breakfast', res: 'x', tab: 'lista' }),
    ).toEqual({})
  })
})

describe('segmentWeeklyCellSchema', () => {
  const cell = { segment: 'lunch', iso_dow: 1 }

  it('el aviso no puede pasar el cupo', () => {
    const r = segmentWeeklyCellSchema.safeParse({ ...cell, capacity: 70, warn_at: 80 })
    expect(r.success).toBe(false)
    expect(issueAt(r)).toEqual(['warn_at'])
    expect(r.error?.issues[0]?.message).toBe('El aviso tiene que ser menor o igual al cupo')
  })

  it('el aviso necesita un cupo', () => {
    const r = segmentWeeklyCellSchema.safeParse({ ...cell, capacity: null, warn_at: 10 })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Poné el cupo antes del aviso')
  })

  it('cupo 0 (cerrado) sin aviso es válido; vacío también', () => {
    expect(segmentWeeklyCellSchema.safeParse({ ...cell, capacity: 0, warn_at: null }).success).toBe(
      true,
    )
    expect(
      segmentWeeklyCellSchema.safeParse({ ...cell, capacity: null, warn_at: null }).success,
    ).toBe(true)
  })

  it('rangos: cupo 0..999 entero, día 1..7', () => {
    const over = segmentWeeklyCellSchema.safeParse({ ...cell, capacity: 1000, warn_at: null })
    expect(over.error?.issues[0]?.message).toBe('Entre 0 y 999')
    expect(
      segmentWeeklyCellSchema.safeParse({ ...cell, capacity: 7.5, warn_at: null }).success,
    ).toBe(false)
    expect(
      segmentWeeklyCellSchema.safeParse({ ...cell, iso_dow: 8, capacity: 70, warn_at: null })
        .success,
    ).toBe(false)
  })
})

describe('segmentSettingInputSchema', () => {
  it('nota vacía → null y hora HH:MM', () => {
    expect(
      segmentSettingInputSchema.parse({ segment: 'lunch', default_time: '13:00', warn_note: '  ' }),
    ).toEqual({ segment: 'lunch', default_time: '13:00', warn_note: null })
    expect(
      segmentSettingInputSchema.safeParse({
        segment: 'lunch',
        default_time: '13:00',
        warn_note: 'x'.repeat(81),
      }).success,
    ).toBe(false)
  })
})

describe('segmentConfigSaveSchema', () => {
  it('una celda (servicio, día) repetida es un error', () => {
    const r = segmentConfigSaveSchema.safeParse({
      weekly: [
        { segment: 'lunch', iso_dow: 1, capacity: 70, warn_at: 50 },
        { segment: 'lunch', iso_dow: 1, capacity: 80, warn_at: null },
      ],
      settings: [],
    })
    expect(r.success).toBe(false)
    expect(issueAt(r)).toEqual(['weekly.1'])
  })

  it('un servicio repetido en los ajustes también', () => {
    const r = segmentConfigSaveSchema.safeParse({
      weekly: [],
      settings: [
        { segment: 'dinner', default_time: '21:00', warn_note: null },
        { segment: 'dinner', default_time: '20:30', warn_note: null },
      ],
    })
    expect(issueAt(r)).toEqual(['settings.1'])
  })

  it('la grilla del HUB entra entera', () => {
    const weekly = (['lunch', 'tea_time', 'dinner'] as const).flatMap((segment) =>
      [1, 2, 3, 4, 5, 6, 7].map((iso_dow) => ({
        segment,
        iso_dow,
        capacity: segment === 'lunch' && iso_dow <= 5 ? 70 : 120,
        warn_at: segment === 'lunch' && iso_dow <= 5 ? 50 : null,
      })),
    )
    expect(segmentConfigSaveSchema.safeParse({ weekly, settings: [] }).success).toBe(true)
  })
})

describe('segmentOverrideSchema', () => {
  const base = { override_date: '2026-10-12', segment: 'lunch', capacity: 120 }

  it("motivo '' → null y aviso por defecto null", () => {
    expect(segmentOverrideSchema.parse({ ...base, reason: '' })).toEqual({
      ...base,
      warn_at: null,
      reason: null,
    })
    expect(segmentOverrideSchema.parse({ ...base, reason: ' Feriado ' }).reason).toBe('Feriado')
  })

  it('aviso mayor al cupo y motivo largo', () => {
    const r = segmentOverrideSchema.safeParse({ ...base, capacity: 70, warn_at: 80 })
    expect(issueAt(r)).toEqual(['warn_at'])
    expect(segmentOverrideSchema.safeParse({ ...base, reason: 'x'.repeat(121) }).success).toBe(
      false,
    )
  })

  it('segmentOverrideKeySchema', () => {
    expect(
      segmentOverrideKeySchema.safeParse({ override_date: '2026-10-12', segment: 'lunch' }).success,
    ).toBe(true)
    expect(
      segmentOverrideKeySchema.safeParse({ override_date: '2026-10-12', segment: 'breakfast' })
        .success,
    ).toBe(false)
  })
})

describe('firstParams', () => {
  it('se queda con el primer valor de cada clave', () => {
    expect(firstParams({ a: ['x', 'y'] })).toEqual({ a: 'x' })
    expect(firstParams({ a: 'x', b: undefined, c: [] })).toEqual({
      a: 'x',
      b: undefined,
      c: undefined,
    })
  })
})
