// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type Period, periodPresets, presetPeriod } from '@/lib/dates/period'
import {
  anchorMonthOf,
  canShiftPeriod,
  fiscalYearChoices,
  isClosedMonth,
  isMonthInBounds,
  periodHref,
  periodInlineLabel,
  periodStepLabel,
  periodTouchesBounds,
  shiftYearMonth,
} from '@/lib/dates/period-picker'

/**
 * PeriodPicker del kit (§3.2): los links del modo URL, las etiquetas de las
 * flechas, los atajos y qué se puede elegir adentro de los bordes. El resto
 * del período (serializar, leer, correr) lo prueban los tests de lib/dates.
 */

const TODAY = '2026-10-06' // martes
const september: Period = { kind: 'month', month: '2026-09' }

describe('modo link', () => {
  it('arma la URL actual con ?periodo= y conserva el resto', () => {
    expect(periodHref('/hub/libros', 'tab=iva', 'periodo', september)).toBe(
      '/hub/libros?tab=iva&periodo=2026-09',
    )
    expect(periodHref('/hub/libros', '?tab=iva&periodo=2026-08', 'periodo', september)).toBe(
      '/hub/libros?tab=iva&periodo=2026-09',
    )
    expect(periodHref('/hub/libros', '', 'periodo', { kind: 'fiscal-year', year: 2026 })).toBe(
      '/hub/libros?periodo=ej-2026',
    )
    expect(
      periodHref('/hub/libros', null, 'periodo', {
        kind: 'range',
        from: '2026-09-01',
        to: '2026-09-15',
      }),
    ).toBe('/hub/libros?periodo=2026-09-01..2026-09-15')
  })

  it('acepta los searchParams tal cual', () => {
    const params = new URLSearchParams('q=coca&page=2')
    expect(periodHref('/hub/compras', params, 'periodo', september)).toBe(
      '/hub/compras?q=coca&page=2&periodo=2026-09',
    )
  })
})

describe('etiquetas de las flechas', () => {
  it('«Período anterior: agosto 2026» y «Período siguiente: octubre 2026»', () => {
    expect(periodStepLabel(september, -1)).toBe('Período anterior: agosto 2026')
    expect(periodStepLabel(september, 1)).toBe('Período siguiente: octubre 2026')
  })

  it('cada clase con su etiqueta adentro de la frase', () => {
    expect(periodInlineLabel({ kind: 'day', date: '2026-09-15' })).toBe('15/09/2026')
    expect(periodInlineLabel({ kind: 'fiscal-year', year: 2026 })).toBe('ejercicio 2026')
    expect(
      periodInlineLabel({ kind: 'fiscal-year', year: 2026 }, { fiscalYearStartMonth: 7 }),
    ).toBe('ejercicio 2026/27')
    expect(periodStepLabel({ kind: 'day', date: '2026-09-01' }, -1)).toBe(
      'Período anterior: 31/08/2026',
    )
  })
})

describe('bordes', () => {
  it('canShiftPeriod no deja salir de [min, max]', () => {
    const bounds = { min: '2026-09-01', max: TODAY }
    expect(canShiftPeriod(september, -1, bounds)).toBe(false)
    expect(canShiftPeriod(september, 1, bounds)).toBe(true)
    expect(canShiftPeriod({ kind: 'month', month: '2026-10' }, 1, bounds)).toBe(false)
    expect(canShiftPeriod(september, -1, {})).toBe(true)
  })

  it('un período toca los bordes si algún día suyo queda adentro', () => {
    expect(periodTouchesBounds(september, { min: '2026-09-30' })).toBe(true)
    expect(periodTouchesBounds(september, { min: '2026-10-01' })).toBe(false)
  })

  it('meses: adentro de los bordes y cerrados', () => {
    expect(isMonthInBounds('2026-08', { min: '2026-09-01' })).toBe(false)
    expect(isMonthInBounds('2026-09', { min: '2026-09-15', max: '2026-09-15' })).toBe(true)
    expect(isMonthInBounds('2026-11', { max: TODAY })).toBe(false)
    expect(isClosedMonth('2026-09', ['2026-08', '2026-09'])).toBe(true)
    expect(isClosedMonth('2026-09-15', ['2026-09'])).toBe(true)
    expect(isClosedMonth('2026-10', ['2026-09'])).toBe(false)
    expect(isClosedMonth('2026-10', undefined)).toBe(false)
  })
})

describe('ejercicios', () => {
  it('el en curso y los anteriores, del más nuevo al más viejo', () => {
    expect(fiscalYearChoices({ today: TODAY })).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(fiscalYearChoices({ today: TODAY, count: 2 })).toEqual([2026, 2025])
  })

  it('sin los que quedan enteros antes del inicio de los libros', () => {
    expect(fiscalYearChoices({ today: TODAY, min: '2025-03-01' })).toEqual([2026, 2025])
  })

  it('con el ejercicio que empieza en julio, octubre de 2026 es el ejercicio 2026', () => {
    expect(fiscalYearChoices({ today: TODAY, fiscalYearStartMonth: 7, count: 2 })).toEqual([
      2026, 2025,
    ])
    expect(fiscalYearChoices({ today: '2026-03-10', fiscalYearStartMonth: 7, count: 1 })).toEqual([
      2025,
    ])
  })
})

describe('atajos', () => {
  it('los del kit, en su orden', () => {
    expect(periodPresets({ today: TODAY }).map((p) => p.label)).toEqual([
      'Hoy',
      'Ayer',
      'Esta semana',
      'Semana pasada',
      'Este mes',
      'Mes pasado',
      'Últimos 30 días',
      'Este ejercicio',
      'Ejercicio anterior',
    ])
  })

  it('solo los de las clases que el picker ofrece', () => {
    expect(periodPresets({ today: TODAY, kinds: ['month'] }).map((p) => p.label)).toEqual([
      'Este mes',
      'Mes pasado',
    ])
  })

  it('la semana va de lunes a domingo y los últimos 30 días incluyen hoy', () => {
    expect(presetPeriod('esta-semana', { today: TODAY })).toEqual({
      kind: 'range',
      from: '2026-10-05',
      to: '2026-10-11',
    })
    expect(presetPeriod('semana-pasada', { today: TODAY })).toEqual({
      kind: 'range',
      from: '2026-09-28',
      to: '2026-10-04',
    })
    expect(presetPeriod('ultimos-30-dias', { today: TODAY })).toEqual({
      kind: 'range',
      from: '2026-09-07',
      to: TODAY,
    })
    expect(presetPeriod('mes-pasado', { today: TODAY })).toEqual(september)
  })

  it('«Este ejercicio» respeta el mes de inicio', () => {
    expect(
      presetPeriod('este-ejercicio', { today: '2026-03-10', fiscalYearStartMonth: 7 }),
    ).toEqual({ kind: 'fiscal-year', year: 2025 })
  })
})

describe('qué mes muestra la grilla al abrir', () => {
  it('el del inicio del período, o el de hoy', () => {
    expect(anchorMonthOf(september, TODAY)).toBe('2026-09')
    expect(anchorMonthOf({ kind: 'fiscal-year', year: 2025 }, TODAY)).toBe('2025-01')
    expect(anchorMonthOf(null, TODAY)).toBe('2026-10')
    expect(shiftYearMonth('2026-09', -1)).toBe('2025-09')
  })
})
