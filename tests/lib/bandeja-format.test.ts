import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dayKey,
  formatDaySeparator,
  formatListTimestamp,
  formatRelativeDays,
} from '@/lib/bandeja/format'

// Todo en instantes UTC fijos: la bandeja tiene que hablar en la hora de
// Córdoba (UTC−3 todo el año) sin importar la zona del runtime. Antes los
// fixtures se armaban con hora local y el test pasaba aunque en Vercel (UTC) la
// hora saliera tres horas corrida.

/** `2026-07-18 15:00` de Córdoba → el instante UTC (Córdoba = UTC−3). */
function cba(date: string, time = '12:30'): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const [y = 1970, mo = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h + 3, m)).toISOString()
}

// Sábado 18/07/2026 15:00 en Córdoba como "ahora" fijo.
const NOW = new Date(cba('2026-07-18', '15:00'))

describe('formatListTimestamp', () => {
  it('hoy → HH:mm de Córdoba', () => {
    expect(formatListTimestamp(cba('2026-07-18', '09:05'), NOW)).toBe('09:05')
    // 01:15 UTC del 19 = 22:15 del 18 en Córdoba (el bug de Vercel decía 01:15).
    expect(formatListTimestamp('2026-07-19T01:15:00.000Z', NOW)).toBe('22:15')
  })

  it('ayer → "ayer"', () => {
    expect(formatListTimestamp(cba('2026-07-17'), NOW)).toBe('ayer')
  })

  it('esta semana → día de la semana en es', () => {
    // 15/07/2026 fue miércoles
    expect(formatListTimestamp(cba('2026-07-15'), NOW)).toBe('miércoles')
  })

  it('más viejo → dd/MM/yyyy', () => {
    expect(formatListTimestamp(cba('2026-06-02'), NOW)).toBe('02/06/2026')
  })

  it('el día lo corta la medianoche de Córdoba, no la de UTC', () => {
    // 02:30 UTC del 18 = 23:30 del 17 en Córdoba: es "ayer", no "hoy 02:30".
    expect(formatListTimestamp('2026-07-18T02:30:00Z', NOW)).toBe('ayer')
    // 03:05 UTC del 18 = 00:05 del 18 en Córdoba: ya es hoy.
    expect(formatListTimestamp('2026-07-18T03:05:00Z', NOW)).toBe('00:05')
    // Una semana justa: el sábado 11 ya no es "sábado", es la fecha.
    expect(formatListTimestamp(cba('2026-07-12'), NOW)).toBe('domingo')
    expect(formatListTimestamp(cba('2026-07-11'), NOW)).toBe('11/07/2026')
  })

  it('lee los timestamptz de PostgREST (microsegundos y offset)', () => {
    expect(formatListTimestamp('2026-07-18T12:05:09.123456+00:00', NOW)).toBe('09:05')
    expect(formatListTimestamp('2026-07-18T09:05:00-03:00', NOW)).toBe('09:05')
  })

  it('vacío para null o inválido', () => {
    expect(formatListTimestamp(null, NOW)).toBe('')
    expect(formatListTimestamp('', NOW)).toBe('')
    expect(formatListTimestamp('nope', NOW)).toBe('')
  })
})

describe('formatDaySeparator', () => {
  it('Hoy / Ayer', () => {
    expect(formatDaySeparator(cba('2026-07-18'), NOW)).toBe('Hoy')
    expect(formatDaySeparator(cba('2026-07-17'), NOW)).toBe('Ayer')
  })

  it('esta semana → día capitalizado', () => {
    expect(formatDaySeparator(cba('2026-07-15'), NOW)).toBe('Miércoles')
    expect(formatDaySeparator(cba('2026-07-13'), NOW)).toBe('Lunes')
  })

  it('más viejo → fecha completa en es', () => {
    expect(formatDaySeparator(cba('2026-06-02'), NOW)).toBe('2 de junio de 2026')
    expect(formatDaySeparator(cba('2025-09-30'), NOW)).toBe('30 de septiembre de 2025')
  })

  it('un mensaje de las 23:30 de Córdoba queda en ese día', () => {
    expect(formatDaySeparator('2026-07-18T02:30:00Z', NOW)).toBe('Ayer')
  })

  it('vacío si no se lee', () => {
    expect(formatDaySeparator('nope', NOW)).toBe('')
  })
})

describe('dayKey', () => {
  it('agrupa por día calendario de Córdoba', () => {
    expect(dayKey(cba('2026-07-18', '00:05'))).toBe('2026-07-18')
    expect(dayKey(cba('2026-07-18', '23:55'))).toBe('2026-07-18')
    // 02:55 UTC del 19 todavía es el 18 en Córdoba.
    expect(dayKey('2026-07-19T02:55:00Z')).toBe('2026-07-18')
  })

  it('vacía si no se lee (antes tiraba RangeError)', () => {
    expect(dayKey('nope')).toBe('')
  })
})

describe('formatRelativeDays', () => {
  it('hoy / ayer / hace N días', () => {
    expect(formatRelativeDays(cba('2026-07-18'), NOW)).toBe('hoy')
    expect(formatRelativeDays(cba('2026-07-17'), NOW)).toBe('ayer')
    expect(formatRelativeDays(cba('2026-07-06'), NOW)).toBe('hace 12 días')
  })

  it('meses y años', () => {
    expect(formatRelativeDays(cba('2026-06-17'), NOW)).toBe('hace 1 mes')
    expect(formatRelativeDays(cba('2026-04-18'), NOW)).toBe('hace 3 meses')
    expect(formatRelativeDays(cba('2025-07-01'), NOW)).toBe('hace 1 año')
    expect(formatRelativeDays(cba('2024-07-10'), NOW)).toBe('hace 2 años')
  })

  it('la visita de las 23:30 de anoche es "ayer", no "hoy"', () => {
    expect(formatRelativeDays('2026-07-18T02:30:00Z', NOW)).toBe('ayer')
  })

  it('null para null o inválido', () => {
    expect(formatRelativeDays(null, NOW)).toBeNull()
    expect(formatRelativeDays('nope', NOW)).toBeNull()
  })
})

describe('no depende de la zona horaria del runtime (server en UTC, navegador en Córdoba)', () => {
  const original = process.env.TZ
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  function snapshot() {
    return {
      list: [
        formatListTimestamp('2026-07-19T01:15:00Z', NOW),
        formatListTimestamp('2026-07-18T02:30:00Z', NOW),
        formatListTimestamp(cba('2026-07-15'), NOW),
        formatListTimestamp(cba('2026-06-02'), NOW),
      ],
      separator: formatDaySeparator('2026-07-18T02:30:00Z', NOW),
      key: dayKey('2026-07-19T02:55:00Z'),
      relative: formatRelativeDays('2026-07-18T02:30:00Z', NOW),
    }
  }

  it.each([
    'UTC',
    'America/Argentina/Cordoba',
    'Asia/Tokyo',
    'America/Los_Angeles',
  ])('TZ=%s da lo mismo que en Córdoba', (tz) => {
    process.env.TZ = tz
    expect(snapshot()).toEqual({
      list: ['22:15', 'ayer', 'miércoles', '02/06/2026'],
      separator: 'Ayer',
      key: '2026-07-18',
      relative: 'ayer',
    })
  })

  it('control: el cambio de TZ es real (con UTC el día local ya es otro)', () => {
    process.env.TZ = 'UTC'
    expect(new Date('2026-07-18T02:30:00Z').getDate()).toBe(18)
    process.env.TZ = 'America/Argentina/Cordoba'
    expect(new Date('2026-07-18T02:30:00Z').getDate()).toBe(17)
  })

  it('tampoco usa Intl ni toLocale* (mismo string en el server y en el navegador)', () => {
    vi.stubGlobal('Intl', undefined)
    const boom = () => {
      throw new Error('no se usa toLocale*')
    }
    vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(boom)
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(boom)
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(boom)
    try {
      expect(snapshot().list).toEqual(['22:15', 'ayer', 'miércoles', '02/06/2026'])
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})
