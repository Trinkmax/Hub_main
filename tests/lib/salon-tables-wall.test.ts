import { describe, expect, it } from 'vitest'
import { aggregateDayReport, type TableChip } from '@/lib/salon/events-report'
import {
  fallenGroupLabel,
  legendFlags,
  nextWallIndex,
  seatStates,
  splitWall,
  tableReadout,
  wallAriaLabel,
  wallSeats,
} from '@/lib/salon/tables-wall'

function chip(over: Partial<TableChip> = {}): TableChip {
  return {
    id: 't',
    guests: 2,
    attended: 2,
    state: 'counted',
    label: null,
    fallenReason: null,
    ...over,
  }
}

function count<T>(xs: ReadonlyArray<T>, x: T): number {
  return xs.filter((y) => y === x).length
}

function readout(t: TableChip): string {
  const r = tableReadout(t)
  return `${r.title} · ${r.detail}`
}

describe('seatStates', () => {
  it('una mesa de 7 que se cerró con 6: 6 sentadas y 1 vacía, en ese orden', () => {
    expect(seatStates(chip({ guests: 7, attended: 6 }))).toEqual([
      'sat',
      'sat',
      'sat',
      'sat',
      'sat',
      'sat',
      'empty',
    ])
  })

  it('una mesa de 4 que se cerró con 6: 4 sentadas y 2 que se sumaron al final', () => {
    expect(seatStates(chip({ guests: 4, attended: 6 }))).toEqual([
      'sat',
      'sat',
      'sat',
      'sat',
      'extra',
      'extra',
    ])
  })

  it('una mesa sin cerrar no inventa asistencia', () => {
    expect(seatStates(chip({ guests: 3, attended: null, state: 'open' }))).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ])
  })

  it('una caída no tiene sillas', () => {
    expect(
      seatStates(chip({ guests: 2, attended: null, state: 'fallen', fallenReason: 'cancelled' })),
    ).toEqual(['none', 'none'])
  })

  it('una mesa cerrada con 0 son todas sillas vacías', () => {
    expect(seatStates(chip({ guests: 3, attended: 0 }))).toEqual(['empty', 'empty', 'empty'])
  })
})

describe('wallSeats', () => {
  it('alterna arriba y abajo, y el tablero abre en la primera silla', () => {
    const seats = wallSeats(chip({ guests: 3, attended: 3 }))
    expect(seats.map((s) => s.pos)).toEqual(['top', 'bottom', 'top'])
    expect(seats.map((s) => s.start)).toEqual([true, false, false])
    expect(seats.map((s) => s.end)).toEqual([false, false, true])
    expect(new Set(seats.map((s) => s.key)).size).toBe(3)
  })

  it('el tablero cierra en la última silla reservada: los que se sumaron cuelgan afuera', () => {
    const seats = wallSeats(chip({ guests: 2, attended: 4 }))
    expect(seats.map((s) => s.end)).toEqual([false, true, false, false])
  })

  it('una mesa de 1 abre y cierra en la misma silla', () => {
    const [only] = wallSeats(chip({ guests: 1, attended: 1 }))
    expect(only).toMatchObject({ start: true, end: true, pos: 'top' })
  })
})

describe('tableReadout', () => {
  it('sin nombre de mesa: "Mesa de N"', () => {
    expect(tableReadout(chip({ guests: 7, attended: 6 })).title).toBe('Mesa de 7')
  })

  it('con nombre de mesa: "Mesa 2 (de 3)", y no repite "Mesa" si ya lo trae', () => {
    expect(tableReadout(chip({ guests: 3, label: '2' })).title).toBe('Mesa 2 (de 3)')
    expect(tableReadout(chip({ guests: 3, label: 'Mesa 12' })).title).toBe('Mesa 12 (de 3)')
  })

  it('vinieron todos', () => {
    expect(readout(chip({ guests: 4, attended: 4 }))).toBe('Mesa de 4 · vinieron los 4')
    expect(readout(chip({ guests: 1, attended: 1 }))).toBe('Mesa de 1 · vino')
  })

  it('vinieron menos: singular y plural de la silla y de la gente', () => {
    expect(readout(chip({ guests: 7, attended: 6 }))).toBe(
      'Mesa de 7 · vinieron 6, quedó 1 silla vacía',
    )
    expect(readout(chip({ guests: 6, attended: 3 }))).toBe(
      'Mesa de 6 · vinieron 3, quedaron 3 sillas vacías',
    )
    expect(readout(chip({ guests: 2, attended: 1 }))).toBe(
      'Mesa de 2 · vino 1, quedó 1 silla vacía',
    )
  })

  it('no vino nadie', () => {
    expect(readout(chip({ guests: 4, attended: 0 }))).toBe('Mesa de 4 · se cerró sin nadie')
  })

  it('vinieron más', () => {
    expect(readout(chip({ guests: 4, attended: 6 }))).toBe('Mesa de 4 · vinieron 6, se sumaron 2')
    expect(readout(chip({ guests: 2, attended: 3 }))).toBe('Mesa de 2 · vinieron 3, se sumó 1')
  })

  it('sin cerrar', () => {
    expect(readout(chip({ guests: 5, attended: null, state: 'open' }))).toBe(
      'Mesa de 5 · quedó sin cerrar: no sabemos cuántos vinieron',
    )
  })

  it('caídas: cancelada, no vino, no vinieron', () => {
    const fallen = { attended: null, state: 'fallen' as const }
    expect(readout(chip({ ...fallen, guests: 2, fallenReason: 'cancelled' }))).toBe(
      'Mesa de 2 · la cancelaron',
    )
    expect(readout(chip({ ...fallen, guests: 1, fallenReason: 'no_show' }))).toBe(
      'Mesa de 1 · no vino',
    )
    expect(readout(chip({ ...fallen, guests: 2, fallenReason: 'no_show' }))).toBe(
      'Mesa de 2 · no vinieron',
    )
  })
})

describe('wallAriaLabel y fallenGroupLabel', () => {
  const fallenA = chip({
    id: 'a',
    guests: 2,
    attended: null,
    state: 'fallen',
    fallenReason: 'cancelled',
  })
  const fallenB = chip({
    id: 'b',
    guests: 2,
    attended: null,
    state: 'fallen',
    fallenReason: 'no_show',
  })

  it('nombra en pie y caídas', () => {
    expect(wallAriaLabel('Noche Astral', [chip(), chip({ id: 'x' }), fallenA, fallenB])).toBe(
      'Mesas de Noche Astral: 2 en pie y 2 caídas. Cada puntito es una persona.',
    )
    expect(wallAriaLabel('Ramen', [chip(), fallenA])).toBe(
      'Mesas de Ramen: 1 en pie y 1 caída. Cada puntito es una persona.',
    )
    expect(wallAriaLabel('Ramen', [chip()])).toBe(
      'Mesas de Ramen: 1 en pie. Cada puntito es una persona.',
    )
  })

  it('el rótulo de las caídas cuenta mesas y personas', () => {
    expect(fallenGroupLabel([fallenA, fallenB])).toBe('se cayeron · 2 (4 personas)')
    expect(fallenGroupLabel([chip({ guests: 1, state: 'fallen', attended: null })])).toBe(
      'se cayó · 1 (1 persona)',
    )
  })
})

describe('legendFlags', () => {
  it('solo prende lo que está dibujado', () => {
    expect(legendFlags([])).toEqual({
      counted: false,
      empty: false,
      extra: false,
      open: false,
      fallen: false,
    })
    expect(legendFlags([chip({ guests: 3, attended: 3 })])).toEqual({
      counted: true,
      empty: false,
      extra: false,
      open: false,
      fallen: false,
    })
  })

  it('distingue silla vacía, se sumó, sin cerrar y caída', () => {
    expect(
      legendFlags([
        chip({ guests: 3, attended: 2 }),
        chip({ guests: 2, attended: 3 }),
        chip({ guests: 2, attended: null, state: 'open' }),
        chip({ guests: 2, attended: null, state: 'fallen', fallenReason: 'no_show' }),
      ]),
    ).toEqual({ counted: true, empty: true, extra: true, open: true, fallen: true })
  })
})

describe('nextWallIndex', () => {
  it('flechas avanzan y retroceden, frenando en los extremos', () => {
    expect(nextWallIndex(0, 'ArrowRight', 3)).toBe(1)
    expect(nextWallIndex(0, 'ArrowDown', 3)).toBe(1)
    expect(nextWallIndex(2, 'ArrowRight', 3)).toBe(2)
    expect(nextWallIndex(1, 'ArrowLeft', 3)).toBe(0)
    expect(nextWallIndex(0, 'ArrowUp', 3)).toBe(0)
  })

  it('Inicio y Fin saltan; cualquier otra tecla no navega', () => {
    expect(nextWallIndex(1, 'Home', 3)).toBe(0)
    expect(nextWallIndex(0, 'End', 3)).toBe(2)
    expect(nextWallIndex(0, 'Enter', 3)).toBeNull()
    expect(nextWallIndex(0, 'ArrowRight', 0)).toBeNull()
  })
})

describe('Noche Astral 09/09 (datos reales)', () => {
  // 11 en pie: 7, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1 = 29 personas; todas cerradas,
  // vinieron 27 (la de 7 con 6 y "Mesa 2", de 3, con 2). 1 cancelada y 1 no-show.
  const E = 'ev-astral'
  let seq = 0
  const row = (
    estimated: number,
    actual: number | null,
    status: 'arrived' | 'cancelled' | 'no_show' = 'arrived',
    label: string | null = null,
  ) => {
    seq += 1
    return {
      id: `a${seq}`,
      reservation_date: '2026-09-09',
      scheduled_event_id: E,
      estimated_guests: estimated,
      actual_guests: actual,
      status,
      table_label: label,
    }
  }
  const report = aggregateDayReport({
    day: '2026-09-09',
    events: [
      {
        id: E,
        template_id: 'tpl-astral',
        name_override: null,
        event_date: '2026-09-09',
        starts_at_local: '21:00:00',
        capacity: 70,
        template: { id: 'tpl-astral', name: 'Noche Astral', color_hex: '#ed4094' },
      },
    ],
    rows: [
      row(7, 6),
      row(3, 3),
      row(3, 3),
      row(3, 2, 'arrived', '2'),
      row(3, 3),
      row(2, null, 'no_show'),
      row(2, 2),
      row(2, 2),
      row(2, 2),
      row(2, null, 'cancelled'),
      row(2, 2),
      row(1, 1),
      row(1, 1),
    ],
  })
  const astral = report.blocks[0]
  const tables = astral?.tables ?? []

  it('dibuja 27 sillas llenas, 2 huecas y 2 rayitas caídas', () => {
    const { standing, fallen } = splitWall(tables)
    const seats = standing.flatMap(seatStates)
    expect(standing).toHaveLength(11)
    expect(count(seats, 'sat')).toBe(27)
    expect(count(seats, 'empty')).toBe(2)
    expect(seats).toHaveLength(29)
    expect(fallen).toHaveLength(2)
    expect(fallenGroupLabel(fallen)).toBe('se cayeron · 2 (4 personas)')
    expect(wallAriaLabel(astral?.title ?? '', tables)).toBe(
      'Mesas de Noche Astral: 11 en pie y 2 caídas. Cada puntito es una persona.',
    )
  })

  it('lee la de 7 y "Mesa 2" como en el smoke', () => {
    const readouts = tables.map(readout)
    expect(readouts).toContain('Mesa de 7 · vinieron 6, quedó 1 silla vacía')
    expect(readouts).toContain('Mesa 2 (de 3) · vinieron 2, quedó 1 silla vacía')
    expect(readouts).toContain('Mesa de 2 · la cancelaron')
    expect(readouts).toContain('Mesa de 2 · no vinieron')
  })
})
