import { describe, expect, it } from 'vitest'
import { parseTargetsList } from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/targets-import'
import { copyMonthTargets, type TargetOfDay } from '@/lib/accounting/projection'
import { salesTargetsSchema } from '@/lib/accounting/projection-schemas'
import { eachIsoDay, weekdayOf } from '@/lib/dates'

/**
 * Las dos maneras de llenar un mes sin escribirlo: «Copiar <mes pasado>», por día de la semana y
 * número de semana, y pegar una columna en una celda, que reparte hacia abajo desde ese día.
 */

/** Octubre con un objetivo distinto cada día: día 1 → $ 1.000, día 2 → $ 2.000… */
const OCTOBER: TargetOfDay[] = eachIsoDay('2026-10-01', '2026-10-31').map((day) => ({
  day,
  targetCents: Number(day.slice(8, 10)) * 100_000,
}))

const copied = (
  items: ReadonlyArray<{ day: string; targetCents: number }>,
  day: string,
): number | undefined => items.find((item) => item.day === day)?.targetCents

describe('copyMonthTargets: por día de la semana y número de semana', () => {
  const items = copyMonthTargets({ month: '2026-11', fromMonth: '2026-10', targets: OCTOBER })

  it('copia los 30 días de noviembre', () => {
    expect(items).toHaveLength(30)
    expect(items[0]?.day).toBe('2026-11-01')
    expect(items.at(-1)?.day).toBe('2026-11-30')
  })

  it('el primer domingo toma el del primer domingo; el primer lunes, el del primer lunes', () => {
    // Domingo 1/11 ← domingo 4/10. Lunes 2/11 ← lunes 5/10.
    expect(weekdayOf('2026-11-01')).toBe(0)
    expect(weekdayOf('2026-10-04')).toBe(0)
    expect(copied(items, '2026-11-01')).toBe(400_000)
    expect(copied(items, '2026-11-02')).toBe(500_000)
  })

  it('cada día queda con el objetivo de uno del mismo día de la semana', () => {
    for (const item of items) {
      const fromDay = item.targetCents / 100_000
      const from = `2026-10-${String(fromDay).padStart(2, '0')}`
      expect(weekdayOf(from), item.day).toBe(weekdayOf(item.day))
    }
  })

  it('un quinto día que el mes pasado no tuvo toma el último de ese día de la semana', () => {
    // Noviembre de 2026 tiene cinco lunes (2, 9, 16, 23 y 30); octubre, cuatro (5, 12, 19 y 26).
    expect(copied(items, '2026-11-30')).toBe(2_600_000)
    // Noviembre tiene cinco domingos (1, 8, 15, 22 y 29) y octubre, cuatro (4, 11, 18 y 25).
    expect(copied(items, '2026-11-29')).toBe(2_500_000)
    // Octubre sí tuvo cinco jueves: el cuarto jueves de noviembre es el 26, y toma el 22.
    expect(copied(items, '2026-11-26')).toBe(2_200_000)
  })

  it('un día sin objetivo en el mes de origen no copia nada y no borra lo que haya', () => {
    const targets = OCTOBER.map((t) => (weekdayOf(t.day) === 1 ? { ...t, targetCents: null } : t))
    const out = copyMonthTargets({ month: '2026-11', fromMonth: '2026-10', targets })
    expect(out.some((item) => weekdayOf(item.day) === 1)).toBe(false)
    expect(out).toHaveLength(25)
  })

  it('un objetivo en cero tampoco se copia', () => {
    const out = copyMonthTargets({
      month: '2026-11',
      fromMonth: '2026-10',
      targets: [{ day: '2026-10-04', targetCents: 0 }],
    })
    expect(out).toEqual([])
  })

  it('de diciembre a enero cruza el año', () => {
    const december = eachIsoDay('2026-12-01', '2026-12-31').map((day) => ({
      day,
      targetCents: 100,
    }))
    const out = copyMonthTargets({ month: '2027-01', fromMonth: '2026-12', targets: december })
    expect(out).toHaveLength(31)
    expect(out[0]?.day).toBe('2027-01-01')
  })

  it('febrero, de 28 días, se copia entero a marzo y viceversa', () => {
    const february = eachIsoDay('2027-02-01', '2027-02-28').map((day) => ({
      day,
      targetCents: 100,
    }))
    expect(
      copyMonthTargets({ month: '2027-03', fromMonth: '2027-02', targets: february }),
    ).toHaveLength(31)
    const march = eachIsoDay('2027-03-01', '2027-03-31').map((day) => ({ day, targetCents: 100 }))
    expect(
      copyMonthTargets({ month: '2027-02', fromMonth: '2027-03', targets: march }),
    ).toHaveLength(28)
  })

  it('sin objetivos, o con un mes que no existe, no copia nada', () => {
    expect(copyMonthTargets({ month: '2026-11', fromMonth: '2026-10', targets: [] })).toEqual([])
    expect(copyMonthTargets({ month: '2026-13', fromMonth: '2026-10', targets: OCTOBER })).toEqual(
      [],
    )
    expect(copyMonthTargets({ month: '2026-11', fromMonth: 'octubre', targets: OCTOBER })).toEqual(
      [],
    )
  })

  it('lo copiado pasa el esquema de la acción tal cual', () => {
    expect(salesTargetsSchema.parse({ items }).items).toHaveLength(30)
  })
})

describe('pegar una columna en una celda: reparte hacia abajo desde ese día', () => {
  const column = '1.200.000\n1.800.000\n\n2.500.000'

  it('el primer renglón es el día de la celda', () => {
    const parsed = parseTargetsList(column, '2026-11', { fromDay: 10 })
    expect(parsed.items).toEqual([
      { day: '2026-11-10', targetCents: 120_000_000 },
      { day: '2026-11-11', targetCents: 180_000_000 },
      { day: '2026-11-12', targetCents: null },
      { day: '2026-11-13', targetCents: 250_000_000 },
    ])
  })

  it('sin decir desde dónde, arranca en el día 1 (lo de «Pegar una lista»)', () => {
    expect(parseTargetsList(column, '2026-11').items[0]?.day).toBe('2026-11-01')
    expect(parseTargetsList(column, '2026-11', { fromDay: 1 }).items[0]?.day).toBe('2026-11-01')
  })

  it('lo que no entra en el mes desde esa celda se cuenta aparte, no pisa nada', () => {
    const parsed = parseTargetsList('100\n200\n300\n400', '2026-11', { fromDay: 29 })
    expect(parsed.items.map((item) => item.day)).toEqual(['2026-11-29', '2026-11-30'])
    expect(parsed.overflow).toBe(2)
  })

  it('el título de la columna se saltea también pegando en una celda', () => {
    const parsed = parseTargetsList('Objetivo\n100\n200', '2026-11', { fromDay: 5 })
    expect(parsed.headerSkipped).toBe(true)
    expect(parsed.items[0]?.day).toBe('2026-11-05')
    expect(parsed.items).toHaveLength(2)
  })

  it('lo que no se entiende queda como estaba y se avisa', () => {
    const parsed = parseTargetsList('100\nhola\n300', '2026-11', { fromDay: 5 })
    expect(parsed.items.map((item) => item.day)).toEqual(['2026-11-05', '2026-11-07'])
    expect(parsed.invalid[0]).toMatchObject({ line: 2, day: '2026-11-06', text: 'hola' })
  })
})
