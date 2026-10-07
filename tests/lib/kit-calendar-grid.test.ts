// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  calendarKeyTarget,
  calendarWeeks,
  clampIsoDay,
  isOutsideRange,
  monthGridKeyTarget,
  monthHasDaysInRange,
  monthsOfYear,
  nextRangeDraft,
  rangeDayState,
  sameDayInMonth,
  visibleMonths,
  weekdayHeaders,
  weekEndOf,
  weekStartOf,
} from '@/lib/dates/calendar-grid'

/**
 * La grilla del calendario del kit (§3.2 DatePicker): semana desde el lunes,
 * los bordes de cada mes, las teclas y los rangos. Todo en strings: sin `Date`,
 * así da lo mismo en el server, en el navegador y en cualquier zona horaria.
 */

describe('calendarWeeks: el lunes primero', () => {
  it('septiembre de 2026 arranca el lunes 31/08 (el 1 es martes)', () => {
    const weeks = calendarWeeks('2026-09')
    expect(weeks).toHaveLength(6)
    expect(weeks.every((week) => week.length === 7)).toBe(true)
    expect(weeks[0]?.[0]).toEqual({ iso: '2026-08-31', day: 31, inMonth: false, weekday: 1 })
    expect(weeks[0]?.[1]).toEqual({ iso: '2026-09-01', day: 1, inMonth: true, weekday: 2 })
    // Cada fila arranca en lunes (1) y termina en domingo (0).
    for (const week of weeks) {
      expect(week[0]?.weekday).toBe(1)
      expect(week[6]?.weekday).toBe(0)
    }
  })

  it('los días del mes son exactamente los del mes, en orden', () => {
    const days = calendarWeeks('2026-09')
      .flat()
      .filter((d) => d.inMonth)
    expect(days).toHaveLength(30)
    expect(days[0]?.iso).toBe('2026-09-01')
    expect(days[29]?.iso).toBe('2026-09-30')
  })

  it('seis semanas fijas (el popover no cambia de alto); sin fijar, las justas', () => {
    expect(calendarWeeks('2026-09').flat().at(-1)?.iso).toBe('2026-10-11')
    expect(calendarWeeks('2026-09', { fixedWeeks: false })).toHaveLength(5)
    // Febrero de 2026: el 1 es domingo → 6 días de enero adelante, 5 filas justas.
    const feb = calendarWeeks('2026-02', { fixedWeeks: false })
    expect(feb).toHaveLength(5)
    expect(feb[0]?.[0]?.iso).toBe('2026-01-26')
    expect(feb[0]?.[6]).toMatchObject({ iso: '2026-02-01', inMonth: true })
  })

  it('un mes que empieza en lunes no trae días del anterior', () => {
    // 01/06/2026 es lunes.
    expect(calendarWeeks('2026-06')[0]?.[0]).toMatchObject({ iso: '2026-06-01', inMonth: true })
  })

  it('bisiestos: febrero de 2028 tiene 29 días', () => {
    const days = calendarWeeks('2028-02')
      .flat()
      .filter((d) => d.inMonth)
    expect(days).toHaveLength(29)
    expect(days.at(-1)?.iso).toBe('2028-02-29')
  })

  it('acepta un día del mes en vez del mes', () => {
    expect(calendarWeeks('2026-09-15')).toEqual(calendarWeeks('2026-09'))
  })

  it('con la semana desde el domingo, la primera columna es domingo', () => {
    const weeks = calendarWeeks('2026-09', { weekStartsOn: 0 })
    expect(weeks[0]?.[0]).toMatchObject({ iso: '2026-08-30', weekday: 0 })
  })
})

describe('weekdayHeaders', () => {
  it('«lu ma mi ju vi sá do» con el nombre completo para el lector', () => {
    const headers = weekdayHeaders()
    expect(headers.map((h) => h.short)).toEqual(['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'])
    expect(headers[0]?.long).toBe('lunes')
    expect(headers[2]?.long).toBe('miércoles')
    expect(headers[6]?.long).toBe('domingo')
  })

  it('desde el domingo si se pide', () => {
    expect(weekdayHeaders(0)[0]?.short).toBe('do')
  })
})

describe('calendarKeyTarget: las teclas de la grilla', () => {
  it('← → ±1 día, cruzando el mes', () => {
    expect(calendarKeyTarget('2026-09-01', 'ArrowLeft')).toBe('2026-08-31')
    expect(calendarKeyTarget('2026-09-30', 'ArrowRight')).toBe('2026-10-01')
  })

  it('↑ ↓ ±7 días', () => {
    expect(calendarKeyTarget('2026-09-15', 'ArrowUp')).toBe('2026-09-08')
    expect(calendarKeyTarget('2026-09-28', 'ArrowDown')).toBe('2026-10-05')
  })

  it('Inicio y Fin: lunes y domingo de la semana', () => {
    // 16/09/2026 es miércoles.
    expect(calendarKeyTarget('2026-09-16', 'Home')).toBe('2026-09-14')
    expect(calendarKeyTarget('2026-09-16', 'End')).toBe('2026-09-20')
    expect(weekStartOf('2026-09-20')).toBe('2026-09-14')
    expect(weekEndOf('2026-09-14')).toBe('2026-09-20')
  })

  it('RePág y AvPág ±1 mes, recortando el día al último del mes', () => {
    expect(calendarKeyTarget('2026-03-31', 'PageUp')).toBe('2026-02-28')
    expect(calendarKeyTarget('2026-01-31', 'PageDown')).toBe('2026-02-28')
  })

  it('con Mayús, ±1 año', () => {
    expect(calendarKeyTarget('2028-02-29', 'PageDown', { shiftKey: true })).toBe('2029-02-28')
    expect(calendarKeyTarget('2026-09-15', 'PageUp', { shiftKey: true })).toBe('2025-09-15')
  })

  it('una tecla que no es de la grilla da null', () => {
    expect(calendarKeyTarget('2026-09-15', 'Enter')).toBeNull()
    expect(calendarKeyTarget('2026-09-15', 'a')).toBeNull()
  })
})

describe('bordes: mínimo y máximo', () => {
  it('clampIsoDay e isOutsideRange', () => {
    expect(clampIsoDay('2026-08-20', '2026-09-01', '2026-09-30')).toBe('2026-09-01')
    expect(clampIsoDay('2026-10-02', '2026-09-01', '2026-09-30')).toBe('2026-09-30')
    expect(clampIsoDay('2026-09-15', null, undefined)).toBe('2026-09-15')
    expect(isOutsideRange('2026-08-31', '2026-09-01')).toBe(true)
    expect(isOutsideRange('2026-09-01', '2026-09-01', '2026-09-01')).toBe(false)
  })

  it('sameDayInMonth: el foco va al mismo día del mes nuevo, recortado', () => {
    expect(sameDayInMonth('2026-01-31', '2026-02')).toBe('2026-02-28')
    expect(sameDayInMonth('2026-09-15', '2026-10')).toBe('2026-10-15')
    expect(sameDayInMonth('2026-09-15', '2026-10', { max: '2026-10-10' })).toBe('2026-10-10')
  })

  it('monthHasDaysInRange apaga «Mes anterior» y «Mes siguiente»', () => {
    expect(monthHasDaysInRange('2026-08', '2026-09-01')).toBe(false)
    expect(monthHasDaysInRange('2026-09', '2026-09-30')).toBe(true)
    expect(monthHasDaysInRange('2026-11', null, '2026-10-31')).toBe(false)
  })

  it('visibleMonths: uno o dos, cruzando el año', () => {
    expect(visibleMonths('2026-12', 2)).toEqual(['2026-12', '2027-01'])
    expect(visibleMonths('2026-12-05', 1)).toEqual(['2026-12'])
  })
})

describe('grilla de meses (PeriodPicker)', () => {
  it('los 12 meses del año', () => {
    const months = monthsOfYear(2026)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2026-01')
    expect(months[11]).toBe('2026-12')
  })

  it('teclas en 4 columnas, cruzando el año', () => {
    expect(monthGridKeyTarget('2026-10', 'ArrowDown')).toBe('2027-02')
    expect(monthGridKeyTarget('2026-02', 'ArrowUp')).toBe('2025-10')
    expect(monthGridKeyTarget('2026-01', 'ArrowLeft')).toBe('2025-12')
    expect(monthGridKeyTarget('2026-05', 'Home')).toBe('2026-01')
    expect(monthGridKeyTarget('2026-05', 'End')).toBe('2026-12')
    expect(monthGridKeyTarget('2026-05', 'PageUp')).toBe('2025-05')
    expect(monthGridKeyTarget('2026-05', 'Tab')).toBeNull()
  })
})

describe('rangos', () => {
  it('dos toques: arranca y cierra; para atrás da vuelta los bordes; un tercero arranca otro', () => {
    let draft = nextRangeDraft({ from: null, to: null }, '2026-09-10')
    expect(draft).toEqual({ from: '2026-09-10', to: null })
    draft = nextRangeDraft(draft, '2026-09-03')
    expect(draft).toEqual({ from: '2026-09-03', to: '2026-09-10' })
    draft = nextRangeDraft(draft, '2026-09-20')
    expect(draft).toEqual({ from: '2026-09-20', to: null })
  })

  it('rangeDayState: inicio, fin, adentro y un solo día', () => {
    const range = { from: '2026-09-03', to: '2026-09-10' }
    expect(rangeDayState('2026-09-03', range)).toBe('start')
    expect(rangeDayState('2026-09-10', range)).toBe('end')
    expect(rangeDayState('2026-09-05', range)).toBe('inside')
    expect(rangeDayState('2026-09-11', range)).toBeNull()
    expect(rangeDayState('2026-09-03', { from: '2026-09-03', to: '2026-09-03' })).toBe('single')
    expect(rangeDayState('2026-09-03', { from: null, to: null })).toBeNull()
  })

  it('a medio elegir, el día bajo el mouse hace de segundo borde (también para atrás)', () => {
    const half = { from: '2026-09-10', to: null }
    expect(rangeDayState('2026-09-10', half)).toBe('single')
    expect(rangeDayState('2026-09-12', half, '2026-09-14')).toBe('inside')
    expect(rangeDayState('2026-09-07', half, '2026-09-07')).toBe('start')
    expect(rangeDayState('2026-09-10', half, '2026-09-07')).toBe('end')
  })
})
