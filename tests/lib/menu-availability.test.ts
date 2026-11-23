import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_PRESETS,
  type Availability,
  availabilitySchema,
  availabilitySentence,
  availabilityWords,
  crossesMidnight,
  daysWords,
  fromDrafts,
  hiddenCategoryIds,
  hoursWords,
  isAvailableAt,
  localClock,
  minutesToNextChange,
  msToNextChange,
  newWindowDraft,
  normalizeAvailability,
  parseAvailability,
  sameAvailability,
  toDrafts,
  toggleDraftDay,
  visibleNow,
} from '@/lib/menu/availability'

const TZ = 'America/Argentina/Cordoba'
/** Un instante por la hora de Córdoba (UTC−3 todo el año). 23/11/2026 es lunes. */
const at = (day: string, clock: string) => new Date(`${day}T${clock}:00-03:00`)
const MON = '2026-11-23'
const FRI = '2026-11-27'
const SAT = '2026-11-28'
const SUN = '2026-11-29'

const LUNCH: Availability = { windows: [{ days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' }] }
const WEEKEND: Availability = { windows: [{ days: [0, 6], from: null, to: null }] }
const NIGHT: Availability = { windows: [{ days: [5, 6], from: '20:00', to: '03:00' }] }

describe('la hora del bar', () => {
  it('lee el día y los minutos en la zona del bar, no en la del servidor', () => {
    expect(localClock(at(MON, '12:30'), TZ)).toEqual({ day: 1, minutes: 750 })
    // 02:00 UTC del martes todavía es lunes a las 23 en Córdoba.
    expect(localClock(new Date('2026-11-24T02:00:00Z'), TZ)).toEqual({ day: 1, minutes: 23 * 60 })
    expect(localClock(at(SUN, '00:00'), TZ)).toEqual({ day: 0, minutes: 0 })
  })

  it('una zona mal cargada no rompe: usa la de Córdoba', () => {
    expect(localClock(at(MON, '09:15'), 'No/Existe')).toEqual({ day: 1, minutes: 555 })
  })
})

describe('¿se muestra ahora?', () => {
  it('sin horario, siempre', () => {
    expect(isAvailableAt(null, at(MON, '03:00'), TZ)).toBe(true)
    expect(isAvailableAt({ windows: [] }, at(MON, '03:00'), TZ)).toBe(true)
  })

  it('el menú del mediodía: de lunes a viernes de 12 a 16', () => {
    expect(isAvailableAt(LUNCH, at(MON, '11:59'), TZ)).toBe(false)
    expect(isAvailableAt(LUNCH, at(MON, '12:00'), TZ)).toBe(true)
    expect(isAvailableAt(LUNCH, at(FRI, '15:59'), TZ)).toBe(true)
    expect(isAvailableAt(LUNCH, at(FRI, '16:00'), TZ)).toBe(false)
    // El fin de semana no aparece, aunque sea mediodía.
    expect(isAvailableAt(LUNCH, at(SAT, '13:00'), TZ)).toBe(false)
    expect(isAvailableAt(LUNCH, at(SUN, '13:00'), TZ)).toBe(false)
  })

  it('el menú del fin de semana: sábados y domingos, todo el día', () => {
    expect(isAvailableAt(WEEKEND, at(FRI, '23:59'), TZ)).toBe(false)
    expect(isAvailableAt(WEEKEND, at(SAT, '00:00'), TZ)).toBe(true)
    expect(isAvailableAt(WEEKEND, at(SUN, '23:59'), TZ)).toBe(true)
    expect(isAvailableAt(WEEKEND, at(MON, '00:00'), TZ)).toBe(false)
  })

  it('una franja que cruza la medianoche: la madrugada es del día en que empezó', () => {
    expect(isAvailableAt(NIGHT, at(FRI, '19:59'), TZ)).toBe(false)
    expect(isAvailableAt(NIGHT, at(FRI, '20:00'), TZ)).toBe(true)
    // Sábado a las 2: sigue siendo la noche del viernes.
    expect(isAvailableAt(NIGHT, at(SAT, '02:00'), TZ)).toBe(true)
    // Domingo a las 2: la noche del sábado.
    expect(isAvailableAt(NIGHT, at(SUN, '02:59'), TZ)).toBe(true)
    expect(isAvailableAt(NIGHT, at(SUN, '03:00'), TZ)).toBe(false)
    // Viernes a las 2 es la noche del jueves, que no está.
    expect(isAvailableAt(NIGHT, at(FRI, '02:00'), TZ)).toBe(false)
    expect(isAvailableAt(NIGHT, at(SUN, '21:00'), TZ)).toBe(false)
  })

  it('con varias franjas alcanza con que valga una', () => {
    const both: Availability = { windows: [...(LUNCH?.windows ?? []), ...(WEEKEND?.windows ?? [])] }
    expect(isAvailableAt(both, at(MON, '13:00'), TZ)).toBe(true)
    expect(isAvailableAt(both, at(SAT, '21:00'), TZ)).toBe(true)
    expect(isAvailableAt(both, at(MON, '21:00'), TZ)).toBe(false)
  })

  it('solo «desde» o solo «hasta»', () => {
    const from: Availability = { windows: [{ days: [], from: '18:00', to: null }] }
    const until: Availability = { windows: [{ days: [], from: null, to: '11:30' }] }
    expect(isAvailableAt(from, at(MON, '17:59'), TZ)).toBe(false)
    expect(isAvailableAt(from, at(MON, '23:59'), TZ)).toBe(true)
    expect(isAvailableAt(until, at(MON, '11:29'), TZ)).toBe(true)
    expect(isAvailableAt(until, at(MON, '11:30'), TZ)).toBe(false)
  })
})

describe('cuándo volver a mirar', () => {
  it('nada tiene horario: no hace falta', () => {
    expect(minutesToNextChange([null, null], at(MON, '10:00'), TZ)).toBeNull()
  })

  it('el próximo comienzo o final de una franja', () => {
    expect(minutesToNextChange([LUNCH], at(MON, '11:40'), TZ)).toBe(20)
    expect(minutesToNextChange([LUNCH], at(MON, '12:00'), TZ)).toBe(240)
    expect(minutesToNextChange([LUNCH, NIGHT], at(MON, '16:30'), TZ)).toBe(210)
  })

  it('la medianoche siempre cuenta: cambia el día', () => {
    expect(minutesToNextChange([WEEKEND], at(FRI, '23:30'), TZ)).toBe(30)
    expect(minutesToNextChange([LUNCH], at(MON, '17:00'), TZ)).toBe(7 * 60)
  })
})

describe('en el árbol de la carta', () => {
  const tree = [
    { id: 'comida', parent_id: null, availability: null },
    { id: 'mediodia', parent_id: null, availability: LUNCH },
    { id: 'mediodia-platos', parent_id: 'mediodia', availability: null },
    { id: 'finde', parent_id: null, availability: WEEKEND },
    { id: 'pizzas', parent_id: 'comida', availability: null },
  ]

  it('un rubro fuera de horario se lleva todo lo que cuelga de él', () => {
    expect([...hiddenCategoryIds(tree, at(MON, '21:00'), TZ)].sort()).toEqual([
      'finde',
      'mediodia',
      'mediodia-platos',
    ])
    expect([...hiddenCategoryIds(tree, at(MON, '13:00'), TZ)]).toEqual(['finde'])
    expect([...hiddenCategoryIds(tree, at(SAT, '13:00'), TZ)].sort()).toEqual([
      'mediodia',
      'mediodia-platos',
    ])
  })

  it('un subrubro puede tener su propio horario adentro de uno que siempre está', () => {
    const nested = [
      { id: 'bebidas', parent_id: null, availability: null },
      {
        id: 'happy',
        parent_id: 'bebidas',
        availability: { windows: [{ days: [], from: '18:00', to: '20:00' }] },
      },
    ]
    expect([...hiddenCategoryIds(nested, at(MON, '17:00'), TZ)]).toEqual(['happy'])
    expect([...hiddenCategoryIds(nested, at(MON, '18:30'), TZ)]).toEqual([])
  })

  it('un horario ilegible o un círculo no esconden ni cuelgan nada', () => {
    const broken = [
      { id: 'a', parent_id: 'b', availability: 'cualquier cosa' },
      { id: 'b', parent_id: 'a', availability: { windows: 'no' } },
    ]
    expect([...hiddenCategoryIds(broken, at(MON, '13:00'), TZ)]).toEqual([])
  })
})

describe('lo que se guarda', () => {
  it('todos los días y todo el día es «siempre»', () => {
    expect(normalizeAvailability({ windows: [{ days: [], from: null, to: null }] })).toBeNull()
    expect(
      normalizeAvailability({
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '00:00' }],
      }),
    ).toBeNull()
    expect(normalizeAvailability({ windows: [] })).toBeNull()
  })

  it('ordena y saca los días repetidos', () => {
    expect(
      normalizeAvailability({ windows: [{ days: [5, 1, 5, 3], from: '12:00', to: '16:00' }] }),
    ).toEqual({
      windows: [{ days: [1, 3, 5], from: '12:00', to: '16:00' }],
    })
  })

  it('rechaza horas que no son horas', () => {
    expect(
      availabilitySchema.safeParse({ windows: [{ days: [1], from: '25:00', to: null }] }).success,
    ).toBe(false)
    expect(
      availabilitySchema.safeParse({ windows: [{ days: [9], from: null, to: null }] }).success,
    ).toBe(false)
    expect(parseAvailability({ windows: [{ days: [1], from: '12:00', to: '16:00' }] })).toEqual({
      windows: [{ days: [1], from: '12:00', to: '16:00' }],
    })
    expect(parseAvailability('roto')).toBeNull()
  })

  it('dos horarios iguales escritos distinto son el mismo', () => {
    expect(
      sameAvailability(
        { windows: [{ days: [5, 1], from: '12:00', to: '16:00' }] },
        { windows: [{ days: [1, 5], from: '12:00', to: '16:00' }] },
      ),
    ).toBe(true)
    expect(sameAvailability(null, { windows: [] })).toBe(true)
    expect(sameAvailability(LUNCH, WEEKEND)).toBe(false)
  })
})

describe('dicho en palabras', () => {
  it('los días', () => {
    expect(daysWords([1, 2, 3, 4, 5])).toBe('lunes a viernes')
    expect(daysWords([6, 0])).toBe('sábados y domingos')
    expect(daysWords([2, 4, 6])).toBe('martes, jueves y sábados')
    expect(daysWords([])).toBe('todos los días')
    expect(daysWords([5, 6, 0])).toBe('viernes a domingos')
    expect(daysWords([3])).toBe('miércoles')
  })

  it('las horas', () => {
    expect(hoursWords({ from: '12:00', to: '16:00' })).toBe('de 12 a 16 h')
    expect(hoursWords({ from: '12:30', to: '15:45' })).toBe('de 12:30 a 15:45 h')
    expect(hoursWords({ from: null, to: null })).toBe('todo el día')
    expect(hoursWords({ from: '18:00', to: null })).toBe('desde las 18 h')
    expect(hoursWords({ from: null, to: '11:30' })).toBe('hasta las 11:30 h')
  })

  it('el horario entero', () => {
    expect(availabilityWords(LUNCH)).toBe('Lunes a viernes de 12 a 16 h')
    expect(availabilityWords(WEEKEND)).toBe('Sábados y domingos todo el día')
    expect(availabilityWords(null)).toBeNull()
    expect(
      availabilityWords({
        windows: [
          { days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' },
          { days: [0, 6], from: '12:00', to: '17:00' },
        ],
      }),
    ).toBe('Lunes a viernes de 12 a 16 h · Sábados y domingos de 12 a 17 h')
  })
})

describe('al milisegundo', () => {
  it('descuenta lo que ya pasó del minuto', () => {
    const at = new Date(`${MON}T11:59:30.250-03:00`)
    expect(minutesToNextChange([LUNCH], at, TZ)).toBe(1)
    expect(msToNextChange([LUNCH], at, TZ)).toBe(29_750)
    expect(msToNextChange([LUNCH], new Date(`${MON}T12:00:00.000-03:00`), TZ)).toBe(4 * 3_600_000)
    expect(msToNextChange([null], at, TZ)).toBeNull()
  })
})

describe('la carta como se ve ahora', () => {
  const menu = {
    categories: [
      { id: 'comida', parent_id: null, availability: null },
      { id: 'mediodia', parent_id: null, availability: LUNCH },
      { id: 'mediodia-platos', parent_id: 'mediodia', availability: null },
      { id: 'finde', parent_id: null, availability: WEEKEND },
    ],
    items: [
      { id: 'pizza', category_id: 'comida' },
      { id: 'milanesa-ejecutiva', category_id: 'mediodia-platos' },
      { id: 'menu-del-dia', category_id: 'mediodia' },
      { id: 'brunch', category_id: 'finde' },
    ],
  }
  const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((row) => row.id)

  it('un lunes al mediodía: el menú del mediodía sí, el del fin de semana no', () => {
    const now = visibleNow(menu, at(MON, '13:00'), TZ)
    expect(ids(now.categories)).toEqual(['comida', 'mediodia', 'mediodia-platos'])
    expect(ids(now.items)).toEqual(['pizza', 'milanesa-ejecutiva', 'menu-del-dia'])
    // A las 16 se va el del mediodía: en tres horas.
    expect(now.changeInMs).toBe(3 * 3_600_000)
  })

  it('un lunes a la noche solo queda lo de siempre', () => {
    const now = visibleNow(menu, at(MON, '21:00'), TZ)
    expect(ids(now.categories)).toEqual(['comida'])
    expect(ids(now.items)).toEqual(['pizza'])
    // La medianoche cambia el día.
    expect(now.changeInMs).toBe(3 * 3_600_000)
  })

  it('un sábado: «fines de semana debe aparecer únicamente el menú del fin de semana»', () => {
    const now = visibleNow(menu, at(SAT, '13:00'), TZ)
    expect(ids(now.categories)).toEqual(['comida', 'finde'])
    expect(ids(now.items)).toEqual(['pizza', 'brunch'])
  })

  it('sin horarios no saca nada ni pide volver a mirar', () => {
    const plain = {
      categories: [{ id: 'comida', parent_id: null, availability: null }],
      items: [{ id: 'pizza', category_id: 'comida' }],
    }
    const now = visibleNow(plain, at(MON, '13:00'), TZ)
    expect(now.changeInMs).toBeNull()
    expect(ids(now.categories)).toEqual(['comida'])
    expect(ids(now.items)).toEqual(['pizza'])
    // Y una carta sin la columna (antes de la migración) se lee igual.
    expect(
      visibleNow({ categories: [{ id: 'a', parent_id: null }], items: [] }, at(MON, '13:00'), TZ)
        .changeInMs,
    ).toBeNull()
  })
})

describe('la oración del editor', () => {
  it('lo dice como se dice', () => {
    expect(availabilitySentence(null)).toBe('Se muestra siempre.')
    expect(availabilitySentence(LUNCH)).toBe('Se muestra de lunes a viernes de 12 a 16 h.')
    expect(availabilitySentence(WEEKEND)).toBe('Se muestra los sábados y domingos todo el día.')
    expect(availabilitySentence({ windows: [{ days: [], from: '20:00', to: '03:00' }] })).toBe(
      'Se muestra todos los días de 20 a 3 h.',
    )
    expect(
      availabilitySentence({
        windows: [
          { days: [1, 2, 3, 4, 5], from: '12:00', to: '16:00' },
          { days: [0, 6], from: '12:00', to: '17:00' },
        ],
      }),
    ).toBe('Se muestra de lunes a viernes de 12 a 16 h y los sábados y domingos de 12 a 17 h.')
    // Una franja de todos los días y todo el día es «siempre».
    expect(availabilitySentence({ windows: [{ days: [], from: null, to: null }] })).toBe(
      'Se muestra siempre.',
    )
  })
})

describe('lo que se edita', () => {
  it('ida y vuelta: lo guardado sale igual después de pasar por el editor', () => {
    for (const preset of AVAILABILITY_PRESETS) {
      expect(sameAvailability(fromDrafts(toDrafts(preset.value)), preset.value), preset.id).toBe(
        true,
      )
    }
    const half: Availability = { windows: [{ days: [2], from: '18:00', to: null }] }
    expect(fromDrafts(toDrafts(half))).toEqual(half)
    const until: Availability = { windows: [{ days: [2], from: null, to: '11:30' }] }
    expect(fromDrafts(toDrafts(until))).toEqual(until)
  })

  it('en el editor los días van siempre a la vista y las horas quedan escritas', () => {
    expect(toDrafts(null)).toEqual([])
    expect(toDrafts(WEEKEND)).toEqual([{ days: [0, 6], allDay: true, from: '12:00', to: '16:00' }])
    expect(toDrafts({ windows: [{ days: [], from: '20:00', to: '03:00' }] })).toEqual([
      { days: [0, 1, 2, 3, 4, 5, 6], allDay: false, from: '20:00', to: '03:00' },
    ])
  })

  it('una franja nueva de todos los días y con horas no es «siempre»', () => {
    expect(fromDrafts([newWindowDraft()])).toEqual({
      windows: [{ days: [], from: '12:00', to: '16:00' }],
    })
    expect(fromDrafts([{ ...newWindowDraft(), allDay: true }])).toBeNull()
    expect(fromDrafts([])).toBeNull()
  })

  it('el último día no se apaga', () => {
    const draft = { ...newWindowDraft(), days: [1, 2] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] }
    const one = toggleDraftDay(draft, 2)
    expect(one.days).toEqual([1])
    expect(toggleDraftDay(one, 1)).toBe(one)
    expect(toggleDraftDay(one, 0).days).toEqual([0, 1])
  })

  it('avisa cuando la franja termina al día siguiente', () => {
    expect(crossesMidnight({ allDay: false, from: '20:00', to: '03:00' })).toBe(true)
    expect(crossesMidnight({ allDay: false, from: '12:00', to: '16:00' })).toBe(false)
    expect(crossesMidnight({ allDay: true, from: '20:00', to: '03:00' })).toBe(false)
    expect(crossesMidnight({ allDay: false, from: '20:00', to: '' })).toBe(false)
  })
})
