import { describe, expect, it } from 'vitest'
import { buildCsv } from '@/lib/csv/write'
import { openTable } from '@/lib/imports/detect'
import {
  type ExistingEvent,
  type ImportFormat,
  monthsRange,
  normalizeName,
  parseImportCapacity,
  parseImportDate,
  parseImportTime,
  planImport,
  readImportRows,
} from '@/lib/salon/calendar-import'

const TODAY = '2026-11-01'

function format(partial: Partial<ImportFormat> & Pick<ImportFormat, 'id' | 'name'>): ImportFormat {
  return {
    aliases: [],
    active: true,
    defaultCapacity: 50,
    defaultMealType: 'dinner',
    defaultPrivateGroup: false,
    usualTime: '21:00',
    usualCapacity: 50,
    ...partial,
  }
}

// Los formatos de HUB el 01/11/2026: el calendario dice «Caroline» y
// «Ratatuille»; Entradas, «Coraline» y «Ratatouille».
const FORMATS: ImportFormat[] = [
  format({ id: 'caroline', name: 'Caroline', aliases: ['Coraline'] }),
  format({ id: 'chihiro', name: 'El viaje de Chihiro', aliases: ['El viaje de Chihiro'] }),
  format({ id: 'shrek', name: 'Shrek', aliases: ['Shrek 2'] }),
  format({ id: 'ratatuille', name: 'Ratatuille', aliases: ['Ratatouille'] }),
  format({ id: 'angelito', name: 'Mi pobre angelito', usualTime: null }),
  format({ id: 'pizza', name: 'Pizza libre', defaultCapacity: 140 }),
  format({ id: 'viejo', name: 'Noche de tacos', active: false }),
]

describe('normalizeName', () => {
  it('sin tildes, mayúsculas, signos ni artículo inicial', () => {
    expect(normalizeName('El viaje de Chihiro')).toBe('viaje de chihiro')
    expect(normalizeName('  SHREK 2!! ')).toBe('shrek 2')
    expect(normalizeName('Ratatouille')).toBe('ratatouille')
  })
})

describe('parseImportDate', () => {
  it('lo que escribe la gente', () => {
    expect(parseImportDate('15/11', TODAY)).toEqual({ ok: true, date: '2026-11-15' })
    expect(parseImportDate('15/11/2026', TODAY)).toEqual({ ok: true, date: '2026-11-15' })
    expect(parseImportDate('2/12', TODAY)).toEqual({ ok: true, date: '2026-12-02' })
    expect(parseImportDate('Domingo 15 de noviembre', TODAY)).toEqual({
      ok: true,
      date: '2026-11-15',
    })
    expect(parseImportDate('15 nov', TODAY)).toEqual({ ok: true, date: '2026-11-15' })
    expect(parseImportDate('2026-12-14', TODAY)).toEqual({ ok: true, date: '2026-12-14' })
  })

  it('una celda con formato de fecha de Excel (serial)', () => {
    expect(parseImportDate(46341, TODAY)).toEqual({ ok: true, date: '2026-11-15' })
  })

  it('sin año: el que viene si el mes ya pasó', () => {
    expect(parseImportDate('10/01', TODAY)).toEqual({ ok: true, date: '2027-01-10' })
    expect(parseImportDate('1/11', TODAY)).toEqual({ ok: true, date: '2026-11-01' })
  })

  it('si el día de la semana no coincide, avisa (no adivina)', () => {
    const r = parseImportDate('Domingo 30 de noviembre', TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('Dice domingo, pero el 30/11/2026 es lunes.')
  })

  it('lo que no es una fecha', () => {
    expect(parseImportDate('mañana', TODAY).ok).toBe(false)
    expect(parseImportDate('31/11', TODAY).ok).toBe(false)
    expect(parseImportDate(null, TODAY).ok).toBe(false)
  })
})

describe('parseImportTime', () => {
  it('formas de escribir la hora', () => {
    expect(parseImportTime('21')).toEqual({ ok: true, time: '21:00' })
    expect(parseImportTime('21:30')).toEqual({ ok: true, time: '21:30' })
    expect(parseImportTime('21.30')).toEqual({ ok: true, time: '21:30' })
    expect(parseImportTime('21hs')).toEqual({ ok: true, time: '21:00' })
    expect(parseImportTime('21:00:00')).toEqual({ ok: true, time: '21:00' })
    expect(parseImportTime(0.875)).toEqual({ ok: true, time: '21:00' })
    expect(parseImportTime(21)).toEqual({ ok: true, time: '21:00' })
  })

  it('vacía es «no la trae»; inválida, error', () => {
    expect(parseImportTime('')).toEqual({ ok: true, time: null })
    expect(parseImportTime(null)).toEqual({ ok: true, time: null })
    expect(parseImportTime('25:00').ok).toBe(false)
    expect(parseImportTime('a la noche').ok).toBe(false)
  })
})

describe('parseImportCapacity', () => {
  it('entero entre 1 y 999', () => {
    expect(parseImportCapacity(50)).toEqual({ ok: true, capacity: 50 })
    expect(parseImportCapacity('60')).toEqual({ ok: true, capacity: 60 })
    expect(parseImportCapacity('')).toEqual({ ok: true, capacity: null })
    expect(parseImportCapacity('0').ok).toBe(false)
    expect(parseImportCapacity('cincuenta').ok).toBe(false)
    expect(parseImportCapacity(12.5).ok).toBe(false)
  })
})

describe('readImportRows', () => {
  it('títulos en cualquier orden, alias de Entradas y varias fechas en una celda', () => {
    const r = readImportRows(
      [
        ['Fechas de cine'],
        ['Película', 'Fecha', 'Cupo'],
        ['Coraline', '15/11', ''],
        ['Shrek 2', '6/12; 8/12;', 60],
        ['viaje de chihiro', 'Domingo 22 de noviembre', ''],
      ],
      FORMATS,
      TODAY,
    )
    expect(r.noColumns).toBe(false)
    expect(r.problems).toEqual([])
    expect(
      r.entries.map((e) => [e.formatId, e.date, e.capacity, e.createCapacity, e.line]),
    ).toEqual([
      ['caroline', '2026-11-15', null, 50, 3],
      ['shrek', '2026-12-06', 60, 60, 4],
      ['shrek', '2026-12-08', 60, 60, 4],
      ['chihiro', '2026-11-22', null, 50, 5],
    ])
    expect(r.entries[0]?.createTime).toBe('21:00')
  })

  it('cada problema con su fila y su porqué', () => {
    const r = readImportRows(
      [
        ['Fecha', 'Película', 'Hora'],
        ['Domingo 30 de noviembre', 'Mi pobre angelito', '21:00'],
        ['20/10/2026', 'Coraline', ''],
        ['5/12', 'Coralin', ''],
        ['5/12', 'Harry Potter', ''],
        ['5/12', '', ''],
        ['16/12', 'Mi pobre angelito', ''],
        ['16/12', 'Noche de tacos', ''],
        ['16/12', 'Shrek', 'tarde'],
      ],
      FORMATS,
      TODAY,
    )
    expect(r.entries).toEqual([])
    expect(r.problems.map((p) => [p.line, p.reason])).toEqual([
      [2, 'Dice domingo, pero el 30/11/2026 es lunes.'],
      [3, 'El 20/10/2026 ya pasó.'],
      [4, 'No está en el calendario. ¿Quisiste decir «Coraline»?'],
      [5, 'No está en el calendario: creá el formato o corregí el nombre.'],
      [6, 'Falta la película.'],
      [7, 'Poné la hora: «Mi pobre angelito» no tiene fechas anteriores de donde copiarla.'],
      [8, '«Noche de tacos» está archivado en el calendario.'],
      [9, 'La hora no se entiende (escribila como 21:00).'],
    ])
  })

  it('sin fila de títulos: adivina las columnas por lo que tienen', () => {
    const r = readImportRows(
      [
        ['Coraline', '9/12'],
        ['Ratatouille', '7/12'],
      ],
      FORMATS,
      TODAY,
    )
    expect(r.entries.map((e) => [e.formatId, e.date])).toEqual([
      ['caroline', '2026-12-09'],
      ['ratatuille', '2026-12-07'],
    ])
  })

  it('sugiere el parecido aunque cambien varias letras («Coralin» → «Caroline»)', () => {
    const r = readImportRows(
      [
        ['Fecha', 'Película'],
        ['14/03/2027', 'Coralin'],
      ],
      FORMATS.filter((f) => f.id !== 'caroline').concat(format({ id: 'c2', name: 'Caroline' })),
      TODAY,
    )
    expect(r.problems[0]?.reason).toBe('No está en el calendario. ¿Quisiste decir «Caroline»?')
  })

  it('sin columnas reconocibles', () => {
    expect(readImportRows([['hola', 'chau']], FORMATS, TODAY).noColumns).toBe(true)
  })
})

describe('planImport', () => {
  const ev = (
    partial: Partial<ExistingEvent> & Pick<ExistingEvent, 'id' | 'templateId' | 'date'>,
  ) => ({ time: '21:00', capacity: 50, activeReservations: 0, ...partial }) as ExistingEvent

  const entry = (
    formatId: string,
    date: string,
    extra: { time?: string; capacity?: number } = {},
  ) => ({
    line: 2,
    date,
    formatId,
    time: extra.time ?? null,
    capacity: extra.capacity ?? null,
    createTime: extra.time ?? '21:00',
    createCapacity: extra.capacity ?? 50,
  })

  it('igual, nueva, cambiada de película y lo que no se toca', () => {
    const plan = planImport(
      [
        entry('caroline', '2026-12-14'),
        entry('caroline', '2026-12-09'),
        entry('shrek', '2026-12-06'),
      ],
      [
        ev({ id: 'c14', templateId: 'caroline', date: '2026-12-14' }),
        // El 9 era Shrek: pasa a Coraline (Shrek está en la planilla, así que se quita).
        ev({ id: 's09', templateId: 'shrek', date: '2026-12-09' }),
        // Shrek con reservas que la planilla no trae: queda.
        ev({ id: 's20', templateId: 'shrek', date: '2026-12-20', activeReservations: 12 }),
        // Otra película que la planilla no nombra: no se toca.
        ev({ id: 'p05', templateId: 'pizza', date: '2026-12-05' }),
        // Otro mes: no se toca.
        ev({ id: 'c-ene', templateId: 'caroline', date: '2027-01-10' }),
      ],
      TODAY,
    )
    expect(plan.months).toEqual(['2026-12'])
    expect(plan.sames.map((s) => s.eventId)).toEqual(['c14'])
    expect(plan.creates.map((c) => [c.formatId, c.date])).toEqual([
      ['shrek', '2026-12-06'],
      ['caroline', '2026-12-09'],
    ])
    expect(plan.removes.map((r) => r.eventId)).toEqual(['s09'])
    expect(plan.keeps.map((k) => [k.eventId, k.reservations])).toEqual([['s20', 12]])
  })

  it('cupo y hora: se cambian, salvo la hora de una fecha con reservas', () => {
    const plan = planImport(
      [
        entry('caroline', '2026-12-14', { capacity: 60 }),
        entry('shrek', '2026-12-08', { time: '20:00' }),
        entry('chihiro', '2026-12-10', { time: '20:30' }),
      ],
      [
        ev({ id: 'c14', templateId: 'caroline', date: '2026-12-14' }),
        ev({ id: 's08', templateId: 'shrek', date: '2026-12-08', activeReservations: 4 }),
        ev({ id: 'h10', templateId: 'chihiro', date: '2026-12-10' }),
      ],
      TODAY,
    )
    expect(plan.updates.map((u) => [u.eventId, u.newTime, u.newCapacity, u.timeBlocked])).toEqual([
      ['s08', null, null, true],
      ['h10', '20:30', null, false],
      ['c14', null, 60, false],
    ])
    expect(plan.creates).toEqual([])
  })

  it('una fila repetida se toma una vez; lo que ya pasó no se quita', () => {
    const plan = planImport(
      [entry('caroline', '2026-11-15'), entry('caroline', '2026-11-15')],
      [ev({ id: 'viejo', templateId: 'caroline', date: '2026-11-01', time: '00:00' })].map((e) => ({
        ...e,
        date: '2026-10-31',
      })),
      TODAY,
    )
    expect(plan.duplicates).toBe(1)
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]?.lines).toEqual([2, 2])
    expect(plan.removes).toEqual([])
  })
})

describe('la plantilla que se baja', () => {
  it('se vuelve a subir tal cual (CSV para Excel: «;», BOM y varias fechas en una celda)', async () => {
    const csv = buildCsv(
      ['Fecha', 'Película', 'Hora', 'Cupo'],
      [
        ['15/12/2026', 'Coraline', '21:00', 50],
        ['22/12/2026', 'El viaje de Chihiro', '', ''],
        ['06/12/2026; 08/12/2026', 'Shrek 2', '', ''],
      ],
    )
    const opened = await openTable({
      bytes: new TextEncoder().encode(csv),
      fileName: 'fechas-calendario.csv',
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const r = readImportRows(opened.table.rows, FORMATS, TODAY)
    expect(r.problems).toEqual([])
    expect(r.entries.map((e) => [e.formatId, e.date, e.time, e.capacity])).toEqual([
      ['caroline', '2026-12-15', '21:00', 50],
      ['chihiro', '2026-12-22', null, null],
      ['shrek', '2026-12-06', null, null],
      ['shrek', '2026-12-08', null, null],
    ])
  })
})

describe('monthsRange', () => {
  it('del primer día del primer mes al último del último', () => {
    expect(monthsRange(['2026-11', '2026-12'])).toEqual({ from: '2026-11-01', to: '2026-12-31' })
    expect(monthsRange(['2027-02'])).toEqual({ from: '2027-02-01', to: '2027-02-28' })
    expect(monthsRange([])).toBeNull()
  })
})
