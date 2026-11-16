import { describe, expect, it } from 'vitest'
import {
  addDays,
  type BoardGroup,
  type BoardTask,
  buildBoard,
  dueShortcuts,
  dueState,
  firstName,
  formatDayLong,
  formatDue,
  initials,
  matchesPerson,
  matchesSearch,
  moveItem,
  newTaskPosition,
  normalizeText,
  openCountByPerson,
  peopleOf,
  personColorClass,
  statusBreakdown,
} from '@/lib/marketing/board'
import { PERSON_COLORS } from '@/lib/marketing/constants'

// Domingo 15/11/2026, en el reloj del bar.
const TODAY = '2026-11-15'

const EVENTOS: BoardGroup = { id: 'g-eventos', name: 'Eventos', color: 'forest', position: 1 }
const PROMOS: BoardGroup = { id: 'g-promos', name: 'Promociones', color: 'coral', position: 2 }

function task(id: string, patch: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    groupId: EVENTOS.id,
    title: `Tarea ${id}`,
    status: 'todo',
    dueDate: null,
    notes: null,
    position: 1,
    responsibleIds: [],
    involvedIds: [],
    updatesCount: 0,
    filesCount: 0,
    createdBy: null,
    createdAt: '2026-11-01T12:00:00.000+00:00',
    completedAt: null,
    updatedAt: '2026-11-01T12:00:00.000+00:00',
    ...patch,
  }
}

const ids = (tasks: readonly BoardTask[]) => tasks.map((item) => item.id)

describe('buildBoard', () => {
  const tasks = [
    task('a', { position: 2 }),
    task('b', { position: 1, status: 'in_progress' }),
    task('c', { groupId: PROMOS.id, status: 'blocked', dueDate: '2026-11-10' }),
    task('d', { status: 'done', completedAt: '2026-11-10T10:00:00.000+00:00' }),
    task('e', { groupId: PROMOS.id, status: 'done', completedAt: '2026-11-14T10:00:00.000+00:00' }),
    // Sin fecha de cierre (una vieja): cuenta la última edición.
    task('f', {
      groupId: PROMOS.id,
      status: 'done',
      completedAt: null,
      updatedAt: '2026-11-12T10:00:00.000+00:00',
    }),
  ]

  it('separa lo abierto por grupo, en el orden de los grupos y de las tareas', () => {
    // Los grupos llegan desordenados: manda `position`.
    const board = buildBoard([PROMOS, EVENTOS], tasks, {}, TODAY)
    expect(board.columns.map((column) => column.group.id)).toEqual([EVENTOS.id, PROMOS.id])
    expect(ids(board.columns[0]?.tasks ?? [])).toEqual(['b', 'a'])
    expect(ids(board.columns[1]?.tasks ?? [])).toEqual(['c'])
  })

  it('lo terminado va aparte, de todos los grupos, lo más reciente arriba', () => {
    const board = buildBoard([EVENTOS, PROMOS], tasks, {}, TODAY)
    expect(ids(board.done)).toEqual(['e', 'f', 'd'])
    expect(board.counts).toEqual({ open: 3, overdue: 1, done: 3 })
  })

  it('a igual posición, primero la más vieja', () => {
    const twins = [
      task('nueva', { createdAt: '2026-11-03T12:00:00.000+00:00' }),
      task('vieja', { createdAt: '2026-11-02T12:00:00.000+00:00' }),
    ]
    expect(ids(buildBoard([EVENTOS], twins, {}, TODAY).columns[0]?.tasks ?? [])).toEqual([
      'vieja',
      'nueva',
    ])
  })

  it('una tarea de un grupo que no llegó cae en el primero', () => {
    const orphan = task('huerfana', { groupId: 'g-borrado' })
    const board = buildBoard([PROMOS, EVENTOS], [orphan], {}, TODAY)
    expect(ids(board.columns[0]?.tasks ?? [])).toEqual(['huerfana'])
    expect(board.columns[0]?.breakdown.total).toBe(1)
    expect(board.columns[1]?.tasks).toEqual([])
  })

  it('sin grupos no hay dónde mostrar nada', () => {
    expect(buildBoard([], tasks, {}, TODAY)).toEqual({
      columns: [],
      done: [],
      counts: { open: 0, overdue: 0, done: 0 },
    })
  })

  it('el filtro achica las filas pero no la barrita del reparto ni los números de arriba', () => {
    const mine = [
      ...tasks,
      task('g', { responsibleIds: ['ana'] }),
      task('h', { involvedIds: ['ana'], status: 'done' }),
    ]
    const all = buildBoard([EVENTOS, PROMOS], mine, {}, TODAY)
    const filtered = buildBoard([EVENTOS, PROMOS], mine, { personId: 'ana' }, TODAY)
    expect(ids(filtered.columns[0]?.tasks ?? [])).toEqual(['g'])
    expect(filtered.columns[1]?.tasks).toEqual([])
    expect(ids(filtered.done)).toEqual(['h'])
    expect(filtered.columns.map((column) => column.breakdown)).toEqual(
      all.columns.map((column) => column.breakdown),
    )
    expect(filtered.columns[0]?.breakdown.total).toBe(5)
    expect(filtered.counts).toEqual(all.counts)
  })

  it('filtra por texto y por vencidas', () => {
    const mixed = [
      task('peña', { title: 'Flyer de la PEÑA' }),
      task('notas', { notes: 'Pedir el logo de la peña' }),
      task('vencida', { dueDate: '2026-11-14' }),
      task('cerrada', { dueDate: '2026-11-01', status: 'done' }),
    ]
    expect(
      ids(buildBoard([EVENTOS], mixed, { query: 'pena' }, TODAY).columns[0]?.tasks ?? []),
    ).toEqual(['peña', 'notas'])
    const overdue = buildBoard([EVENTOS], mixed, { onlyOverdue: true }, TODAY)
    expect(ids(overdue.columns[0]?.tasks ?? [])).toEqual(['vencida'])
    // Lo terminado nunca está vencido.
    expect(overdue.done).toEqual([])
    expect(overdue.counts.overdue).toBe(1)
  })
})

describe('statusBreakdown', () => {
  it('en el orden del menú, solo los estados que tienen alguna', () => {
    expect(
      statusBreakdown([
        { status: 'done' },
        { status: 'waiting_feedback' },
        { status: 'todo' },
        { status: 'done' },
      ]),
    ).toEqual({
      total: 4,
      parts: [
        { status: 'todo', count: 1 },
        { status: 'done', count: 2 },
        { status: 'waiting_feedback', count: 1 },
      ],
    })
    expect(statusBreakdown([])).toEqual({ total: 0, parts: [] })
  })
})

describe('dueState', () => {
  it('vencida, hoy, pronto (dos días) y más adelante', () => {
    expect(dueState('2026-11-14', TODAY, 'todo')).toBe('overdue')
    expect(dueState('2026-01-01', TODAY, 'blocked')).toBe('overdue')
    expect(dueState(TODAY, TODAY, 'in_progress')).toBe('today')
    expect(dueState('2026-11-16', TODAY, 'todo')).toBe('soon')
    expect(dueState('2026-11-17', TODAY, 'todo')).toBe('soon')
    expect(dueState('2026-11-18', TODAY, 'todo')).toBe('later')
  })

  it('lo terminado nunca está vencido, y sin fecha no hay nada que mostrar', () => {
    expect(dueState('2026-11-01', TODAY, 'done')).toBe('done')
    expect(dueState(TODAY, TODAY, 'done')).toBe('done')
    expect(dueState(null, TODAY, 'todo')).toBe('none')
    expect(dueState(null, TODAY, 'done')).toBe('none')
  })
})

describe('formatDue', () => {
  it('Hoy, Mañana y Ayer', () => {
    expect(formatDue(TODAY, TODAY)).toBe('Hoy')
    expect(formatDue('2026-11-16', TODAY)).toBe('Mañana')
    expect(formatDue('2026-11-14', TODAY)).toBe('Ayer')
    // Cruzando el año también.
    expect(formatDue('2027-01-01', '2026-12-31')).toBe('Mañana')
  })

  it('el resto con día y mes; con el año si no es el de hoy', () => {
    expect(formatDue('2026-11-15', '2026-11-01')).toBe('15 nov')
    expect(formatDue('2026-12-01', TODAY)).toBe('1 dic')
    expect(formatDue('2027-01-05', TODAY)).toBe('5 ene 2027')
    expect(formatDue('2025-11-20', TODAY)).toBe('20 nov 2025')
  })

  it('una fecha rota se muestra tal cual', () => {
    expect(formatDue('2026-13-01', TODAY)).toBe('2026-13-01')
  })

  it('formatDayLong: el formato del panel', () => {
    expect(formatDayLong('2026-11-05')).toBe('05/11/2026')
  })
})

describe('dueShortcuts', () => {
  const dates = (today: string) =>
    Object.fromEntries(dueShortcuts(today).map((shortcut) => [shortcut.key, shortcut.date]))

  it('desde un miércoles: el viernes de esta semana y el lunes que viene', () => {
    expect(dueShortcuts('2026-11-18').map((shortcut) => shortcut.label)).toEqual([
      'Hoy',
      'Mañana',
      'El viernes',
      'La semana que viene',
    ])
    expect(dates('2026-11-18')).toEqual({
      today: '2026-11-18',
      tomorrow: '2026-11-19',
      friday: '2026-11-20',
      'next-week': '2026-11-23',
    })
  })

  it('desde un viernes: «El viernes» es el de la semana que viene', () => {
    expect(dates('2026-11-20')).toEqual({
      today: '2026-11-20',
      tomorrow: '2026-11-21',
      friday: '2026-11-27',
      'next-week': '2026-11-23',
    })
  })
})

describe('addDays', () => {
  it('cruza meses, años y el 29 de febrero', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays(TODAY, 0)).toBe(TODAY)
  })
})

describe('buscar', () => {
  it('sin tildes ni mayúsculas, en el título y en las notas', () => {
    expect(normalizeText('Grabación ÑANDÚ')).toBe('grabacion nandu')
    expect(matchesSearch({ title: 'Grabación del reel', notes: null }, 'GRABACION')).toBe(true)
    expect(matchesSearch({ title: 'Reel', notes: 'Con la canción nueva' }, 'cancion')).toBe(true)
    expect(matchesSearch({ title: 'Reel', notes: null }, 'flyer')).toBe(false)
    expect(matchesSearch({ title: 'Reel', notes: null }, '   ')).toBe(true)
  })

  it('una persona es responsable o involucrada', () => {
    expect(matchesPerson({ responsibleIds: ['a'], involvedIds: [] }, 'a')).toBe(true)
    expect(matchesPerson({ responsibleIds: [], involvedIds: ['a'] }, 'a')).toBe(true)
    expect(matchesPerson({ responsibleIds: ['b'], involvedIds: ['c'] }, 'a')).toBe(false)
  })
})

describe('las personas', () => {
  it('initials', () => {
    expect(initials('Nacho Badra')).toBe('NB')
    expect(initials('luz')).toBe('LU')
    expect(initials('María José Pérez')).toBe('MJ')
    expect(initials('nacho.badra')).toBe('NB')
    expect(initials('  ')).toBe('?')
  })

  it('firstName', () => {
    expect(firstName('Nacho Badra')).toBe('Nacho')
    expect(firstName('  Luz  ')).toBe('Luz')
  })

  it('openCountByPerson no cuenta lo terminado ni duplica a quien está dos veces', () => {
    const counts = openCountByPerson([
      task('1', { responsibleIds: ['ana'], involvedIds: ['ana', 'beto'] }),
      task('2', { responsibleIds: ['ana'], status: 'done' }),
      task('3', { involvedIds: ['beto'], status: 'waiting_feedback' }),
    ])
    expect(Object.fromEntries(counts)).toEqual({ ana: 1, beto: 2 })
  })

  it('cada persona tiene siempre el mismo color, de la paleta', () => {
    const color = personColorClass('11111111-2222-4333-8444-555555555555')
    expect(personColorClass('11111111-2222-4333-8444-555555555555')).toBe(color)
    expect(PERSON_COLORS).toContain(color)
  })

  it('peopleOf: las del equipo primero, por nombre; las que ya no están, al final', () => {
    const team = [
      { id: 'z', name: 'Zoe', role: 'editor' as const },
      { id: 'a', name: 'Ana', role: 'owner' as const },
    ]
    expect(
      peopleOf({ responsibleIds: ['ido', 'z', 'a'], involvedIds: ['a'] }, 'responsible', team),
    ).toEqual([
      { id: 'a', name: 'Ana', inTeam: true },
      { id: 'z', name: 'Zoe', inTeam: true },
      { id: 'ido', name: 'Ya no está en el equipo', inTeam: false },
    ])
    expect(peopleOf({ responsibleIds: ['z'], involvedIds: ['a'] }, 'involved', team)).toEqual([
      { id: 'a', name: 'Ana', inTeam: true },
    ])
  })
})

describe('el orden', () => {
  it('newTaskPosition: arriba de todo, al fondo, o la primera', () => {
    const group = [{ position: 3 }, { position: 1 }, { position: 2 }]
    expect(newTaskPosition(group, 'top')).toBe(0)
    expect(newTaskPosition(group, 'bottom')).toBe(4)
    expect(newTaskPosition([{ position: -2 }], 'top')).toBe(-3)
    expect(newTaskPosition([], 'top')).toBe(1)
    expect(newTaskPosition([], 'bottom')).toBe(1)
  })

  it('moveItem mueve una copia; fuera de rango la deja igual', () => {
    const list = ['a', 'b', 'c', 'd']
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(list, 1, 1)).toEqual(list)
    const same = moveItem(list, 0, 9)
    expect(same).toEqual(list)
    expect(same).not.toBe(list)
    expect(moveItem(list, -1, 0)).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('dueShortcuts: nunca dos atajos el mismo día', () => {
  it('un jueves «Mañana» ya es el viernes: entra «En dos semanas»', () => {
    // 2026-11-19 es jueves.
    const shortcuts = dueShortcuts('2026-11-19')
    expect(shortcuts.map((shortcut) => shortcut.label)).toEqual([
      'Hoy',
      'Mañana',
      'La semana que viene',
      'En dos semanas',
    ])
    expect(new Set(shortcuts.map((shortcut) => shortcut.date)).size).toBe(4)
  })

  it('un domingo «Mañana» ya es el lunes', () => {
    // 2026-11-15 es domingo.
    const shortcuts = dueShortcuts('2026-11-15')
    expect(shortcuts.map((shortcut) => shortcut.label)).toEqual([
      'Hoy',
      'Mañana',
      'El viernes',
      'En dos semanas',
    ])
    expect(new Set(shortcuts.map((shortcut) => shortcut.date)).size).toBe(4)
  })
})

describe('initials: solo letras y números', () => {
  it('no toma paréntesis ni signos', () => {
    expect(initials('Socios (demo)')).toBe('SD')
    expect(initials('qa.host+demoadm')).toBe('QH')
    expect(initials('(—)')).toBe('?')
  })
})
