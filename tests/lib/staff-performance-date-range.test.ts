import { afterEach, describe, expect, it } from 'vitest'
import {
  dayInTz,
  labelForPreset,
  parsePreset,
  resolveDateRange,
  toIsoBounds,
} from '@/lib/staff-performance/date-range'
import {
  cordobaDayFromParam,
  rangeFromSearchParams,
  resolveFromSearchParams,
} from '@/lib/staff-performance/range-from-search-params'

// Fixed "now": jueves 15 de mayo 2026, 14:00 hora Córdoba = 17:00 UTC.
const NOW = new Date('2026-05-15T17:00:00.000Z')

describe('resolveDateRange', () => {
  it('today: from y to son el mismo día calendario en Córdoba', () => {
    const r = resolveDateRange({ preset: 'today' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-15')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('today: 00:00 a 23:59:59.999 de Córdoba (03:00 UTC a 02:59:59.999 UTC del día siguiente)', () => {
    expect(toIsoBounds(resolveDateRange({ preset: 'today' }, NOW))).toEqual({
      fromIso: '2026-05-15T03:00:00.000Z',
      toIso: '2026-05-16T02:59:59.999Z',
    })
  })

  it('last7: from = hoy - 6, to = hoy', () => {
    const r = resolveDateRange({ preset: 'last7' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-09')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('last30: from = hoy - 29, to = hoy', () => {
    const r = resolveDateRange({ preset: 'last30' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-04-16')
    expect(dayInTz(r.to)).toBe('2026-05-15')
  })

  it('this_month: día 1 del mes corriente hasta hoy', () => {
    const r = resolveDateRange({ preset: 'this_month' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-05-01')
    expect(dayInTz(r.to)).toBe('2026-05-15')
    expect(r.from.toISOString()).toBe('2026-05-01T03:00:00.000Z')
  })

  it('last_month: día 1 al último día del mes anterior', () => {
    const r = resolveDateRange({ preset: 'last_month' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-04-01')
    expect(dayInTz(r.to)).toBe('2026-04-30')
    expect(toIsoBounds(r)).toEqual({
      fromIso: '2026-04-01T03:00:00.000Z',
      toIso: '2026-05-01T02:59:59.999Z',
    })
  })

  it('last_month en enero es diciembre del año anterior; en marzo, febrero (bisiesto)', () => {
    const jan = resolveDateRange({ preset: 'last_month' }, new Date('2027-01-10T15:00:00Z'))
    expect([dayInTz(jan.from), dayInTz(jan.to)]).toEqual(['2026-12-01', '2026-12-31'])
    const mar = resolveDateRange({ preset: 'last_month' }, new Date('2028-03-02T15:00:00Z'))
    expect([dayInTz(mar.from), dayInTz(mar.to)]).toEqual(['2028-02-01', '2028-02-29'])
  })

  it('"hoy" lo decide el reloj de Córdoba: 23:30 del 31/05 sigue siendo mayo', () => {
    // 02:30 UTC del 01/06 = 23:30 del 31/05 en Córdoba.
    const late = new Date('2026-06-01T02:30:00Z')
    expect(dayInTz(resolveDateRange({ preset: 'today' }, late).from)).toBe('2026-05-31')
    const month = resolveDateRange({ preset: 'this_month' }, late)
    expect([dayInTz(month.from), dayInTz(month.to)]).toEqual(['2026-05-01', '2026-05-31'])
    // A las 00:00 de Córdoba ya arrancó junio.
    const midnight = new Date('2026-06-01T03:00:00Z')
    expect(dayInTz(resolveDateRange({ preset: 'this_month' }, midnight).from)).toBe('2026-06-01')
  })

  it('custom: días civiles de Córdoba, de las 00:00 del primero al último ms del último', () => {
    const r = resolveDateRange({ preset: 'custom', from: '2026-03-10', to: '2026-03-12' }, NOW)
    expect(dayInTz(r.from)).toBe('2026-03-10')
    expect(dayInTz(r.to)).toBe('2026-03-12')
    expect(toIsoBounds(r)).toEqual({
      fromIso: '2026-03-10T03:00:00.000Z',
      toIso: '2026-03-13T02:59:59.999Z',
    })
  })

  it('custom de un solo día y cruzando fin de año', () => {
    const one = resolveDateRange({ preset: 'custom', from: '2026-09-08', to: '2026-09-08' }, NOW)
    expect([dayInTz(one.from), dayInTz(one.to)]).toEqual(['2026-09-08', '2026-09-08'])
    const year = resolveDateRange({ preset: 'custom', from: '2026-12-31', to: '2027-01-01' }, NOW)
    expect(toIsoBounds(year)).toEqual({
      fromIso: '2026-12-31T03:00:00.000Z',
      toIso: '2027-01-02T02:59:59.999Z',
    })
  })
})

describe('cordobaDayFromParam', () => {
  it('un yyyy-MM-dd es el día del bar tal cual (no la medianoche UTC)', () => {
    expect(cordobaDayFromParam('2026-03-10')).toBe('2026-03-10')
  })

  it('un instante cuenta en el día de Córdoba en que cae', () => {
    expect(cordobaDayFromParam('2026-03-10T15:00:00.000Z')).toBe('2026-03-10')
    // 01:00 UTC del 12 = 22:00 del 11 en Córdoba.
    expect(cordobaDayFromParam('2026-03-12T01:00:00Z')).toBe('2026-03-11')
    expect(cordobaDayFromParam('2026-03-12T01:00:00-03:00')).toBe('2026-03-12')
    // Sin zona ya es hora de Córdoba.
    expect(cordobaDayFromParam('2026-03-12T23:30')).toBe('2026-03-12')
  })

  it('null si no es una fecha real', () => {
    expect(cordobaDayFromParam(undefined)).toBeNull()
    expect(cordobaDayFromParam('')).toBeNull()
    expect(cordobaDayFromParam('2026-02-30')).toBeNull()
    expect(cordobaDayFromParam('2026-13-01')).toBeNull()
    expect(cordobaDayFromParam('1800-01-01')).toBeNull()
    expect(cordobaDayFromParam('mañana')).toBeNull()
  })
})

describe('rangeFromSearchParams', () => {
  it('?preset=custom&from&to con yyyy-MM-dd arranca el día pedido, no el anterior', () => {
    const { preset, input } = rangeFromSearchParams({
      preset: 'custom',
      from: '2026-03-10',
      to: '2026-03-12',
    })
    expect(preset).toBe('custom')
    expect(input).toEqual({ preset: 'custom', from: '2026-03-10', to: '2026-03-12' })
    const range = resolveDateRange(input, NOW)
    expect(dayInTz(range.from)).toBe('2026-03-10')
    expect(dayInTz(range.to)).toBe('2026-03-12')
  })

  it('toma el primer valor si el parámetro viene repetido', () => {
    expect(
      rangeFromSearchParams({
        preset: ['custom', 'today'],
        from: ['2026-03-10', '2026-01-01'],
        to: ['2026-03-12'],
      }).input,
    ).toEqual({ preset: 'custom', from: '2026-03-10', to: '2026-03-12' })
  })

  it('custom mal formado o incompleto cae a last7', () => {
    const fallback = { preset: 'last7', input: { preset: 'last7' } }
    expect(rangeFromSearchParams({ preset: 'custom', from: '2026-03-10' })).toEqual(fallback)
    expect(
      rangeFromSearchParams({ preset: 'custom', from: '2026-02-30', to: '2026-03-12' }),
    ).toEqual(fallback)
    expect(rangeFromSearchParams({ preset: 'custom', from: 'ayer', to: 'hoy' })).toEqual(fallback)
  })

  it('preset válido directo; ausente o desconocido → last7', () => {
    expect(rangeFromSearchParams({ preset: 'last30' })).toEqual({
      preset: 'last30',
      input: { preset: 'last30' },
    })
    expect(rangeFromSearchParams({}).preset).toBe('last7')
    expect(rangeFromSearchParams({ preset: 'semana' }).preset).toBe('last7')
  })
})

describe('resolveFromSearchParams', () => {
  it('resuelve el rango contra el "ahora" que le pasan', () => {
    const { preset, range } = resolveFromSearchParams({ preset: 'today' }, NOW)
    expect(preset).toBe('today')
    expect(toIsoBounds(range)).toEqual({
      fromIso: '2026-05-15T03:00:00.000Z',
      toIso: '2026-05-16T02:59:59.999Z',
    })
  })
})

describe('no depende de la zona horaria del runtime (Vercel corre en UTC)', () => {
  const original = process.env.TZ
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it.each([
    'UTC',
    'America/Argentina/Cordoba',
    'Asia/Tokyo',
    'America/Los_Angeles',
  ])('TZ=%s', (tz) => {
    process.env.TZ = tz
    const custom = resolveFromSearchParams(
      { preset: 'custom', from: '2026-03-10', to: '2026-03-12' },
      NOW,
    ).range
    expect(toIsoBounds(custom)).toEqual({
      fromIso: '2026-03-10T03:00:00.000Z',
      toIso: '2026-03-13T02:59:59.999Z',
    })
    const lastMonth = resolveDateRange({ preset: 'last_month' }, NOW)
    expect(toIsoBounds(lastMonth)).toEqual({
      fromIso: '2026-04-01T03:00:00.000Z',
      toIso: '2026-05-01T02:59:59.999Z',
    })
    const last7 = resolveDateRange({ preset: 'last7' }, new Date('2026-06-01T02:30:00Z'))
    expect([dayInTz(last7.from), dayInTz(last7.to)]).toEqual(['2026-05-25', '2026-05-31'])
  })
})

describe('parsePreset', () => {
  it('acepta presets válidos', () => {
    expect(parsePreset('today')).toBe('today')
    expect(parsePreset('last7')).toBe('last7')
    expect(parsePreset('last_month')).toBe('last_month')
  })

  it('rechaza valores no válidos', () => {
    expect(parsePreset('mañana')).toBeNull()
    expect(parsePreset('')).toBeNull()
    expect(parsePreset(null)).toBeNull()
    expect(parsePreset(undefined)).toBeNull()
  })
})

describe('labelForPreset', () => {
  it('todas las labels en español', () => {
    expect(labelForPreset('today')).toBe('Hoy')
    expect(labelForPreset('last7')).toBe('Últimos 7 días')
    expect(labelForPreset('last30')).toBe('Últimos 30 días')
    expect(labelForPreset('this_month')).toBe('Mes actual')
    expect(labelForPreset('last_month')).toBe('Mes anterior')
    expect(labelForPreset('custom')).toBe('Personalizado')
  })
})

describe('toIsoBounds', () => {
  it('serializa a ISO strings', () => {
    const r = resolveDateRange({ preset: 'today' }, NOW)
    const { fromIso, toIso } = toIsoBounds(r)
    expect(fromIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(toIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
