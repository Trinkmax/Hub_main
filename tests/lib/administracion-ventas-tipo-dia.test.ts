import { describe, expect, it } from 'vitest'
import {
  changedTargets,
  liveTargets,
  savedTarget,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/planilla'
import {
  DAY_TYPE_LABELS,
  DAY_TYPE_LEGEND,
  dayTypeOf,
  dayTypes,
  targetStats,
} from '@/lib/accounting/day-type'
import { buildProjection, type ProjectionSourceDay } from '@/lib/accounting/projection'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { eachIsoDay } from '@/lib/dates'

/**
 * «Dependiendo de cómo le ponés el objetivo, que se catalogue en flojo, normal, fuerte» (reunión del
 * 29/10/2026, min. 20:42). Es el revés de lo que había: el tipo sale del número, nadie lo elige.
 */

const NB = String.fromCharCode(160)
/** Días de $ 1.000.000: el promedio es redondo y los bordes se pueden escribir a mano. */
const MILLION = 100_000_000

describe('dayTypeOf: el tipo sale del objetivo contra el promedio', () => {
  const stats = { count: 4, sumCents: 4 * MILLION }

  it('debajo del 80 % es flojo; arriba del 120 %, fuerte; el resto, normal', () => {
    expect(dayTypeOf(79_999_999, stats)).toBe('low')
    expect(dayTypeOf(MILLION, stats)).toBe('normal')
    expect(dayTypeOf(120_000_001, stats)).toBe('strong')
  })

  it('justo en el 80 % y en el 120 % todavía es normal: dice «menor» y «mayor»', () => {
    expect(dayTypeOf(80_000_000, stats)).toBe('normal')
    expect(dayTypeOf(120_000_000, stats)).toBe('normal')
  })

  it('sin objetivo, o con cero, no tiene tipo', () => {
    expect(dayTypeOf(null, stats)).toBe('none')
    expect(dayTypeOf(0, stats)).toBe('none')
    expect(dayTypeOf(MILLION, { count: 0, sumCents: 0 })).toBe('none')
  })

  it('un promedio con decimales no corre un día de tipo', () => {
    // Promedio de 3 días: 333.333,33… × 0,8 = 266.666,66…: $ 266.666,67 ya no es flojo.
    const third = { count: 3, sumCents: 100_000_000 }
    expect(dayTypeOf(26_666_666, third)).toBe('low')
    expect(dayTypeOf(26_666_667, third)).toBe('normal')
    expect(dayTypeOf(40_000_000, third)).toBe('normal')
    expect(dayTypeOf(40_000_001, third)).toBe('strong')
  })

  it('con los topes de la base, la cuenta sigue siendo exacta', () => {
    const top = 999_999_999_999
    const month = { count: 31, sumCents: top * 31 }
    expect(Number.isSafeInteger(top * 31 * 100)).toBe(true)
    expect(Number.isSafeInteger(month.sumCents * 120)).toBe(true)
    expect(dayTypeOf(top, month)).toBe('normal')
  })
})

describe('targetStats: el promedio es de los días con objetivo', () => {
  it('un día sin objetivo no baja el promedio de los demás', () => {
    expect(targetStats([MILLION, null, 0, MILLION])).toEqual({ count: 2, sumCents: 2 * MILLION })
    expect(targetStats([])).toEqual({ count: 0, sumCents: 0 })
  })
})

describe('dayTypes: un mes entero', () => {
  it('el ejemplo de la planilla', () => {
    const types = dayTypes([
      { day: '2026-11-02', targetCents: 60_000_000 },
      { day: '2026-11-03', targetCents: 100_000_000 },
      { day: '2026-11-04', targetCents: 100_000_000 },
      { day: '2026-11-05', targetCents: 100_000_000 },
      { day: '2026-11-06', targetCents: 180_000_000 },
      { day: '2026-11-07', targetCents: null },
    ])
    expect(types).toEqual({
      '2026-11-02': 'low',
      '2026-11-03': 'normal',
      '2026-11-04': 'normal',
      '2026-11-05': 'normal',
      '2026-11-06': 'strong',
      '2026-11-07': 'none',
    })
  })

  it('con un solo día, ese día es el promedio', () => {
    expect(dayTypes([{ day: '2026-11-02', targetCents: 5 }])).toEqual({ '2026-11-02': 'normal' })
  })

  it('un mes sin objetivos no tiene tipos', () => {
    expect(Object.values(dayTypes([{ day: '2026-11-02', targetCents: null }]))).toEqual(['none'])
  })
})

describe('las palabras', () => {
  it('son las del prototipo', () => {
    expect(DAY_TYPE_LABELS).toEqual({
      none: 'Sin objetivo',
      low: 'Flojo',
      normal: 'Normal',
      strong: 'Fuerte',
    })
    expect(DAY_TYPE_LEGEND).toBe(`Fuerte: 20${NB}% arriba del promedio. Flojo: 20${NB}% abajo.`)
  })
})

// ─── Mientras se escribe ─────────────────────────────────────────────────────

function rows(targets: Record<string, number | null>, over: Partial<ProjectionSourceDay> = {}) {
  return eachIsoDay('2026-11-01', '2026-11-05').map(
    (day): ProjectionSourceDay => ({
      day,
      targetCents: targets[day] ?? null,
      note: null,
      closes: 0,
      salonCents: 0,
      deliveryCents: 0,
      eventsCents: 0,
      salonCommissionCents: 0,
      deliveryCommissionCents: 0,
      eventsCommissionCents: 0,
      cashCountedCents: null,
      ...over,
    }),
  )
}

const SAVED = {
  '2026-11-01': MILLION,
  '2026-11-02': MILLION,
  '2026-11-03': MILLION,
}

describe('la planilla se recalcula al escribir, con la misma cuenta del servidor', () => {
  it('lo que se está escribiendo cambia el tipo del día y el de los demás', () => {
    const before = dayTypes(liveTargets(rows(SAVED), {}, {}))
    expect(before['2026-11-01']).toBe('normal')

    // Escribir un objetivo enorme sube el promedio: los demás pasan a ser flojos.
    const live = liveTargets(rows(SAVED), { '2026-11-03': 500_000_000 }, {})
    const after = dayTypes(live)
    expect(after['2026-11-03']).toBe('strong')
    expect(after['2026-11-01']).toBe('low')
  })

  it('el cumplimiento, el acumulado y el total se mueven con lo escrito', () => {
    const base = rows(SAVED).map((row) =>
      row.day === '2026-11-01' ? { ...row, closes: 1, salonCents: MILLION } : row,
    )
    const live = liveTargets(base, { '2026-11-01': 2 * MILLION }, {})
    const projection = buildProjection(live, { serviceDay: '2026-11-04' })
    expect(projection.days[0]?.compliance).toMatchObject({ kind: 'value', percent: 50 })
    expect(projection.summary.monthTargetCents).toBe(4 * MILLION)
    expect(projection.summary.remainingCents).toBe(3 * MILLION)
  })

  it('borrar la celda deja el día sin objetivo mientras se escribe', () => {
    const live = liveTargets(rows(SAVED), { '2026-11-01': null }, {})
    expect(live[0]?.targetCents).toBeNull()
    expect(dayTypes(live)['2026-11-01']).toBe('none')
  })

  it('lo recién guardado se ve hasta que la página trae el dato nuevo', () => {
    const pending = { '2026-11-01': { from: MILLION, value: 3 * MILLION } }
    expect(savedTarget(MILLION, pending['2026-11-01'])).toBe(3 * MILLION)
    expect(liveTargets(rows(SAVED), {}, pending)[0]?.targetCents).toBe(3 * MILLION)
    // La página ya trajo otra cosa (lo guardado, u otro dueño lo cambió): manda la página.
    expect(savedTarget(2 * MILLION, pending['2026-11-01'])).toBe(2 * MILLION)
    expect(savedTarget(MILLION, undefined)).toBe(MILLION)
  })

  it('lo que se está escribiendo manda sobre lo recién guardado', () => {
    const pending = { '2026-11-01': { from: MILLION, value: 3 * MILLION } }
    const live = liveTargets(rows(SAVED), { '2026-11-01': 7 }, pending)
    expect(live[0]?.targetCents).toBe(7)
  })

  it('solo viaja lo que cambia, y pasa el esquema de la acción tal cual', () => {
    const saved = (day: string) => (SAVED as Record<string, number>)[day] ?? null
    const changes = changedTargets(
      [
        { day: '2026-11-01', targetCents: MILLION },
        { day: '2026-11-02', targetCents: 2 * MILLION },
        { day: '2026-11-03', targetCents: null },
        { day: '2026-11-04', targetCents: null },
      ],
      saved,
    )
    expect(changes.map((item) => item.day)).toEqual(['2026-11-02', '2026-11-03'])
    expect(salesTargetsSchema.parse({ items: changes }).items).toEqual(changes)
  })
})
