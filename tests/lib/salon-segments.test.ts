import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeDaySegments,
  computeMonthSegments,
  currentSegment,
  type DaySegmentsSnapshot,
  dayCelebrations,
  eventLoadsById,
  eventSegmentMap,
  focusSegment,
  groupReservationsBySegment,
  isoDowOf,
  isSegmentConfigured,
  isSegmentKey,
  mealTypeForSegment,
  projectReservation,
  type ReservationCandidate,
  resolveDaySegmentCaps,
  resolveSegmentSettings,
  SEGMENT_KEYS,
  type SegmentConfig,
  type SegmentEventInput,
  type SegmentReservationInput,
  segmentOfMealType,
  segmentOfReservation,
  segmentOfTime,
  suggestedCapacityRaise,
  VIRTUAL_EVENT_ID,
} from '@/lib/salon/segments'

// ──────────────────────────────────────────────────────────
// Fixtures sintéticos (espejan días reales del HUB, sin leer la DB)
// ──────────────────────────────────────────────────────────

let seq = 0
function res(p: Partial<SegmentReservationInput> = {}): SegmentReservationInput {
  seq += 1
  return {
    id: `r${seq}`,
    reservation_date: '2026-09-10',
    meal_type: 'dinner',
    reservation_time_local: '21:00:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    status: 'pending',
    estimated_guests: 2,
    actual_guests: null,
    kind: 'normal',
    cake_count: 0,
    ...p,
  }
}

function ev(
  p: Partial<SegmentEventInput> & { id: string; name: string; color?: string },
): SegmentEventInput {
  const { name, color, ...rest } = p
  return {
    event_date: '2026-09-10',
    starts_at_local: '21:00:00',
    capacity: 70,
    name_override: null,
    template: { name, color_hex: color ?? '#e11d48' },
    ...rest,
  }
}

const HUB_CONFIG: SegmentConfig = {
  weekly: [
    ...([1, 2, 3, 4, 5] as const).map((iso_dow) => ({
      segment: 'lunch' as const,
      iso_dow,
      capacity: 70,
      warn_at: 50,
    })),
    ...([6, 7] as const).map((iso_dow) => ({
      segment: 'lunch' as const,
      iso_dow,
      capacity: 120,
      warn_at: null,
    })),
    ...([1, 2, 3, 4, 5, 6, 7] as const).flatMap((iso_dow) => [
      { segment: 'tea_time' as const, iso_dow, capacity: 120, warn_at: null },
      { segment: 'dinner' as const, iso_dow, capacity: 120, warn_at: null },
    ]),
  ],
  settings: [
    { segment: 'lunch', default_time: '13:00', warn_note: 'Conviene abrir la terraza' },
    { segment: 'tea_time', default_time: '15:30', warn_note: null },
    { segment: 'dinner', default_time: '21:00', warn_note: null },
  ],
  overrides: [],
  fallbackTotal: 130,
}

function day(
  date: string,
  reservations: SegmentReservationInput[],
  events: SegmentEventInput[],
  config: SegmentConfig = HUB_CONFIG,
) {
  return computeDaySegments({
    date,
    reservations,
    events,
    caps: resolveDaySegmentCaps(date, config),
  })
}

function snapshotOf(
  date: string,
  reservations: SegmentReservationInput[],
  events: SegmentEventInput[],
  config: SegmentConfig = HUB_CONFIG,
): DaySegmentsSnapshot {
  return {
    date,
    caps: resolveDaySegmentCaps(date, config),
    settings: resolveSegmentSettings(config.settings),
    reservations,
    events,
  }
}

function candidate(p: Partial<ReservationCandidate> = {}): ReservationCandidate {
  return {
    reservation_date: '2026-09-10',
    meal_type: 'dinner',
    reservation_time_local: '21:00',
    scheduled_event_id: null,
    zone: 'planta_alta',
    guests: 4,
    kind: 'normal',
    cake_count: 0,
    ...p,
  }
}

/** Jueves 10/09: el día del "171 de 130" que motivó todo. */
function sep10() {
  const sushi = ev({ id: 'sushi', name: 'Sushi libre', capacity: 70 })
  const reservations = [
    res({
      meal_type: 'lunch',
      reservation_time_local: '13:00:00',
      zone: 'planta_baja',
      estimated_guests: 19,
    }),
    res({
      meal_type: 'tea_time',
      reservation_time_local: '16:00:00',
      zone: 'planta_baja',
      estimated_guests: 20,
    }),
    res({
      meal_type: 'tea_time',
      reservation_time_local: '16:00:00',
      zone: 'planta_baja',
      estimated_guests: 13,
    }),
    // Atadas a Sushi libre. La de 40 ya tiene el real cargado (R4: pesa el real).
    res({
      scheduled_event_id: 'sushi',
      zone: 'event_floating',
      meal_type: 'hub_event',
      estimated_guests: 36,
      actual_guests: 40,
    }),
    res({
      scheduled_event_id: 'sushi',
      zone: 'event_floating',
      estimated_guests: 18,
      kind: 'birthday',
      cake_count: 1,
    }),
    res({ scheduled_event_id: 'sushi', zone: 'event_floating', estimated_guests: 15 }),
    // Normales en Planta Alta.
    res({ id: 'n16', estimated_guests: 16 }),
    res({ estimated_guests: 15, kind: 'birthday' }),
    res({ estimated_guests: 15, kind: 'birthday' }),
    // No ocupan lugar.
    res({ estimated_guests: 10, status: 'cancelled' }),
    res({ estimated_guests: 6, status: 'no_show' }),
  ]
  return { reservations, events: [sushi] }
}

/** Sábado 19/09: Pizza libre de 140 sin atadas y 133 normales. */
function sep19() {
  const date = '2026-09-19'
  const pizza = ev({ id: 'pizza19', name: 'Pizza libre', capacity: 140, event_date: date })
  const reservations = [
    res({ reservation_date: date, estimated_guests: 40 }),
    res({ reservation_date: date, estimated_guests: 36 }),
    res({ reservation_date: date, zone: 'planta_baja', estimated_guests: 30 }),
    res({ reservation_date: date, zone: 'planta_baja', estimated_guests: 27 }),
  ]
  return { date, reservations, events: [pizza] }
}

/** Lunes 21/09: 29 personas en PA colgadas de Pizza libre. */
function sep21() {
  const date = '2026-09-21'
  const pizza = ev({ id: 'pizza21', name: 'Pizza libre', capacity: 140, event_date: date })
  const tied = { reservation_date: date, scheduled_event_id: 'pizza21' }
  const reservations = [
    res({ ...tied, zone: 'planta_alta', estimated_guests: 15, kind: 'birthday', cake_count: 1 }),
    res({ ...tied, zone: 'planta_alta', estimated_guests: 14, kind: 'birthday', cake_count: 1 }),
    res({ ...tied, zone: 'event_floating', estimated_guests: 50 }),
    res({ ...tied, zone: 'event_floating', estimated_guests: 39 }),
    res({ reservation_date: date, zone: 'planta_baja', estimated_guests: 11 }),
  ]
  return { date, reservations, events: [pizza] }
}

/** Martes 22/09: 2x1 Burger 100 + Ratatuille 50, sin normales. */
function sep22() {
  const date = '2026-09-22'
  const burger = ev({ id: 'burger', name: '2x1 Burger', capacity: 100, event_date: date })
  const rata = ev({ id: 'rata', name: 'Ratatuille', capacity: 50, event_date: date })
  const tied = {
    reservation_date: date,
    scheduled_event_id: 'rata',
    zone: 'event_floating' as const,
  }
  const reservations = [
    res({ ...tied, estimated_guests: 30 }),
    res({ ...tied, estimated_guests: 24, kind: 'birthday' }),
  ]
  return { date, reservations, events: [burger, rata] }
}

/** Jueves 03/09: Pizza libre 140 + Fernet 100 y 4 normales. */
function sep03() {
  const date = '2026-09-03'
  const pizza = ev({ id: 'pizza03', name: 'Pizza libre', capacity: 140, event_date: date })
  const fernet = ev({ id: 'fernet', name: 'Fernet', capacity: 100, event_date: date })
  const reservations = [
    res({ reservation_date: date, scheduled_event_id: 'pizza03', estimated_guests: 40 }),
    res({ reservation_date: date, scheduled_event_id: 'fernet', estimated_guests: 27 }),
    res({ reservation_date: date, estimated_guests: 4 }),
  ]
  return { date, reservations, events: [pizza, fernet] }
}

/** Martes 15/09: 2x1 Burger Martes 120, 65 atadas y 31 normales. */
function sep15() {
  const date = '2026-09-15'
  const burger = ev({ id: 'burger15', name: '2x1 Burger Martes', capacity: 120, event_date: date })
  const reservations = [
    res({ reservation_date: date, scheduled_event_id: 'burger15', estimated_guests: 65 }),
    res({ reservation_date: date, estimated_guests: 31 }),
  ]
  return { date, reservations, events: [burger] }
}

/** Sábado 03/10: Merienda Libre cargada a las 21:00 con su reserva a las 16:30. */
function oct03() {
  const date = '2026-10-03'
  const merienda = ev({ id: 'merienda', name: 'Merienda Libre', capacity: 33, event_date: date })
  const reservations = [
    res({
      reservation_date: date,
      scheduled_event_id: 'merienda',
      meal_type: 'tea_time',
      reservation_time_local: '16:30:00',
      zone: 'event_floating',
      estimated_guests: 33,
      kind: 'birthday',
      cake_count: 1,
    }),
    res({ reservation_date: date, estimated_guests: 75 }),
  ]
  return { date, reservations, events: [merienda] }
}

function lunchOnThursday(guests: number, config: SegmentConfig = HUB_CONFIG) {
  return day(
    '2026-09-10',
    [
      res({
        meal_type: 'lunch',
        reservation_time_local: '13:00:00',
        zone: 'planta_baja',
        estimated_guests: guests,
      }),
    ],
    [],
    config,
  ).segments.lunch
}

// ──────────────────────────────────────────────────────────
// Clasificación
// ──────────────────────────────────────────────────────────

describe('segmentOfTime', () => {
  it.each([
    ['00:30', 'dinner'],
    ['04:59', 'dinner'],
    ['05:00', 'lunch'],
    ['13:00:00', 'lunch'],
    ['14:59', 'lunch'],
    ['15:00', 'tea_time'],
    ['18:59', 'tea_time'],
    ['19:00', 'dinner'],
    ['23:30', 'dinner'],
  ] as const)('%s → %s', (time, expected) => {
    expect(segmentOfTime(time)).toBe(expected)
  })

  it('una hora ilegible cae en la cena', () => {
    expect(segmentOfTime('')).toBe('dinner')
    expect(segmentOfTime('xx:yy')).toBe('dinner')
  })
})

describe('segmentOfMealType / mealTypeForSegment', () => {
  it.each([
    ['breakfast', 'lunch'],
    ['lunch', 'lunch'],
    ['tea_time', 'tea_time'],
    ['dinner', 'dinner'],
    ['hub_event', 'dinner'],
  ] as const)('%s → %s', (meal, expected) => {
    expect(segmentOfMealType(meal)).toBe(expected)
  })

  it('mealTypeForSegment es la inversa sobre los 3 servicios (nunca hub_event)', () => {
    for (const key of SEGMENT_KEYS) {
      expect(segmentOfMealType(mealTypeForSegment(key))).toBe(key)
    }
    expect(mealTypeForSegment('dinner')).toBe('dinner')
  })

  it('isSegmentKey solo acepta los 3 servicios', () => {
    expect(isSegmentKey('tea_time')).toBe(true)
    expect(isSegmentKey('breakfast')).toBe(false)
    expect(isSegmentKey('hub_event')).toBe(false)
    expect(isSegmentKey(3)).toBe(false)
  })
})

describe('segmentOfReservation', () => {
  const ramen = ev({ id: 'ramen', name: 'Ramen', starts_at_local: '21:00:00' })
  const map = eventSegmentMap([ramen])

  it('colgada de un evento a las 21:00 → cena, aunque su meal_type diga otra cosa', () => {
    expect(segmentOfReservation({ scheduled_event_id: 'ramen', meal_type: 'tea_time' }, map)).toBe(
      'dinner',
    )
    expect(segmentOfReservation({ scheduled_event_id: 'ramen', meal_type: 'lunch' }, map)).toBe(
      'dinner',
    )
  })

  it('sin evento manda el meal_type, no la hora (R3)', () => {
    const r = res({ meal_type: 'lunch', reservation_time_local: '21:30:00' })
    expect(segmentOfReservation(r, map)).toBe('lunch')
  })

  it('evento que no vino en la lista → servicio por meal_type', () => {
    expect(
      segmentOfReservation({ scheduled_event_id: 'otro-dia', meal_type: 'tea_time' }, map),
    ).toBe('tea_time')
  })
})

describe('isoDowOf', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const cases = [
    ['2026-09-21', 1],
    ['2026-09-10', 4],
    ['2026-10-03', 6],
    ['2026-09-27', 7],
  ] as const

  it.each(cases)('%s → %i', (date, expected) => {
    expect(isoDowOf(date)).toBe(expected)
  })

  it('da lo mismo con TZ=UTC y con TZ=America/Argentina/Cordoba', () => {
    vi.stubEnv('TZ', 'UTC')
    const utc = cases.map(([date]) => isoDowOf(date))
    vi.stubEnv('TZ', 'America/Argentina/Cordoba')
    // Control: la TZ cambió de verdad. Con `new Date(fecha)` en Córdoba el
    // lunes 21/09 es domingo (medianoche UTC = 21:00 del 20): el bug que evita
    // isoDowOf.
    expect(new Date('2026-09-21').getDay()).toBe(0)
    const cordoba = cases.map(([date]) => isoDowOf(date))
    expect(cordoba).toEqual(utc)
    expect(cordoba).toEqual(cases.map(([, expected]) => expected))
  })
})

describe('currentSegment', () => {
  it.each([
    [120, 'dinner'],
    [600, 'lunch'],
    [960, 'tea_time'],
    [1300, 'dinner'],
  ] as const)('%i → %s', (minutes, expected) => {
    expect(currentSegment(minutes)).toBe(expected)
  })
})

// ──────────────────────────────────────────────────────────
// Cupo del servicio
// ──────────────────────────────────────────────────────────

describe('resolveDaySegmentCaps', () => {
  it('jueves 10/09: almuerzo 70 con aviso en 50 y su nota; merienda y cena 120', () => {
    const caps = resolveDaySegmentCaps('2026-09-10', HUB_CONFIG)
    expect(caps.lunch).toEqual({
      capacity: 70,
      warnAt: 50,
      warnNote: 'Conviene abrir la terraza',
      source: 'weekly',
      overrideReason: null,
    })
    expect(caps.tea_time).toMatchObject({ capacity: 120, warnAt: null, source: 'weekly' })
    expect(caps.dinner).toMatchObject({ capacity: 120, warnAt: null, source: 'weekly' })
  })

  it('domingo 27/09: almuerzo 120 sin aviso', () => {
    expect(resolveDaySegmentCaps('2026-09-27', HUB_CONFIG).lunch).toMatchObject({
      capacity: 120,
      warnAt: null,
    })
  })

  it('el cupo especial gana y NO hereda el aviso semanal', () => {
    const config: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        {
          segment: 'lunch',
          override_date: '2026-10-12',
          capacity: 120,
          warn_at: null,
          reason: 'Feriado',
        },
      ],
    }
    const caps = resolveDaySegmentCaps('2026-10-12', config)
    expect(caps.lunch).toMatchObject({
      capacity: 120,
      warnAt: null,
      source: 'override',
      overrideReason: 'Feriado',
    })
    // Los otros servicios del día siguen con el semanal.
    expect(caps.dinner.source).toBe('weekly')
  })

  it('config vacía → cupo general (PA + PB) en los 3', () => {
    const caps = resolveDaySegmentCaps('2026-09-10', {
      weekly: [],
      overrides: [],
      settings: [],
      fallbackTotal: 130,
    })
    for (const key of SEGMENT_KEYS) {
      expect(caps[key]).toMatchObject({ capacity: 130, source: 'fallback', warnAt: null })
    }
  })

  it('sin cupo general → sin tope', () => {
    const caps = resolveDaySegmentCaps('2026-09-10', {
      weekly: [],
      overrides: [],
      settings: [],
      fallbackTotal: 0,
    })
    expect(caps.dinner).toMatchObject({ capacity: null, source: 'none' })
  })

  it('semanal con cupo 0 → cerrado (0, no sin tope)', () => {
    const caps = resolveDaySegmentCaps('2026-09-10', {
      ...HUB_CONFIG,
      weekly: [{ segment: 'lunch', iso_dow: 4, capacity: 0, warn_at: null }],
    })
    expect(caps.lunch).toMatchObject({ capacity: 0, source: 'weekly' })
  })
})

describe('resolveSegmentSettings', () => {
  it('sin filas → 13:00 / 15:30 / 21:00 y sin nota', () => {
    expect(resolveSegmentSettings([])).toEqual({
      lunch: { defaultTime: '13:00', warnNote: null },
      tea_time: { defaultTime: '15:30', warnNote: null },
      dinner: { defaultTime: '21:00', warnNote: null },
    })
  })

  it('recorta el HH:MM:SS de la columna time y limpia la nota vacía', () => {
    const s = resolveSegmentSettings([
      { segment: 'dinner', default_time: '20:30:00', warn_note: '  ' },
    ])
    expect(s.dinner).toEqual({ defaultTime: '20:30', warnNote: null })
    expect(s.lunch.defaultTime).toBe('13:00')
  })
})

// ──────────────────────────────────────────────────────────
// Cálculo del día
// ──────────────────────────────────────────────────────────

describe('computeDaySegments', () => {
  it('10/09: la cena es Sushi libre 73/70 + 46 normales = 119 de 120 (ámbar)', () => {
    const { reservations, events } = sep10()
    const d = day('2026-09-10', reservations, events)
    expect(d.isoDow).toBe(4)
    expect(d.segments.dinner).toMatchObject({
      capacity: 120,
      eventCapSum: 70,
      reservedForEvents: 70,
      eventUsed: 73,
      eventSeats: 73,
      normalUsed: 46,
      normalCap: 50,
      people: 119,
      occupied: 119,
      freeForNormal: 1,
      status: 'warn',
      cause: 'near_full',
      eventExceedsSegment: false,
      birthdays: { total: 3, inEvents: 1 },
      cakes: { total: 1, inEvents: 1 },
      byZone: { planta_alta: 46, planta_baja: 0, event_floating: 73 },
      activeReservations: 6,
      hasActivity: true,
    })
    expect(d.segments.dinner.events).toHaveLength(1)
    expect(d.segments.dinner.events[0]).toMatchObject({
      id: 'sushi',
      name: 'Sushi libre',
      startsAt: '21:00',
      colorHex: '#e11d48',
      used: 73,
      capacity: 70,
      over: true,
      birthdays: 1,
      cakes: 1,
      reservations: 3,
    })
    expect(d.segments.lunch).toMatchObject({ people: 19, capacity: 70, status: 'ok' })
    expect(d.segments.tea_time).toMatchObject({ people: 33, capacity: 120, status: 'ok' })
    expect(d.mismatches).toEqual([])
  })

  it('19/09: Pizza libre 140 aparta toda la cena → rojo por personas, número principal 133', () => {
    const { date, reservations, events } = sep19()
    const d = day(date, reservations, events)
    expect(d.segments.dinner).toMatchObject({
      reservedForEvents: 120,
      eventSeats: 120,
      normalCap: 0,
      people: 133,
      occupied: 253,
      freeForNormal: 0,
      status: 'over',
      cause: 'people_over',
      eventExceedsSegment: true,
    })
    expect(d.segments.lunch).toMatchObject({ capacity: 120, hasActivity: false })
  })

  it('21/09: las atadas en Planta Alta cuentan en el evento, no como normales', () => {
    const { date, reservations, events } = sep21()
    const dinner = day(date, reservations, events).segments.dinner
    expect(dinner).toMatchObject({
      eventUsed: 118,
      normalUsed: 11,
      people: 129,
      eventSeats: 120,
      occupied: 131,
      status: 'over',
      cause: 'people_over',
      birthdays: { total: 2, inEvents: 2 },
      cakes: { total: 2, inEvents: 2 },
      byZone: { planta_alta: 29, planta_baja: 11, event_floating: 89 },
    })
  })

  it('22/09: dos eventos se llevan la cena → ámbar con 54 personas', () => {
    const { date, reservations, events } = sep22()
    const dinner = day(date, reservations, events).segments.dinner
    expect(dinner).toMatchObject({
      eventCapSum: 150,
      reservedForEvents: 120,
      eventSeats: 120,
      occupied: 120,
      people: 54,
      status: 'warn',
      cause: 'near_full',
      freeForNormal: 0,
      eventExceedsSegment: true,
    })
    expect(dinner.events.find((e) => e.id === 'rata')).toMatchObject({ used: 54, over: true })
    expect(dinner.events.find((e) => e.id === 'burger')).toMatchObject({ used: 0, over: false })
  })

  it('03/09: las normales pisan lo que apartaron los eventos → normals_over', () => {
    const { date, reservations, events } = sep03()
    expect(day(date, reservations, events).segments.dinner).toMatchObject({
      status: 'over',
      cause: 'normals_over',
      people: 71,
      occupied: 124,
    })
  })

  it('15/09: 2x1 Burger Martes aparta 120 y hay 31 normales → normals_over', () => {
    const { date, reservations, events } = sep15()
    expect(day(date, reservations, events).segments.dinner).toMatchObject({
      status: 'over',
      cause: 'normals_over',
      people: 96,
      occupied: 151,
    })
  })

  it('03/10: el evento a las 21:00 manda a la cena su reserva de merienda y lo avisa', () => {
    const { date, reservations, events } = oct03()
    const d = day(date, reservations, events)
    expect(d.segments.dinner).toMatchObject({
      people: 108,
      eventSeats: 33,
      occupied: 108,
      status: 'warn',
    })
    expect(d.segments.tea_time.hasActivity).toBe(false)
    expect(d.mismatches).toEqual([
      {
        eventId: 'merienda',
        eventName: 'Merienda Libre',
        startsAt: '21:00',
        eventSegment: 'dinner',
        reservationsSegment: 'tea_time',
        reservations: 1,
        people: 33,
      },
    ])
  })

  it('mismatch: el servicio de las reservas es el más frecuente', () => {
    const date = '2026-09-26'
    const arte = ev({
      id: 'arte',
      name: 'Merienda y Arte',
      starts_at_local: '13:00:00',
      event_date: date,
    })
    const tied = { reservation_date: date, scheduled_event_id: 'arte' }
    const d = day(
      date,
      [
        res({ ...tied, reservation_time_local: '16:00:00', estimated_guests: 4 }),
        res({ ...tied, reservation_time_local: '16:30:00', estimated_guests: 2 }),
        res({ ...tied, reservation_time_local: '21:00:00', estimated_guests: 10 }),
        res({ ...tied, reservation_time_local: '13:00:00', estimated_guests: 3 }),
        res({ ...tied, reservation_time_local: '16:00:00', status: 'cancelled' }),
      ],
      [arte],
    )
    expect(d.mismatches).toEqual([
      {
        eventId: 'arte',
        eventName: 'Merienda y Arte',
        startsAt: '13:00',
        eventSegment: 'lunch',
        reservationsSegment: 'tea_time',
        reservations: 3,
        people: 16,
      },
    ])
    // Solo avisa: el evento sigue contando en el almuerzo.
    expect(d.segments.lunch.eventUsed).toBe(19)
  })

  it('aviso del almuerzo (jueves, aviso en 50)', () => {
    expect(lunchOnThursday(52)).toMatchObject({ status: 'warn', cause: 'warn_threshold' })
    // 49 → 490 < 630 (90 % de 70): sin ámbar.
    expect(lunchOnThursday(49)).toMatchObject({ status: 'ok', cause: 'none' })
    expect(lunchOnThursday(63)).toMatchObject({ status: 'warn', cause: 'warn_threshold' })
    const withTerrace: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        {
          segment: 'lunch',
          override_date: '2026-09-10',
          capacity: 120,
          warn_at: null,
          reason: 'Terraza abierta',
        },
      ],
    }
    expect(lunchOnThursday(52, withTerrace)).toMatchObject({ status: 'ok', cause: 'none' })
  })

  it('90 % en enteros: 108/120 es ámbar, 107/120 no', () => {
    const at = (guests: number) =>
      day('2026-09-10', [res({ estimated_guests: guests })], []).segments.dinner.status
    expect(at(108)).toBe('warn')
    expect(at(107)).toBe('ok')
    expect(at(120)).toBe('warn')
    expect(at(121)).toBe('over')
  })

  it('servicio cerrado (cupo 0): ok sin gente, rojo con gente, nunca ámbar', () => {
    const closed: SegmentConfig = {
      ...HUB_CONFIG,
      weekly: [
        ...HUB_CONFIG.weekly.filter((w) => !(w.segment === 'lunch' && w.iso_dow === 4)),
        { segment: 'lunch', iso_dow: 4, capacity: 0, warn_at: null },
      ],
    }
    const empty = day('2026-09-10', [], [], closed).segments.lunch
    expect(empty).toMatchObject({ capacity: 0, status: 'ok', hasActivity: false })
    const two = lunchOnThursday(2, closed)
    expect(two).toMatchObject({ status: 'over', cause: 'people_over' })
    expect(lunchOnThursday(0, closed).status).toBe('ok')
  })

  it('cena cerrada (cupo 0) con un evento programado: el evento no «se lleva» nada', () => {
    // «Cupo del día» → cena 0 por evento privado, con el evento igual en el
    // calendario. 140 > 0, pero un servicio cerrado no tiene qué llevarse.
    const date = '2026-09-19'
    const closed: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        {
          segment: 'dinner',
          override_date: date,
          capacity: 0,
          warn_at: null,
          reason: 'Evento privado',
        },
      ],
    }
    const pizza = ev({ id: 'pizza', name: 'Pizza libre', capacity: 140, event_date: date })
    expect(day(date, [], [pizza], closed).segments.dinner).toMatchObject({
      capacity: 0,
      eventCapSum: 140,
      reservedForEvents: 0,
      status: 'ok',
      eventExceedsSegment: false,
    })
  })

  it('sin tope: fallback 0 y 40 en la cena', () => {
    const config: SegmentConfig = { weekly: [], overrides: [], settings: [], fallbackTotal: 0 }
    const dinner = day('2026-09-10', [res({ estimated_guests: 40 })], [], config).segments.dinner
    expect(dinner).toMatchObject({
      capacity: null,
      status: 'ok',
      cause: 'none',
      normalCap: null,
      freeForNormal: null,
      people: 40,
    })
  })

  it('la madrugada es la cena: reserva a las 03:00 y evento a las 00:30', () => {
    const late = res({ meal_type: 'dinner', reservation_time_local: '03:00:00' })
    expect(segmentOfReservation(late, new Map())).toBe('dinner')
    const map = eventSegmentMap([ev({ id: 'late', name: 'After', starts_at_local: '00:30:00' })])
    expect(map.get('late')).toBe('dinner')
    const d = day(
      '2026-09-10',
      [late],
      [ev({ id: 'late', name: 'After', starts_at_local: '00:30:00' })],
    )
    expect(d.segments.dinner.events.map((e) => e.id)).toEqual(['late'])
    expect(d.segments.dinner.normalUsed).toBe(2)
  })

  it('ignora reservas y eventos de otras fechas', () => {
    const d = day(
      '2026-09-10',
      [res({ reservation_date: '2026-09-11', estimated_guests: 50 })],
      [ev({ id: 'other', name: 'Otro', event_date: '2026-09-11' })],
    )
    expect(d.segments.dinner).toMatchObject({ people: 0, eventCapSum: 0, hasActivity: false })
  })

  it('una reserva atada a un evento que no vino en la lista cuenta como normal', () => {
    const d = day(
      '2026-09-10',
      [res({ scheduled_event_id: 'ausente', meal_type: 'tea_time', estimated_guests: 8 })],
      [],
    )
    expect(d.segments.tea_time).toMatchObject({ normalUsed: 8, eventUsed: 0, people: 8 })
  })

  it('siempre devuelve los 3 servicios, aunque el día esté vacío', () => {
    const d = day('2026-09-10', [], [])
    expect(Object.keys(d.segments)).toEqual(['lunch', 'tea_time', 'dinner'])
    expect(d.segments.tea_time).toMatchObject({ people: 0, freeForNormal: 120, status: 'ok' })
  })
})

// ──────────────────────────────────────────────────────────
// Mes
// ──────────────────────────────────────────────────────────

describe('computeMonthSegments', () => {
  const all = [sep10(), sep19(), sep21(), sep22()]
  const reservations = all.flatMap((f) => f.reservations)
  const events = all.flatMap((f) => f.events)

  it('septiembre 2026: 30 días, ignora octubre y usa la misma cuenta que el día', () => {
    const month = computeMonthSegments({
      ym: '2026-09',
      reservations: [
        ...reservations,
        res({ reservation_date: '2026-10-01', estimated_guests: 99 }),
      ],
      events,
      config: HUB_CONFIG,
    })
    expect(Object.keys(month.days)).toHaveLength(30)
    expect(month.days['2026-10-01']).toBeUndefined()
    expect(month.days['2026-09-10']?.segments.dinner.people).toBe(119)
    expect(month.days['2026-09-19']?.segments.dinner.status).toBe('over')
    expect(month.days['2026-09-01']?.segments.dinner.hasActivity).toBe(false)
    expect(month.configured).toBe(true)
    expect(month.fallbackTotal).toBe(130)
    expect(month.settings.lunch.warnNote).toBe('Conviene abrir la terraza')
  })

  it('configured false sin filas semanales', () => {
    const month = computeMonthSegments({
      ym: '2026-09',
      reservations: [],
      events: [],
      config: { ...HUB_CONFIG, weekly: [] },
    })
    expect(month.configured).toBe(false)
    expect(isSegmentConfigured({ weekly: [] })).toBe(false)
    expect(month.days['2026-09-10']?.segments.dinner.capacity).toBe(130)
  })

  it('febrero bisiesto tiene 29 días; un mes inválido no tiene días', () => {
    const base = { reservations: [], events: [], config: HUB_CONFIG }
    expect(Object.keys(computeMonthSegments({ ...base, ym: '2028-02' }).days)).toHaveLength(29)
    expect(Object.keys(computeMonthSegments({ ...base, ym: '2026-13' }).days)).toHaveLength(0)
  })

  it('eventLoadsById y dayCelebrations', () => {
    const month = computeMonthSegments({ ym: '2026-09', reservations, events, config: HUB_CONFIG })
    const loads = eventLoadsById(month.days)
    expect(loads.sushi).toMatchObject({ name: 'Sushi libre', used: 73, capacity: 70 })
    expect(loads.rata).toMatchObject({ used: 54 })
    const sep10Day = month.days['2026-09-10']
    expect(sep10Day && dayCelebrations(sep10Day)).toEqual({ birthdays: 3, cakes: 1 })
  })
})

describe('groupReservationsBySegment', () => {
  it('siempre las 3 claves y respeta el orden de entrada', () => {
    const { reservations, events } = sep10()
    const grouped = groupReservationsBySegment(reservations, events)
    expect(Object.keys(grouped)).toEqual(['lunch', 'tea_time', 'dinner'])
    expect(grouped.lunch.map((r) => r.estimated_guests)).toEqual([19])
    expect(grouped.tea_time.map((r) => r.estimated_guests)).toEqual([20, 13])
    expect(grouped.dinner.map((r) => r.id)).toEqual(reservations.slice(3).map((r) => r.id))
    expect(groupReservationsBySegment([], [])).toEqual({ lunch: [], tea_time: [], dinner: [] })
  })
})

describe('suggestedCapacityRaise', () => {
  it('el cupo semanal más alto del servicio si supera al actual', () => {
    expect(suggestedCapacityRaise(HUB_CONFIG, 'lunch', 70)).toBe(120)
    expect(suggestedCapacityRaise(HUB_CONFIG, 'dinner', 120)).toBeNull()
    expect(suggestedCapacityRaise(HUB_CONFIG, 'lunch', null)).toBeNull()
    expect(suggestedCapacityRaise({ weekly: [] }, 'lunch', 70)).toBeNull()
  })
})

describe('focusSegment', () => {
  const { reservations, events } = sep10()
  const d = day('2026-09-10', reservations, events)

  it('con reloj, el servicio en curso; sin reloj, la cena', () => {
    expect(focusSegment(d, 1300)).toBe('dinner')
    expect(focusSegment(d, null)).toBe('dinner')
    expect(focusSegment(d, 780)).toBe('lunch')
  })
})

// ──────────────────────────────────────────────────────────
// Proyección
// ──────────────────────────────────────────────────────────

describe('projectReservation', () => {
  const s10 = () => {
    const { reservations, events } = sep10()
    return snapshotOf('2026-09-10', reservations, events)
  }

  it('a) 10/09 + normal de 4 en la cena → se pasa por personas y pide confirmación', () => {
    const p = projectReservation(s10(), candidate({ guests: 4 }))
    expect(p?.segment).toBe('dinner')
    expect(p?.after).toMatchObject({ people: 123, status: 'over', cause: 'people_over' })
    expect(p?.needsConfirm).toBe(true)
    expect(p?.addedPeople).toBe(4)
    expect(p?.event).toBeNull()
  })

  it('b) 10/09 + 2 en Sushi libre → el evento pasa a 75/70', () => {
    const p = projectReservation(
      s10(),
      candidate({ guests: 2, scheduled_event_id: 'sushi', zone: 'event_floating' }),
    )
    expect(p?.after).toMatchObject({ eventUsed: 75, eventSeats: 75, occupied: 121 })
    expect(p?.needsConfirm).toBe(true)
    expect(p?.event).toMatchObject({ id: 'sushi', used: 75, capacity: 70 })
  })

  it('c) editar la normal de 16 a 18 (mismo id) reemplaza la fila', () => {
    const p = projectReservation(s10(), candidate({ id: 'n16', guests: 18 }))
    expect(p?.after.people).toBe(121)
    expect(p?.needsConfirm).toBe(true)
    expect(p?.addedPeople).toBe(2)
  })

  it('d) editar sin cambiar personas no pide confirmación', () => {
    const p = projectReservation(s10(), candidate({ id: 'n16', guests: 16 }))
    expect(p?.addedPeople).toBe(0)
    expect(p?.needsConfirm).toBe(false)
  })

  it('e) mover la normal de 16 al almuerzo de las 13:00', () => {
    const p = projectReservation(
      s10(),
      candidate({ id: 'n16', guests: 16, meal_type: 'lunch', reservation_time_local: '13:00' }),
    )
    expect(p?.segment).toBe('lunch')
    expect(p?.before.people).toBe(19)
    expect(p?.after.people).toBe(35)
    expect(p?.needsConfirm).toBe(false)
  })

  it('f) 22/09 + normal de 4 → normals_over sobre lo que apartaron los eventos', () => {
    const { date, reservations, events } = sep22()
    const p = projectReservation(
      snapshotOf(date, reservations, events),
      candidate({ reservation_date: date, guests: 4 }),
    )
    expect(p?.before.occupied).toBe(120)
    expect(p?.after).toMatchObject({ occupied: 124, cause: 'normals_over', people: 58 })
    expect(p?.needsConfirm).toBe(true)
  })

  it('g) 19/09 + 4 adentro de Pizza libre: ya estaba apartado, no pregunta', () => {
    const { date, reservations, events } = sep19()
    const p = projectReservation(
      snapshotOf(date, reservations, events),
      candidate({
        reservation_date: date,
        guests: 4,
        scheduled_event_id: 'pizza19',
        zone: 'event_floating',
      }),
    )
    expect(p?.before.occupied).toBe(253)
    expect(p?.after.occupied).toBe(253)
    expect(p?.after.status).toBe('over')
    expect(p?.needsConfirm).toBe(false)
  })

  it('h) reserva especial con un formato no programado descuenta el evento virtual', () => {
    const date = '2026-09-24'
    const p = projectReservation(
      snapshotOf(date, [res({ reservation_date: date, estimated_guests: 100 })], []),
      candidate({
        reservation_date: date,
        guests: 30,
        kind: 'special',
        zone: 'event_floating',
        virtualEvent: { name: 'Pizza libre', capacity: 140, starts_at_local: '21:00' },
      }),
    )
    expect(p?.after).toMatchObject({ reservedForEvents: 120, occupied: 220 })
    expect(p?.needsConfirm).toBe(true)
    expect(p?.event).toMatchObject({ id: VIRTUAL_EVENT_ID, name: 'Pizza libre', used: 30 })
  })

  it('i) snapshot de otra fecha → null (quedó viejo)', () => {
    expect(projectReservation(s10(), candidate({ reservation_date: '2026-09-11' }))).toBeNull()
  })

  it('j) 22/09: sacar del evento una reserva de 2 no suma personas pero sí lugar', () => {
    // Editar la de 2x1 Burger y pasarla a Planta Alta (el form le borra el
    // evento): la gente sigue siendo 56, pero sus 2 pasan a las normales, que
    // ya no tenían lugar. Pregunta igual, por lo ocupado.
    const { date, reservations, events } = sep22()
    const burger = res({
      id: 'burger2',
      reservation_date: date,
      scheduled_event_id: 'burger',
      zone: 'event_floating',
      estimated_guests: 2,
    })
    const p = projectReservation(
      snapshotOf(date, [...reservations, burger], events),
      candidate({ id: 'burger2', reservation_date: date, guests: 2 }),
    )
    expect(p?.before).toMatchObject({ people: 56, occupied: 120 })
    expect(p?.after).toMatchObject({ people: 56, occupied: 122, cause: 'normals_over' })
    expect(p?.addedPeople).toBe(0)
    expect(p?.needsConfirm).toBe(true)
  })

  it('no muta el snapshot', () => {
    const snap = s10()
    const before = JSON.stringify(snap)
    projectReservation(snap, candidate({ id: 'n16', guests: 40 }))
    expect(JSON.stringify(snap)).toBe(before)
  })
})
