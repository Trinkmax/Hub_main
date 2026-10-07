import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayLabel as depositsDayLabel } from '@/app/(manager)/[tenantSlug]/estadisticas/senas/_components/deposits-bar-chart'
import { dayLabel as agendaDayLabel } from '@/components/reservations/day-labels'
import { eachIsoDay, formatDayLabel } from '@/lib/dates'
import { formatDayLabel as salonFormatDayLabel } from '@/lib/salon/date-presets'

// `formatDayLabel` («Vie 31/07») es la única etiqueta de día corta: antes había
// tres copias (la agenda de reservas, el gráfico de señas y `lib/salon`, esta
// última con `Intl`).

describe('formatDayLabel', () => {
  it('día de la semana abreviado y capitalizado + dd/MM', () => {
    expect(formatDayLabel('2026-07-31')).toBe('Vie 31/07')
    expect(formatDayLabel('2026-08-02')).toBe('Dom 02/08')
    expect(formatDayLabel('2026-09-09')).toBe('Mié 09/09')
  })

  it('una semana entera, de lunes a domingo, con tildes', () => {
    expect(eachIsoDay('2026-07-27', '2026-08-02').map(formatDayLabel)).toEqual([
      'Lun 27/07',
      'Mar 28/07',
      'Mié 29/07',
      'Jue 30/07',
      'Vie 31/07',
      'Sáb 01/08',
      'Dom 02/08',
    ])
  })

  it('cruza años y bisiestos sin correr el día', () => {
    expect(formatDayLabel('2026-12-31')).toBe('Jue 31/12')
    expect(formatDayLabel('2027-01-01')).toBe('Vie 01/01')
    expect(formatDayLabel('2028-02-29')).toBe('Mar 29/02')
  })

  it('vacía si no es un día real', () => {
    expect(formatDayLabel('2026-02-30')).toBe('')
    expect(formatDayLabel('2026-09-09T12:00:00Z')).toBe('')
    expect(formatDayLabel('nada')).toBe('')
  })
})

describe('una sola implementación', () => {
  it('la agenda, el tablero de señas y lib/salon usan la de lib/dates', () => {
    expect(agendaDayLabel).toBe(formatDayLabel)
    expect(depositsDayLabel).toBe(formatDayLabel)
    expect(salonFormatDayLabel).toBe(formatDayLabel)
  })
})

describe('sin Intl ni zona del runtime (mismo string en el server y en el navegador)', () => {
  const original = process.env.TZ
  afterEach(() => {
    vi.unstubAllGlobals()
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it('anda sin Intl', () => {
    vi.stubGlobal('Intl', undefined)
    expect(formatDayLabel('2026-07-31')).toBe('Vie 31/07')
    expect(salonFormatDayLabel('2026-08-01')).toBe('Sáb 01/08')
  })

  it.each(['UTC', 'America/Argentina/Cordoba', 'Pacific/Kiritimati'])('TZ=%s', (tz) => {
    process.env.TZ = tz
    expect(formatDayLabel('2026-09-21')).toBe('Lun 21/09')
  })
})
