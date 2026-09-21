import { describe, expect, it } from 'vitest'
import {
  computeDaySegments,
  type DaySegmentsSnapshot,
  projectReservation,
  type ReservationCandidate,
  resolveDaySegmentCaps,
  resolveSegmentSettings,
  type SegmentConfig,
  type SegmentEventInput,
  type SegmentLoad,
  type SegmentProjection,
  type SegmentReservationInput,
} from '@/lib/salon/segments'
import {
  agendaDetailLines,
  capSourceLabel,
  mismatchCopy,
  overCapacityConfirmCopy,
  SEGMENT_LABELS,
  SEGMENT_LETTERS,
  SEGMENT_SHORT_LABELS,
  SEGMENT_WITH_ARTICLE,
  savedToastCopy,
  segmentAlertMark,
  segmentAriaLabel,
  segmentBreakdown,
  segmentCellBreakdown,
  segmentEventNote,
  segmentHeadline,
  segmentRatio,
  segmentStatusLine,
  segmentTone,
} from '@/lib/salon/segments-copy'

// Fixtures mínimos (los mismos días que salon-segments.test.ts). Los strings de
// este archivo son contrato: los ven el mes, el día, el form y el operativo.

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

function ev(p: Partial<SegmentEventInput> & { id: string; name: string }): SegmentEventInput {
  const { name, ...rest } = p
  return {
    event_date: '2026-09-10',
    starts_at_local: '21:00:00',
    capacity: 70,
    name_override: null,
    template: { name, color_hex: '#e11d48' },
    ...rest,
  }
}

const weekly = (segment: 'lunch' | 'tea_time' | 'dinner', capacity: number, warn: number | null) =>
  ([1, 2, 3, 4, 5, 6, 7] as const).map((iso_dow) => ({
    segment,
    iso_dow,
    capacity: segment === 'lunch' && iso_dow >= 6 ? 120 : capacity,
    warn_at: segment === 'lunch' && iso_dow >= 6 ? null : warn,
  }))

const HUB_CONFIG: SegmentConfig = {
  weekly: [
    ...weekly('lunch', 70, 50),
    ...weekly('tea_time', 120, null),
    ...weekly('dinner', 120, null),
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
  events: SegmentEventInput[] = [],
  config: SegmentConfig = HUB_CONFIG,
) {
  return computeDaySegments({
    date,
    reservations,
    events,
    caps: resolveDaySegmentCaps(date, config),
  })
}

function snapshot(
  date: string,
  reservations: SegmentReservationInput[],
  events: SegmentEventInput[],
): DaySegmentsSnapshot {
  return {
    date,
    caps: resolveDaySegmentCaps(date, HUB_CONFIG),
    settings: resolveSegmentSettings(HUB_CONFIG.settings),
    reservations,
    events,
  }
}

function candidate(p: Partial<ReservationCandidate>): ReservationCandidate {
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

function project(s: DaySegmentsSnapshot, c: ReservationCandidate): SegmentProjection {
  const p = projectReservation(s, c)
  if (!p) throw new Error('la proyección no debería ser null')
  return p
}

const SEP10_EVENTS = [ev({ id: 'sushi', name: 'Sushi libre', capacity: 70 })]
const SEP10 = [
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
  res({ scheduled_event_id: 'sushi', zone: 'event_floating', estimated_guests: 40 }),
  res({
    scheduled_event_id: 'sushi',
    zone: 'event_floating',
    estimated_guests: 18,
    kind: 'birthday',
    cake_count: 1,
  }),
  res({ scheduled_event_id: 'sushi', zone: 'event_floating', estimated_guests: 15 }),
  res({ estimated_guests: 16 }),
  res({ estimated_guests: 15, kind: 'birthday' }),
  res({ estimated_guests: 15, kind: 'birthday' }),
  res({ estimated_guests: 10, status: 'cancelled' }),
]

const SEP19_EVENTS = [
  ev({ id: 'pizza', name: 'Pizza libre', capacity: 140, event_date: '2026-09-19' }),
]
const SEP19 = [40, 36, 30, 27].map((g) =>
  res({ reservation_date: '2026-09-19', estimated_guests: g }),
)

const SEP22_EVENTS = [
  ev({ id: 'burger', name: '2x1 Burger', capacity: 100, event_date: '2026-09-22' }),
  ev({ id: 'rata', name: 'Ratatuille', capacity: 50, event_date: '2026-09-22' }),
]
const SEP22 = [30, 24].map((g) =>
  res({
    reservation_date: '2026-09-22',
    scheduled_event_id: 'rata',
    zone: 'event_floating',
    estimated_guests: g,
  }),
)

function lunch(guests: number, config: SegmentConfig = HUB_CONFIG): SegmentLoad {
  return day(
    '2026-09-10',
    [res({ meal_type: 'lunch', reservation_time_local: '13:00:00', estimated_guests: guests })],
    [],
    config,
  ).segments.lunch
}

describe('labels', () => {
  it('nombres de los 3 servicios en cada densidad', () => {
    expect(SEGMENT_LABELS).toEqual({ lunch: 'Almuerzo', tea_time: 'Merienda', dinner: 'Cena' })
    expect(SEGMENT_SHORT_LABELS).toEqual({ lunch: 'Alm', tea_time: 'Mer', dinner: 'Cena' })
    expect(SEGMENT_LETTERS).toEqual({ lunch: 'A', tea_time: 'M', dinner: 'C' })
    expect(SEGMENT_WITH_ARTICLE).toEqual({
      lunch: 'el almuerzo',
      tea_time: 'la merienda',
      dinner: 'la cena',
    })
  })
})

describe('10/09, la cena de Sushi libre', () => {
  const d = day('2026-09-10', SEP10, SEP10_EVENTS)
  const dinner = d.segments.dinner

  it('headline en las 3 densidades: personas, nunca lo ocupado', () => {
    expect(segmentHeadline(dinner, 'letter')).toBe('C 119/120')
    expect(segmentHeadline(dinner, 'short')).toBe('Cena 119/120')
    expect(segmentHeadline(dinner, 'long')).toBe('Cena · 119 de 120')
    expect(segmentRatio(dinner)).toBe('119/120')
  })

  it('estado, desglose y tono', () => {
    expect(segmentStatusLine(dinner)).toBe('Queda 1 lugar para reservas normales')
    expect(segmentBreakdown(dinner)).toBe(
      'Sushi libre 73/70 · normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    )
    expect(segmentBreakdown(dinner, { includeEvents: false })).toBe(
      'normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    )
    expect(segmentTone(dinner)).toBe('warn')
    expect(segmentEventNote(dinner)).toBeNull()
  })

  it('desglose de celda: el pedido del dueño entra en dos renglones', () => {
    expect(segmentCellBreakdown(dinner)).toBe('46/50 normales · 3 cumples · 1 torta')
    expect(segmentCellBreakdown(d.segments.lunch)).toBeNull()
  })

  it('almuerzo del mismo día: quedan 51', () => {
    expect(segmentStatusLine(d.segments.lunch)).toBe('Quedan 51 lugares')
    expect(segmentTone(d.segments.lunch)).toBe('ok')
    expect(segmentBreakdown(d.segments.lunch)).toBeNull()
  })

  it('agendaDetailLines: solo la cena tiene algo que decir', () => {
    expect(agendaDetailLines(d)).toEqual([
      'Cena: Queda 1 lugar para reservas normales · normales 46 de 50 · 3 cumples (1 en el evento) · 1 torta (en el evento)',
    ])
  })

  it('segmentAriaLabel lleva el día, el número, el estado y el desglose', () => {
    expect(segmentAriaLabel(dinner, 'jue 10/09')).toBe(
      'Cena, jue 10/09: 119 de 120 personas. Queda 1 lugar para reservas normales. Sushi libre 73/70, normales 46 de 50, 3 cumples (1 en el evento), 1 torta (en el evento).',
    )
    expect(segmentAriaLabel(d.segments.tea_time, '')).toBe(
      'Merienda: 33 de 120 personas. Quedan 87 lugares.',
    )
  })
})

describe('rojos y notas de eventos', () => {
  it('19/09: te pasaste por personas y Pizza libre se lleva toda la cena', () => {
    const dinner = day('2026-09-19', SEP19, SEP19_EVENTS).segments.dinner
    expect(segmentHeadline(dinner, 'short')).toBe('Cena 133/120')
    expect(segmentStatusLine(dinner)).toBe('Te pasaste por 13')
    expect(segmentEventNote(dinner)).toBe('Pizza libre (cupo 140) se lleva toda la cena de 120')
    expect(segmentTone(dinner)).toBe('over')
    // 133/120 ya dice que no hay lugar: sin "!".
    expect(segmentAlertMark(dinner)).toBeNull()
  })

  it('22/09: dos eventos se llevan la cena', () => {
    const dinner = day('2026-09-22', SEP22, SEP22_EVENTS).segments.dinner
    expect(segmentStatusLine(dinner)).toBe('Quedan 0 lugares para reservas normales')
    expect(segmentEventNote(dinner)).toBe('Los eventos (cupo 150) se llevan toda la cena de 120')
  })

  it('03/09: las normales pisan lo que apartaron los eventos', () => {
    const date = '2026-09-03'
    const dinner = day(
      date,
      [
        res({ reservation_date: date, scheduled_event_id: 'pizza', estimated_guests: 40 }),
        res({ reservation_date: date, scheduled_event_id: 'fernet', estimated_guests: 27 }),
        res({ reservation_date: date, estimated_guests: 4 }),
      ],
      [
        ev({ id: 'pizza', name: 'Pizza libre', capacity: 140, event_date: date }),
        ev({ id: 'fernet', name: 'Fernet', capacity: 100, event_date: date }),
      ],
    ).segments.dinner
    expect(segmentStatusLine(dinner)).toBe(
      'Te pasaste por 4: los eventos tienen apartados 120 lugares',
    )
    // 71/120 en rojo: el número solo no lo explica, va el "!".
    expect(segmentAlertMark(dinner)).toBe('!')
  })

  it('15/09: un solo evento que aparta todo', () => {
    const date = '2026-09-15'
    const dinner = day(
      date,
      [
        res({ reservation_date: date, scheduled_event_id: 'burger', estimated_guests: 65 }),
        res({ reservation_date: date, estimated_guests: 31 }),
      ],
      [ev({ id: 'burger', name: '2x1 Burger Martes', capacity: 120, event_date: date })],
    ).segments.dinner
    expect(segmentStatusLine(dinner)).toBe(
      'Te pasaste por 31: 2x1 Burger Martes tiene apartados 120 lugares',
    )
  })

  it('el almuerzo usa "todo el almuerzo"', () => {
    const date = '2026-09-26'
    const s = day(
      date,
      [],
      [
        ev({
          id: 'x',
          name: 'Brunch',
          capacity: 150,
          starts_at_local: '12:00:00',
          event_date: date,
        }),
      ],
    ).segments.lunch
    expect(segmentEventNote(s)).toBe('Brunch (cupo 150) se lleva todo el almuerzo de 120')
  })
})

describe('aviso del almuerzo, vacío, cerrado y sin tope', () => {
  it('Almuerzo 52/70 un jueves: la nota del bar', () => {
    const s = lunch(52)
    expect(segmentStatusLine(s)).toBe('Conviene abrir la terraza')
    expect(segmentHeadline(s, 'long')).toBe('Almuerzo · 52 de 70')
    expect(segmentTone(s)).toBe('warn')
  })

  it('sin nota configurada: el número del aviso', () => {
    const noNote: SegmentConfig = {
      ...HUB_CONFIG,
      settings: HUB_CONFIG.settings.map((row) => ({ ...row, warn_note: null })),
    }
    expect(segmentStatusLine(lunch(52, noNote))).toBe('Llegaste al aviso de 50')
  })

  it('vacío con 120 y cerrado', () => {
    expect(segmentStatusLine(day('2026-09-10', []).segments.dinner)).toBe('Libre · 120 lugares')
    expect(segmentTone(day('2026-09-10', []).segments.dinner)).toBe('none')
    const closed: SegmentConfig = {
      ...HUB_CONFIG,
      overrides: [
        { segment: 'lunch', override_date: '2026-09-10', capacity: 0, warn_at: null, reason: null },
      ],
    }
    expect(segmentStatusLine(day('2026-09-10', [], [], closed).segments.lunch)).toBe('Cerrado')
  })

  it('cerrado por evento privado: sin «se lleva toda la cena de 0»', () => {
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
    const d = day(
      date,
      [],
      [ev({ id: 'rata', name: 'Ratatuille', capacity: 140, event_date: date })],
      closed,
    )
    const dinner = d.segments.dinner
    expect(segmentStatusLine(dinner)).toBe('Cerrado')
    expect(segmentEventNote(dinner)).toBeNull()
    expect(agendaDetailLines(d)).toEqual([])
    expect(segmentAriaLabel(dinner, '')).toBe('Cena: 0 de 0 personas. Cerrado. Ratatuille 0/140.')
  })

  it('sin tope con 40 en la cena', () => {
    const config: SegmentConfig = { weekly: [], overrides: [], settings: [], fallbackTotal: 0 }
    const s = day('2026-09-10', [res({ estimated_guests: 40 })], [], config).segments.dinner
    expect(segmentHeadline(s, 'short')).toBe('Cena 40')
    expect(segmentHeadline(s, 'long')).toBe('Cena · 40')
    expect(segmentHeadline(s, 'letter')).toBe('C 40')
    expect(segmentStatusLine(s)).toBe('40 personas · sin tope')
    expect(segmentTone(s)).toBe('none')
    expect(segmentStatusLine(day('2026-09-10', [], [], config).segments.dinner)).toBe('Sin tope')
  })
})

describe('cumples y tortas', () => {
  it('sin eventos: "4 cumples · 2 tortas"', () => {
    const s = day('2026-09-10', [
      res({ kind: 'birthday', cake_count: 1 }),
      res({ kind: 'birthday', cake_count: 1 }),
      res({ kind: 'birthday' }),
      res({ kind: 'birthday' }),
    ]).segments.dinner
    expect(segmentBreakdown(s)).toBe('4 cumples · 2 tortas')
  })

  it('singulares y nunca "(0 en el evento)"', () => {
    const s = day(
      '2026-09-10',
      [res({ kind: 'birthday', cake_count: 1 }), res({ scheduled_event_id: 'sushi' })],
      SEP10_EVENTS,
    ).segments.dinner
    const text = segmentBreakdown(s)
    expect(text).toBe('Sushi libre 2/70 · normales 2 de 50 · 1 cumple · 1 torta')
    expect(text).not.toContain('(0 en')
  })

  it('tortas repartidas entre el evento y afuera', () => {
    const s = day(
      '2026-09-10',
      [res({ scheduled_event_id: 'sushi', cake_count: 1 }), res({ cake_count: 2 })],
      SEP10_EVENTS,
    ).segments.dinner
    expect(segmentBreakdown(s, { includeEvents: false })).toBe(
      'normales 2 de 50 · 3 tortas (1 en el evento)',
    )
  })
})

describe('capSourceLabel', () => {
  const base = day('2026-09-10', []).segments.dinner

  it('de dónde sale el cupo', () => {
    expect(
      capSourceLabel({ ...base, capSource: 'override', capReason: 'Terraza abierta' }, 4),
    ).toBe('Cupo especial: Terraza abierta')
    expect(capSourceLabel({ ...base, capSource: 'override', capReason: null }, 4)).toBe(
      'Cupo especial para este día',
    )
    expect(capSourceLabel({ ...base, capSource: 'weekly' }, 4)).toBe('Cupo de los jueves')
    expect(capSourceLabel({ ...base, capSource: 'weekly' }, 3)).toBe('Cupo de los miércoles')
    expect(capSourceLabel({ ...base, capSource: 'fallback' }, 4)).toBe('Cupo general del salón')
    expect(capSourceLabel({ ...base, capSource: 'none' }, 4)).toBe('Sin tope')
  })
})

describe('mismatchCopy', () => {
  it('03/10: Merienda Libre cargada a las 21:00', () => {
    expect(
      mismatchCopy({
        eventId: 'm',
        eventName: 'Merienda Libre',
        startsAt: '21:00',
        eventSegment: 'dinner',
        reservationsSegment: 'tea_time',
        reservations: 1,
        people: 33,
      }),
    ).toBe(
      'Merienda Libre figura a las 21:00 (cena), pero su reserva es de la merienda. Corregí la hora del evento para que cuente en el servicio correcto.',
    )
  })

  it('plural', () => {
    expect(
      mismatchCopy({
        eventId: 'a',
        eventName: 'Merienda y Arte',
        startsAt: '13:00',
        eventSegment: 'lunch',
        reservationsSegment: 'tea_time',
        reservations: 3,
        people: 12,
      }),
    ).toBe(
      'Merienda y Arte figura a las 13:00 (almuerzo), pero sus 3 reservas son de la merienda. Corregí la hora del evento para que cuente en el servicio correcto.',
    )
  })
})

describe('overCapacityConfirmCopy y savedToastCopy', () => {
  const s10 = () => snapshot('2026-09-10', SEP10, SEP10_EVENTS)

  it('(22a) normal de 4 en la cena del 10/09', () => {
    const p = project(s10(), candidate({ guests: 4 }))
    expect(overCapacityConfirmCopy(p)).toEqual({
      title: 'Te pasás del cupo de la cena',
      body: 'Quedarían 123 de 120 (3 de más).',
      eventLine: null,
    })
    expect(savedToastCopy('create', p)).toBe('Reserva cargada · Cena · 123 de 120')
  })

  it('(22b) 2 más en Sushi libre', () => {
    const p = project(
      s10(),
      candidate({ guests: 2, scheduled_event_id: 'sushi', zone: 'event_floating' }),
    )
    expect(overCapacityConfirmCopy(p).eventLine).toBe('Sushi libre quedaría 75/70.')
  })

  it('(22f) 22/09 + normal de 4', () => {
    const p = project(
      snapshot('2026-09-22', SEP22, SEP22_EVENTS),
      candidate({ reservation_date: '2026-09-22', guests: 4 }),
    )
    expect(overCapacityConfirmCopy(p).body).toBe(
      'Los eventos tienen apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 4.',
    )
  })

  it('un solo evento: nombra al evento', () => {
    const date = '2026-09-15'
    const p = project(
      snapshot(
        date,
        [res({ reservation_date: date, scheduled_event_id: 'burger', estimated_guests: 65 })],
        [ev({ id: 'burger', name: '2x1 Burger Martes', capacity: 120, event_date: date })],
      ),
      candidate({ reservation_date: date, guests: 4 }),
    )
    expect(overCapacityConfirmCopy(p)).toMatchObject({
      title: 'Te pasás del cupo de la cena',
      body: '2x1 Burger Martes tiene apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 4.',
    })
  })

  it('22/09: sacar del evento una de 2 suma 2 lugares aunque no sume personas', () => {
    // Editar la de 2x1 Burger y pasarla a Planta Alta: 56 → 56 personas, pero
    // lo ocupado va de 120 a 122. Antes decía «esta suma 0».
    const burger = res({
      id: 'burger2',
      reservation_date: '2026-09-22',
      scheduled_event_id: 'burger',
      zone: 'event_floating',
      estimated_guests: 2,
    })
    const p = project(
      snapshot('2026-09-22', [...SEP22, burger], SEP22_EVENTS),
      candidate({ id: 'burger2', reservation_date: '2026-09-22', guests: 2 }),
    )
    expect(p.addedPeople).toBe(0)
    expect(p.needsConfirm).toBe(true)
    expect(overCapacityConfirmCopy(p).body).toBe(
      'Los eventos tienen apartados 120 lugares. Quedaban 0 para reservas normales y esta suma 2.',
    )
  })

  it('normals_over que no empeora lo ocupado: la causa, nunca «suma 0»', () => {
    // Ya pasada por una normal de 2; sumar 2 adentro de 2x1 Burger usa lugar
    // que el evento tenía apartado (122 → 122). No pide confirmación, pero la
    // vista rápida igual muestra el aviso con este texto.
    const normal = res({ reservation_date: '2026-09-22', estimated_guests: 2 })
    const p = project(
      snapshot('2026-09-22', [...SEP22, normal], SEP22_EVENTS),
      candidate({
        reservation_date: '2026-09-22',
        guests: 2,
        scheduled_event_id: 'burger',
        zone: 'event_floating',
      }),
    )
    expect(p.after).toMatchObject({ cause: 'normals_over', occupied: 122 })
    expect(p.before.occupied).toBe(122)
    expect(p.needsConfirm).toBe(false)
    const { body } = overCapacityConfirmCopy(p)
    expect(body).toBe('Te pasaste por 2: los eventos tienen apartados 120 lugares.')
    expect(body).not.toContain('suma 0')
  })

  it('toast de edición y alta sin proyección', () => {
    expect(savedToastCopy('edit', null)).toBe('Reserva actualizada')
    expect(savedToastCopy('create', null)).toBe('Reserva cargada')
  })
})
