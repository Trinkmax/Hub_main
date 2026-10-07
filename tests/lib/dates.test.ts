import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  addMonths,
  addMonthsToYearMonth,
  CORDOBA_TZ,
  civilFromDays,
  clampRange,
  compareIsoDays,
  cordobaDateTime,
  cordobaDayStartUtc,
  cordobaWallTimeToUtc,
  DATE_INPUT_MESSAGES,
  DEFAULT_PERIOD_PRESET_KEYS,
  daysBetween,
  daysFromCivil,
  daysInMonth,
  eachIsoDay,
  endOfMonth,
  endOfWeek,
  fiscalYearEndOnOrAfter,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearRange,
  fiscalYearStartMonthFromEndMonth,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatIsoDay,
  formatLongDate,
  formatMonthLabel,
  formatMonthYear,
  formatRange,
  formatTime,
  formatWeekdayDayMonth,
  isLeapYear,
  isoDayInCordoba,
  isoDayToLocalNoon,
  isRealIsoDay,
  isRealYearMonth,
  isSamePeriod,
  localDateToIsoDay,
  matchPeriodPreset,
  minutesToTime,
  monthName,
  monthOf,
  monthRange,
  nowInCordoba,
  type Period,
  parseDateInput,
  parseIsoDay,
  parsePeriod,
  parseTimeInput,
  periodBoundsUtc,
  periodContains,
  periodDays,
  periodErrorMessage,
  periodLabel,
  periodPresets,
  periodRange,
  presetPeriod,
  readDateValue,
  resolvePeriod,
  SERVICE_DAY_ROLLOVER_HOUR,
  serializePeriod,
  serviceDayInCordoba,
  shiftPeriod,
  shiftTime,
  startOfMonth,
  startOfWeek,
  TIME_INPUT_MESSAGE,
  timeInCordoba,
  timeToMinutes,
  todayInCordoba,
  WEEKDAY_NAMES_MIN,
  weekdayOf,
} from '@/lib/dates'
import * as periodModule from '@/lib/dates/period'
import * as presets from '@/lib/salon/date-presets'
import { weekdayDayMonth } from '@/lib/salon/event-marketing'
import { serviceDayInCordoba as legacyServiceDay } from '@/lib/salon/operativo'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// ─── Días civiles ────────────────────────────────────────────────────────────

describe('calendario civil', () => {
  it('bisiestos y días del mes', () => {
    expect([2024, 2000, 1900, 2026, 2100].map(isLeapYear)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('isRealIsoDay da lo mismo que el de date-presets (sin pasar por Date)', () => {
    const cases: string[] = ['', '2026-9-1', '2026-09-15T00:00', '20260915', 'hoy']
    for (const y of ['0000', '1899', '1900', '2026', '2028', '2100', '2199', '2200']) {
      for (let m = 0; m <= 13; m++) {
        for (let d = 0; d <= 32; d++) {
          cases.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
        }
      }
    }
    for (const iso of cases) expect(isRealIsoDay(iso)).toBe(presets.isRealIsoDay(iso))
    expect(isRealIsoDay(20260915)).toBe(false)
  })

  it('isRealYearMonth y parseIsoDay', () => {
    expect(isRealYearMonth('2026-09')).toBe(true)
    expect(isRealYearMonth('2026-13')).toBe(false)
    expect(isRealYearMonth('1899-12')).toBe(false)
    expect(isRealYearMonth('2026-09-01')).toBe(false)
    expect(parseIsoDay('2026-09-15')).toEqual({ year: 2026, month: 9, day: 15 })
    expect(parseIsoDay('2026-02-29')).toBeNull()
  })

  it('días civiles coinciden con Date.UTC en todo 1900–2199', () => {
    const start = daysFromCivil(1900, 1, 1)
    const end = daysFromCivil(2199, 12, 31)
    expect(start).toBe(Date.UTC(1900, 0, 1) / DAY)
    // Junta las diferencias y compara una vez: un `expect` por día tarda segundos.
    const mismatches: number[] = []
    for (let n = start; n <= end; n++) {
      const date = new Date(n * DAY)
      const civil = civilFromDays(n)
      if (
        civil.year !== date.getUTCFullYear() ||
        civil.month !== date.getUTCMonth() + 1 ||
        civil.day !== date.getUTCDate() ||
        daysFromCivil(civil.year, civil.month, civil.day) !== n
      ) {
        mismatches.push(n)
      }
    }
    expect(mismatches).toEqual([])
    expect(end - start + 1).toBe(109_573)
  })

  it('addDays cruza meses, años y bisiestos', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-10-06', 365)).toBe('2027-10-06')
  })

  it('addMonths recorta al último día del mes de llegada', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15')
  })

  it('daysBetween, compareIsoDays, min y max', () => {
    expect(daysBetween('2026-10-01', '2026-10-06')).toBe(5)
    expect(daysBetween('2026-10-06', '2026-10-01')).toBe(-5)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(['2026-10-06', '2025-12-31', '2026-01-15'].sort(compareIsoDays)).toEqual([
      '2025-12-31',
      '2026-01-15',
      '2026-10-06',
    ])
  })

  it('semana de lunes a domingo', () => {
    expect(weekdayOf('2026-09-15')).toBe(2)
    expect(weekdayOf('1970-01-01')).toBe(4)
    expect(weekdayOf('1969-12-31')).toBe(3)
    // Los mismos casos que thisWeek de date-presets: viernes 31/07/2026.
    expect(startOfWeek('2026-07-31')).toBe('2026-07-27')
    expect(endOfWeek('2026-07-31')).toBe('2026-08-02')
    expect(startOfWeek('2026-07-27')).toBe('2026-07-27')
    expect(startOfWeek('2026-08-02')).toBe('2026-07-27')
  })

  it('meses', () => {
    expect(monthOf('2026-09-15')).toBe('2026-09')
    expect(startOfMonth('2026-09-15')).toBe('2026-09-01')
    expect(endOfMonth('2026-02')).toBe('2026-02-28')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(addMonthsToYearMonth('2026-11', 2)).toBe('2027-01')
    expect(addMonthsToYearMonth('2026-01', -1)).toBe('2025-12')
    expect(addMonthsToYearMonth('2026-01', -13)).toBe('2024-12')
  })

  it('eachIsoDay es inclusivo y tiene tope', () => {
    expect(eachIsoDay('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
    expect(eachIsoDay('2026-01-01', '2030-01-01', 10)).toHaveLength(10)
    expect(eachIsoDay('2026-03-02', '2026-03-01')).toEqual([])
  })

  it('una fecha que no existe no se calcula: tira RangeError', () => {
    expect(() => addDays('2026-02-31', 1)).toThrow(RangeError)
    expect(() => endOfMonth('2026-13')).toThrow(RangeError)
    expect(() => monthOf('15/09/2026')).toThrow(RangeError)
  })

  it('horas del día', () => {
    expect(timeToMinutes('21:30')).toBe(1290)
    expect(timeToMinutes('21:30:00')).toBe(1290)
    expect(timeToMinutes('24:00')).toBeNull()
    expect(timeToMinutes('9:30')).toBeNull()
    expect(minutesToTime(1290)).toBe('21:30')
    expect(minutesToTime(1500)).toBe('01:00')
    expect(minutesToTime(-30)).toBe('23:30')
    expect(shiftTime('23:45', 30)).toBe('00:15')
    expect(shiftTime('xx', 5)).toBeNull()
  })
})

// ─── Córdoba ─────────────────────────────────────────────────────────────────

describe('hora de Córdoba', () => {
  it('los casos de date-presets', () => {
    expect(todayInCordoba(new Date('2026-08-01T01:30:00.000Z'))).toBe('2026-07-31')
    expect(todayInCordoba(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-08-01')
    expect(todayInCordoba(Date.UTC(2026, 7, 1, 2, 59, 59, 999))).toBe('2026-07-31')
  })

  it('da lo mismo que date-fns-tz para cada hora de 2026 y para instantes al azar hasta 2100', () => {
    const instants: number[] = []
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += HOUR) instants.push(t)
    let seed = 7
    for (let i = 0; i < 3000; i++) {
      seed = (seed * 48271) % 2147483647
      const from = Date.UTC(2009, 2, 15, 2)
      instants.push(from + Math.floor((seed / 2147483647) * (Date.UTC(2100, 0, 1) - from)))
    }
    for (const t of instants) {
      const parts = cordobaDateTime(t)
      expect(parts?.date).toBe(formatInTimeZone(t, CORDOBA_TZ, 'yyyy-MM-dd'))
      expect(parts?.time).toBe(formatInTimeZone(t, CORDOBA_TZ, 'HH:mm'))
      expect(todayInCordoba(t)).toBe(presets.todayInCordoba(new Date(t)))
    }
  })

  it('antes de 2009 respeta el horario de verano de la época (2007-08 y 2008-09)', () => {
    for (const iso of [
      '2008-01-15T12:00:00Z',
      '2008-03-16T01:59:00Z',
      '2008-03-16T02:00:00Z',
      '2008-10-19T02:59:00Z',
      '2008-10-19T03:00:00Z',
      '2009-03-15T01:59:00Z',
      '2009-03-15T02:00:00Z',
      '1995-06-01T12:00:00Z',
    ]) {
      const parts = cordobaDateTime(iso)
      expect(`${parts?.date} ${parts?.time}`).toBe(
        formatInTimeZone(new Date(iso), CORDOBA_TZ, 'yyyy-MM-dd HH:mm'),
      )
    }
  })

  it('lee timestamps de PostgREST, de Postgres y con offset', () => {
    for (const value of [
      '2026-09-10T17:32:00Z',
      '2026-09-10T17:32:00.123456+00:00',
      '2026-09-10 17:32:00+00',
      '2026-09-10T14:32:00-03:00',
      '2026-09-10T14:32:00-0300',
      new Date('2026-09-10T17:32:00Z'),
      Date.UTC(2026, 8, 10, 17, 32),
    ]) {
      expect(isoDayInCordoba(value)).toBe('2026-09-10')
      expect(timeInCordoba(value)).toBe('14:32')
    }
  })

  it('sin zona es hora de reloj de Córdoba; un date civil no tiene hora', () => {
    expect(cordobaDateTime('2026-09-10T21:30')).toMatchObject({ date: '2026-09-10', time: '21:30' })
    expect(readDateValue('2026-09-10')).toEqual({ kind: 'day', date: '2026-09-10' })
    expect(cordobaDateTime('2026-09-10')).toBeNull()
    expect(isoDayInCordoba('2026-09-10')).toBeNull()
  })

  it('lo que no se lee da null', () => {
    for (const value of ['basura', '2026-02-31T10:00:00Z', '2026-09-10T25:00:00Z', '', null]) {
      expect(cordobaDateTime(value)).toBeNull()
    }
    expect(cordobaDateTime(new Date(Number.NaN))).toBeNull()
    expect(() => todayInCordoba(new Date(Number.NaN))).toThrow(RangeError)
  })

  it('cordobaDayStartUtc da lo mismo que date-presets en cada día de 2009 a 2030', () => {
    for (const iso of eachIsoDay('2009-03-15', '2030-12-31', 10_000)) {
      expect(cordobaDayStartUtc(iso)).toBe(presets.cordobaDayStartUtc(iso))
    }
    // Antes de 2009, con el offset de la época (días sin cambio de hora).
    for (const iso of ['2008-01-15', '2008-12-01', '1995-06-01', '2009-03-14']) {
      expect(cordobaDayStartUtc(iso)).toBe(
        fromZonedTime(`${iso}T00:00:00`, CORDOBA_TZ).toISOString(),
      )
    }
  })

  it('cordobaWallTimeToUtc', () => {
    expect(cordobaWallTimeToUtc('2026-09-15', '21:30')).toBe('2026-09-16T00:30:00.000Z')
    expect(cordobaWallTimeToUtc('2026-09-15')).toBe('2026-09-15T03:00:00.000Z')
    expect(() => cordobaWallTimeToUtc('2026-09-15', '25:00')).toThrow(RangeError)
    expect(() => cordobaWallTimeToUtc('2026-02-31', '10:00')).toThrow(RangeError)
  })

  it('día de servicio: hasta las 5 AM es la noche anterior (igual que operativo.ts)', () => {
    expect(SERVICE_DAY_ROLLOVER_HOUR).toBe(5)
    expect(serviceDayInCordoba(new Date('2026-09-13T07:59:00Z'))).toBe('2026-09-12')
    expect(serviceDayInCordoba(new Date('2026-09-13T08:00:00Z'))).toBe('2026-09-13')
    for (let t = Date.UTC(2026, 8, 12); t < Date.UTC(2026, 8, 15); t += 15 * 60_000) {
      expect(serviceDayInCordoba(t)).toBe(legacyServiceDay(new Date(t)))
    }
    // Con otro corte: 02:30 en Córdoba sigue siendo la noche anterior; 03:30 ya no.
    expect(serviceDayInCordoba(new Date('2026-09-13T05:30:00Z'), 3)).toBe('2026-09-12')
    expect(serviceDayInCordoba(new Date('2026-09-13T06:30:00Z'), 3)).toBe('2026-09-13')
  })

  it('nowInCordoba trae todos los campos', () => {
    expect(nowInCordoba(new Date('2026-10-06T23:15:42Z'))).toEqual({
      date: '2026-10-06',
      time: '20:15',
      year: 2026,
      month: 10,
      day: 6,
      hour: 20,
      minute: 15,
      second: 42,
    })
  })
})

// ─── Formato ─────────────────────────────────────────────────────────────────

describe('formato de fechas', () => {
  it('formatIsoDay corta el string y no acepta timestamps', () => {
    expect(formatIsoDay('2026-09-15')).toBe('15/09/2026')
    expect(formatIsoDay(null)).toBe('')
    expect(formatIsoDay('2026-09-15T00:00:00Z')).toBe('')
    expect(formatDayMonth('2026-09-09')).toBe('09/09')
  })

  it('formatDate: un date civil no se corre; un instante va al día de Córdoba', () => {
    expect(formatDate('2026-09-15')).toBe('15/09/2026')
    expect(formatDate('2026-08-01T01:30:00Z')).toBe('31/07/2026')
    expect(formatDate(new Date('2026-08-01T03:00:00Z'))).toBe('01/08/2026')
    expect(formatDate(Date.UTC(2026, 7, 1, 3))).toBe('01/08/2026')
    expect(formatDate('2026-09-10T21:30')).toBe('10/09/2026')
    expect(formatDate('nada')).toBe('')
    expect(formatDate(undefined)).toBe('')
  })

  it('formatDateTime: dd/MM/yyyy HH:mm en Córdoba, sin inventar horas', () => {
    expect(formatDateTime('2026-09-10T17:32:00Z')).toBe('10/09/2026 14:32')
    expect(formatDateTime('2026-09-10T02:05:00.000+00:00')).toBe('09/09/2026 23:05')
    expect(formatDateTime('2026-09-10T21:30')).toBe('10/09/2026 21:30')
    expect(formatDateTime('2026-09-10')).toBe('10/09/2026')
    expect(formatDateTime(null)).toBe('')
    expect(formatTime('2026-09-10T17:32:00Z')).toBe('14:32')
    expect(formatTime('2026-09-10')).toBe('')
  })

  it('nombres en castellano escritos a mano', () => {
    expect(monthName(9)).toBe('septiembre')
    expect(monthName(13)).toBe('')
    expect(formatLongDate('2026-09-15')).toBe('martes 15 de septiembre de 2026')
    expect(formatLongDate('2026-10-01')).toBe('jueves 1 de octubre de 2026')
    expect(formatLongDate('2026-02-31')).toBe('')
    expect(formatMonthYear('2026-09')).toBe('septiembre de 2026')
    expect(formatMonthYear('2026-09-15')).toBe('septiembre de 2026')
    expect(formatMonthYear('2026-13')).toBe('')
    expect(formatMonthLabel('2026-09')).toBe('Septiembre 2026')
    expect(formatMonthLabel('2026-02-31')).toBe('')
    // El calendario arranca el lunes: «lu ma mi ju vi sá do».
    expect([1, 2, 3, 4, 5, 6, 0].map((i) => WEEKDAY_NAMES_MIN[i]).join(' ')).toBe(
      'lu ma mi ju vi sá do',
    )
  })

  it('formatWeekdayDayMonth da lo mismo que weekdayDayMonth de «Cómo nos fue»', () => {
    expect(formatWeekdayDayMonth('2026-09-09')).toBe('mié 09/09')
    for (const iso of eachIsoDay('2026-01-01', '2026-12-31', 400)) {
      expect(formatWeekdayDayMonth(iso)).toBe(weekdayDayMonth(iso))
    }
  })

  it('formatRange', () => {
    expect(formatRange('2026-09-15', '2026-09-15')).toBe('15/09/2026')
    expect(formatRange('2026-09-01', '2026-09-30')).toBe('01/09 – 30/09/2026')
    expect(formatRange('2026-12-28', '2027-01-03')).toBe('28/12/2026 – 03/01/2027')
  })
})

// ─── Lo que se tipea ─────────────────────────────────────────────────────────

describe('parseDateInput', () => {
  const today = '2026-10-06'
  const accepted: Array<[string, string]> = [
    ['15/9', '2026-09-15'],
    ['15/9/26', '2026-09-15'],
    ['15/09/2026', '2026-09-15'],
    ['15-09-2026', '2026-09-15'],
    ['15.09.2026', '2026-09-15'],
    ['2026-09-15', '2026-09-15'],
    ['15092026', '2026-09-15'],
    ['1509', '2026-09-15'],
    ['150926', '2026-09-15'],
    [' 1/2/2028 ', '2028-02-01'],
    ['29/02/2028', '2028-02-29'],
    // Dos cifras: lo que caería más de 20 años adelante es del siglo pasado.
    ['15/9/85', '1985-09-15'],
    ['15/9/46', '2046-09-15'],
    ['15/9/47', '1947-09-15'],
  ]

  it.each(accepted)('%j → %s', (text, iso) => {
    expect(parseDateInput(text, { today })).toEqual({ ok: true, iso })
  })

  it('errores', () => {
    expect(parseDateInput('', { today })).toEqual({ ok: false, reason: 'vacio' })
    expect(parseDateInput('mañana', { today })).toEqual({ ok: false, reason: 'ilegible' })
    expect(parseDateInput('15/9/2026/1', { today })).toEqual({ ok: false, reason: 'ilegible' })
    expect(parseDateInput('31/02', { today })).toEqual({ ok: false, reason: 'inexistente' })
    expect(parseDateInput('1/1/1899', { today })).toEqual({ ok: false, reason: 'inexistente' })
    expect(parseDateInput('32/01/2026', { today })).toEqual({ ok: false, reason: 'inexistente' })
    expect(DATE_INPUT_MESSAGES.inexistente).toBe('Esa fecha no existe')
  })

  it('sin today usa el año de hoy en Córdoba', () => {
    const result = parseDateInput('15/9')
    expect(result.ok && result.iso.slice(4)).toBe('-09-15')
  })
})

describe('parseTimeInput', () => {
  const accepted: Array<[string, string]> = [
    ['2130', '21:30'],
    ['930', '09:30'],
    ['9', '09:00'],
    ['21.30', '21:30'],
    ['21h30', '21:30'],
    ['21H30', '21:30'],
    ['21hs', '21:00'],
    ['21 hs.', '21:00'],
    ['21:30', '21:30'],
    ['9:05', '09:05'],
    ['21:30:00', '21:30'],
    ['0', '00:00'],
    ['0030', '00:30'],
  ]

  it.each(accepted)('%j → %s', (text, time) => {
    expect(parseTimeInput(text)).toEqual({ ok: true, time })
  })

  it('errores', () => {
    for (const text of ['24:00', '21:60', 'abc', '12345', '2160', '25']) {
      expect(parseTimeInput(text)).toEqual({ ok: false, reason: 'ilegible' })
    }
    expect(parseTimeInput('  ')).toEqual({ ok: false, reason: 'vacio' })
    expect(TIME_INPUT_MESSAGE).toBe('Usá formato 24 h, por ejemplo 21:30')
  })
})

// ─── Períodos ────────────────────────────────────────────────────────────────

describe('períodos', () => {
  const periods: Period[] = [
    { kind: 'day', date: '2026-09-15' },
    { kind: 'month', month: '2026-09' },
    { kind: 'fiscal-year', year: 2026 },
    { kind: 'range', from: '2026-09-01', to: '2026-09-30' },
  ]

  it('serializa como dice el kit y se vuelve a leer igual', () => {
    expect(periods.map(serializePeriod)).toEqual([
      '2026-09-15',
      '2026-09',
      'ej-2026',
      '2026-09-01..2026-09-30',
    ])
    for (const p of periods) expect(parsePeriod(serializePeriod(p))).toEqual(p)
  })

  it('parsePeriod rechaza lo que no existe', () => {
    for (const s of ['2026-02-31', '2026-13', 'ej-1800', '2026-09-30..2026-09-01', 'x', '', null]) {
      expect(parsePeriod(s)).toBeNull()
    }
    expect(parsePeriod('este-mes', { today: '2026-10-06' })).toEqual({
      kind: 'month',
      month: '2026-10',
    })
  })

  it('rango civil inclusivo', () => {
    expect(periodRange({ kind: 'month', month: '2026-02' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(periodRange({ kind: 'fiscal-year', year: 2026 })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    })
    expect(periodRange({ kind: 'fiscal-year', year: 2026 }, { fiscalYearStartMonth: 7 })).toEqual({
      from: '2026-07-01',
      to: '2027-06-30',
    })
    expect(fiscalYearRange(2027, { fiscalYearStartMonth: 3 })).toEqual({
      from: '2027-03-01',
      to: '2028-02-29',
    })
  })

  it('bordes UTC para timestamptz: [inicio, fin + 1) en Córdoba', () => {
    expect(periodBoundsUtc({ kind: 'month', month: '2026-09' })).toEqual({
      gte: '2026-09-01T03:00:00.000Z',
      lt: '2026-10-01T03:00:00.000Z',
    })
    expect(periodBoundsUtc({ kind: 'day', date: '2026-12-31' })).toEqual({
      gte: '2026-12-31T03:00:00.000Z',
      lt: '2027-01-01T03:00:00.000Z',
    })
  })

  it('etiquetas', () => {
    expect(periods.map((p) => periodLabel(p))).toEqual([
      '15/09/2026',
      'Septiembre 2026',
      'Ejercicio 2026',
      '01/09 – 30/09/2026',
    ])
    expect(periodLabel({ kind: 'fiscal-year', year: 2026 }, { fiscalYearStartMonth: 7 })).toBe(
      'Ejercicio 2026/27',
    )
    expect(fiscalYearLabel(1999, { fiscalYearStartMonth: 7 })).toBe('Ejercicio 1999/00')
  })

  it('shiftPeriod', () => {
    expect(shiftPeriod({ kind: 'day', date: '2026-03-01' }, -1)).toEqual({
      kind: 'day',
      date: '2026-02-28',
    })
    expect(shiftPeriod({ kind: 'month', month: '2026-12' }, 1)).toEqual({
      kind: 'month',
      month: '2027-01',
    })
    expect(
      shiftPeriod({ kind: 'fiscal-year', year: 2026 }, -1, { fiscalYearStartMonth: 7 }),
    ).toEqual({ kind: 'fiscal-year', year: 2025 })
    expect(shiftPeriod({ kind: 'range', from: '2026-10-05', to: '2026-10-11' }, -1)).toEqual({
      kind: 'range',
      from: '2026-09-28',
      to: '2026-10-04',
    })
    // Meses enteros se corren de a meses.
    expect(shiftPeriod({ kind: 'range', from: '2026-09-01', to: '2026-10-31' }, -1)).toEqual({
      kind: 'range',
      from: '2026-07-01',
      to: '2026-08-31',
    })
    expect(shiftPeriod({ kind: 'range', from: '2026-02-01', to: '2026-02-28' }, 1)).toEqual({
      kind: 'range',
      from: '2026-03-01',
      to: '2026-03-31',
    })
  })

  it('contiene, días, igualdad y recorte', () => {
    const sep: Period = { kind: 'month', month: '2026-09' }
    expect(periodContains(sep, '2026-09-30')).toBe(true)
    expect(periodContains(sep, '2026-10-01')).toBe(false)
    expect(periodDays(sep)).toBe(30)
    expect(periodDays({ kind: 'fiscal-year', year: 2028 })).toBe(366)
    expect(isSamePeriod(sep, { kind: 'month', month: '2026-09' })).toBe(true)
    expect(isSamePeriod(sep, { kind: 'range', from: '2026-09-01', to: '2026-09-30' })).toBe(false)
    expect(
      clampRange(
        { from: '2026-01-01', to: '2026-12-31' },
        { min: '2026-10-01', max: '2026-10-06' },
      ),
    ).toEqual({ from: '2026-10-01', to: '2026-10-06' })
    expect(clampRange({ from: '2026-01-01', to: '2026-01-31' }, { min: '2026-10-01' })).toBeNull()
  })
})

describe('ejercicio', () => {
  it('mes de cierre → mes de inicio', () => {
    expect(fiscalYearStartMonthFromEndMonth(12)).toBe(1)
    expect(fiscalYearStartMonthFromEndMonth(6)).toBe(7)
    expect(() => fiscalYearStartMonthFromEndMonth(0)).toThrow(RangeError)
    expect(() => fiscalYearRange(2026, { fiscalYearStartMonth: 13 })).toThrow(RangeError)
  })

  it('a qué ejercicio pertenece un día', () => {
    expect(fiscalYearOf('2026-10-06')).toBe(2026)
    expect(fiscalYearOf('2026-06-30', { fiscalYearStartMonth: 7 })).toBe(2025)
    expect(fiscalYearOf('2026-07-01', { fiscalYearStartMonth: 7 })).toBe(2026)
  })

  it('cierre del primer ejercicio de los libros (como acc_ensure_fiscal_year)', () => {
    expect(fiscalYearEndOnOrAfter('2026-10-01', 12)).toBe('2026-12-31')
    expect(fiscalYearEndOnOrAfter('2026-12-15', 12)).toBe('2026-12-31')
    expect(fiscalYearEndOnOrAfter('2027-01-10', 12)).toBe('2027-12-31')
    expect(fiscalYearEndOnOrAfter('2026-07-01', 6)).toBe('2027-06-30')
    expect(fiscalYearEndOnOrAfter('2026-06-30', 6)).toBe('2026-06-30')
    expect(fiscalYearEndOnOrAfter('2027-01-10', 2)).toBe('2027-02-28')
  })
})

describe('atajos', () => {
  const today = '2026-10-06' // martes

  it('cada atajo, relativo a hoy', () => {
    const at = (key: Parameters<typeof presetPeriod>[0], start = 1) =>
      presetPeriod(key, { today, fiscalYearStartMonth: start })
    expect(at('hoy')).toEqual({ kind: 'day', date: '2026-10-06' })
    expect(at('ayer')).toEqual({ kind: 'day', date: '2026-10-05' })
    expect(at('esta-semana')).toEqual({ kind: 'range', from: '2026-10-05', to: '2026-10-11' })
    expect(at('semana-pasada')).toEqual({ kind: 'range', from: '2026-09-28', to: '2026-10-04' })
    expect(at('este-mes')).toEqual({ kind: 'month', month: '2026-10' })
    expect(at('mes-pasado')).toEqual({ kind: 'month', month: '2026-09' })
    expect(at('ultimos-30-dias')).toEqual({ kind: 'range', from: '2026-09-07', to: '2026-10-06' })
    expect(at('este-ejercicio')).toEqual({ kind: 'fiscal-year', year: 2026 })
    expect(at('ejercicio-a-la-fecha')).toEqual({
      kind: 'range',
      from: '2026-01-01',
      to: '2026-10-06',
    })
    expect(at('ejercicio-anterior')).toEqual({ kind: 'fiscal-year', year: 2025 })
    expect(at('ejercicio-a-la-fecha', 7)).toEqual({
      kind: 'range',
      from: '2026-07-01',
      to: '2026-10-06',
    })
  })

  it('la lista del PeriodPicker, filtrable por clase', () => {
    const all = periodPresets({ today })
    expect(all.map((p) => p.key)).toEqual([...DEFAULT_PERIOD_PRESET_KEYS])
    expect(all.map((p) => p.label)).toEqual([
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
    expect(periodPresets({ today, kinds: ['month'] }).map((p) => p.key)).toEqual([
      'este-mes',
      'mes-pasado',
    ])
    expect(matchPeriodPreset({ kind: 'month', month: '2026-09' }, { today })).toBe('mes-pasado')
    expect(matchPeriodPreset({ kind: 'month', month: '2026-01' }, { today })).toBeNull()
  })
})

describe('resolvePeriod (la URL)', () => {
  const today = '2026-10-06'

  it('periodo, mes y desde/hasta', () => {
    expect(resolvePeriod({ periodo: '2026-09' }, { today })).toEqual({
      ok: true,
      period: { kind: 'month', month: '2026-09' },
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(resolvePeriod({ mes: '2026-10' }, { today })).toMatchObject({
      ok: true,
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(resolvePeriod({ desde: '2026-10-01', hasta: '2026-10-06' }, { today })).toEqual({
      ok: true,
      period: { kind: 'range', from: '2026-10-01', to: '2026-10-06' },
      from: '2026-10-01',
      to: '2026-10-06',
    })
    // searchParams de Next: puede venir una lista; vale el primero.
    expect(resolvePeriod({ mes: ['2026-08', '2026-09'] }, { today })).toMatchObject({
      ok: true,
      from: '2026-08-01',
    })
    expect(resolvePeriod({ periodo: 'ej-2026' }, { today, fiscalYearStartMonth: 7 })).toMatchObject(
      { ok: true, from: '2026-07-01', to: '2027-06-30' },
    )
  })

  it('sin nada: el fallback o el mes de hoy', () => {
    expect(resolvePeriod({}, { today })).toMatchObject({
      ok: true,
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(
      resolvePeriod({ mes: '  ' }, { today, fallback: { kind: 'day', date: today } }),
    ).toMatchObject({ ok: true, from: today, to: today })
  })

  it('un parámetro roto es un error, no otro período en silencio', () => {
    expect(resolvePeriod({ periodo: 'cualquiera' }, { today })).toEqual({
      ok: false,
      error: 'periodo-invalido',
    })
    expect(resolvePeriod({ mes: '2026-13' }, { today })).toEqual({
      ok: false,
      error: 'mes-invalido',
    })
    expect(resolvePeriod({ desde: '2026-10-01' }, { today })).toEqual({
      ok: false,
      error: 'rango-incompleto',
    })
    expect(resolvePeriod({ desde: '2026-02-30', hasta: '2026-03-01' }, { today })).toEqual({
      ok: false,
      error: 'fecha-invalida',
    })
    expect(resolvePeriod({ desde: '2026-10-06', hasta: '2026-10-01' }, { today })).toEqual({
      ok: false,
      error: 'rango-invertido',
    })
  })

  it('tope de días (exportes: 400)', () => {
    // Del 01/09/2025 al 05/10/2026 son 400 días contando los dos bordes.
    expect(
      resolvePeriod({ desde: '2025-09-01', hasta: '2026-10-06' }, { today, maxDays: 400 }),
    ).toEqual({ ok: false, error: 'rango-muy-largo' })
    expect(
      resolvePeriod({ desde: '2025-09-01', hasta: '2026-10-05' }, { today, maxDays: 400 }),
    ).toMatchObject({ ok: true })
    expect(resolvePeriod({ periodo: 'ej-2028' }, { today, maxDays: 400 })).toMatchObject({
      ok: true,
    })
  })

  it('mensajes', () => {
    expect(periodErrorMessage('rango-invertido')).toBe(
      'El «hasta» no puede ser anterior al «desde».',
    )
    expect(periodErrorMessage('rango-muy-largo', { maxDays: 400 })).toBe(
      'El período puede tener hasta 400 días. Elegí uno más corto.',
    )
  })

  it('@/lib/dates/period alcanza para lo que nombra el Sprint 1 (E.1)', () => {
    expect(periodModule.addDays).toBe(addDays)
    expect(periodModule.endOfMonth).toBe(endOfMonth)
    expect(periodModule.monthOf).toBe(monthOf)
    expect(periodModule.daysBetween).toBe(daysBetween)
    expect(periodModule.serviceDayInCordoba).toBe(serviceDayInCordoba)
    expect(periodModule.resolvePeriod).toBe(resolvePeriod)
  })
})

// ─── Hidratación ─────────────────────────────────────────────────────────────

describe('sin Intl ni toLocale* (mismo string en el server y en el navegador)', () => {
  beforeEach(() => {
    vi.stubGlobal('Intl', undefined)
    const boom = () => {
      throw new Error('no se usa toLocale*')
    }
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(boom)
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(boom)
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(boom)
    vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(boom)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('todo lo de 2009 en adelante anda sin Intl', () => {
    const now = new Date('2026-10-06T23:15:00Z')
    expect(todayInCordoba(now)).toBe('2026-10-06')
    expect(serviceDayInCordoba(new Date('2026-10-07T04:00:00Z'))).toBe('2026-10-06')
    expect(formatDateTime('2026-09-10T17:32:00.123456+00:00')).toBe('10/09/2026 14:32')
    expect(formatDate(now)).toBe('06/10/2026')
    expect(formatLongDate('2026-09-15')).toBe('martes 15 de septiembre de 2026')
    expect(formatMonthLabel('2026-09')).toBe('Septiembre 2026')
    expect(cordobaDayStartUtc('2026-09-15')).toBe('2026-09-15T03:00:00.000Z')
    expect(periodLabel({ kind: 'range', from: '2026-09-01', to: '2026-09-30' })).toBe(
      '01/09 – 30/09/2026',
    )
    expect(periodBoundsUtc({ kind: 'month', month: '2026-09' }).lt).toBe('2026-10-01T03:00:00.000Z')
    expect(parseDateInput('15/9', { today: '2026-10-06' })).toEqual({ ok: true, iso: '2026-09-15' })
    expect(resolvePeriod({ mes: '2026-09' }, { today: '2026-10-06' })).toMatchObject({ ok: true })
  })
})

describe('no depende de la zona horaria del runtime', () => {
  const original = process.env.TZ
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it.each([
    'UTC',
    'Asia/Tokyo',
    'America/Los_Angeles',
    'Pacific/Kiritimati',
    'Pacific/Pago_Pago',
  ])('TZ=%s', (tz) => {
    process.env.TZ = tz
    expect(todayInCordoba(new Date('2026-08-01T01:30:00Z'))).toBe('2026-07-31')
    expect(formatDateTime('2026-09-10T17:32:00Z')).toBe('10/09/2026 14:32')
    expect(formatDate('2026-09-15')).toBe('15/09/2026')
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
    expect(cordobaDayStartUtc('2026-09-15')).toBe('2026-09-15T03:00:00.000Z')
    // El puente con date-fns sí es local, a propósito: ida y vuelta da el mismo día.
    for (const iso of ['2026-01-01', '2026-03-08', '2026-11-01', '2028-02-29']) {
      expect(localDateToIsoDay(isoDayToLocalNoon(iso))).toBe(iso)
    }
    expect(isoDayToLocalNoon('0026-05-05').getFullYear()).toBe(26)
  })
})
